# syntax=docker/dockerfile:1

###############################################################################
# Bingus ships as one image: the Hono/Socket.IO server serving the built Vite
# client same-origin (BINGUS_STATIC_DIR — see server/src/index.ts). The server
# runs TypeScript directly via tsx, so there is no server compile step; the
# only build artifact is the client bundle.
###############################################################################

# corepack provisions the exact pnpm pinned by `packageManager` in
# package.json, so the image and local dev can never drift on pnpm versions.
FROM node:24-slim AS base
RUN corepack enable

# Builder — full install (dev deps included: vite, tsc) to build the client.
FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bingus/client build

# Prod deps — a fresh install of only the server's runtime dependency tree
# (`...` pulls in @bingus/shared via workspace:*). The client's deps don't
# matter at runtime: its build output is static files.
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY shared/package.json shared/
COPY client/package.json client/
RUN pnpm install --prod --frozen-lockfile --filter "@bingus/server..."

###############################################################################
# Runtime — node + the workspace sources, prod node_modules, and the client
# bundle. Starts as root so the PUID/PGID entrypoint can remap the app user,
# then drops to it before serving (gosu). curl is for the health probe.
###############################################################################
FROM node:24-slim AS runtime

# The node base image already owns uid 1000 as `node`; rename it to `bingus`
# rather than minting a duplicate uid (useradd exits 4 on a uid collision).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gosu \
    && rm -rf /var/lib/apt/lists/* \
    && usermod --login bingus --home /home/bingus --move-home --shell /usr/sbin/nologin node \
    && groupmod --new-name bingus node

WORKDIR /app
# pnpm's node_modules are relative symlinks into /app/node_modules/.pnpm, so
# the directory layout must mirror the workspace exactly.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY server/ server/
COPY shared/ shared/
COPY --from=builder /app/client/dist ./client/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Bind on all interfaces and keep the SQLite file on the /data volume.
ENV PORT=3000 \
    BINGUS_DB=/data/bingus.db \
    BINGUS_STATIC_DIR=/app/client/dist

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

# The server resolves relative paths (none in prod — DB and static dir are
# absolute) from server/, and tsx lives in server/node_modules/.bin because
# it's a runtime dependency of @bingus/server.
WORKDIR /app/server
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node_modules/.bin/tsx", "src/index.ts"]
