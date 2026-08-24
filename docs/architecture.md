# Architecture

Bingus is a pnpm-workspaces monorepo with three packages:

```
client/   @bingus/client — Vite + React 19 + TypeScript SPA
server/   @bingus/server — Hono (REST) + Socket.IO (realtime) on Node
shared/   @bingus/shared — the wire protocol both sides import
```

## How the frontend talks to the backend

There are exactly two channels, both terminating at the same Node process:

### 1. REST — request/response data

Everything that is not live game traffic goes over plain HTTP under `/api/*`, served by **Hono** ([server/src/app.ts](../server/src/app.ts)). This covers players, the board archive (list, search, create), health checks, and any other CRUD.

**Every endpoint except `/api/health` and `/api/login` requires a session**, and a session that is still behind the password-reset gate (see [Persistence & identity](#persistence--identity)) may only touch `GET /api/me` and `POST /api/me/password` — everything else answers `403 password_reset_required`.

Current endpoints:

- `GET /api/health` — liveness probe. No session needed.
- `POST /api/login` — name (case-insensitive) + password or one-time code. Sets the httpOnly session cookie and rotates the player's token, killing any previous session. One `401 invalid_credentials` body for unknown-name and wrong-password alike (no account enumeration); `429 rate_limited` after 10 failures per name per 15 minutes.
- `POST /api/logout` — rotate the token (invalidating the session server-side) and clear the cookie. Succeeds for any cookie state.
- `GET /api/me` — resolve the session cookie to the player plus their private flags (`needsPasswordReset`, `isAdmin`). `401 unauthorized` when the cookie is missing or stale. Exempt from the reset gate.
- `POST /api/me/password` — set a new password (min `PASSWORD_MIN` chars); clears `needsPasswordReset`. Exempt from the reset gate — it *is* the reset path.
- `PATCH /api/me` — rename the signed-in player; `409 name_taken` on collision.
- `POST /api/players` — **admin only**: provision an account. Returns the `Player` plus a `oneTimeCode` shown exactly once (only its hash is stored); no cookie is set. `409 name_taken` on collision, `403 forbidden` for non-admins. There is no public registration.
- `GET /api/players` — **admin only**: the account roster with per-player flags.
- `POST /api/players/:id/code` — **admin only**: re-issue a one-time code. Overwrites the player's password, re-arms the reset gate, and rotates their token (any live session dies) — this doubles as the password-reset path for a locked-out friend.
- `GET /api/stats` — Home-screen numbers (player and board counts are live; liveGames stays 0 until game tables exist).
- `GET /api/boards?search=&limit=&offset=` — browse the board archive, newest first; `search` filters by name (case-insensitive), `limit` caps at 50.
- `POST /api/boards` — print a fresh board. A board is a **word bank**, not a fixed card: the shared schema validates that it holds at least `size² - 1` terms (the card's tile count — one tile is FREE at `freeIndex(size)`), at most `BOARD_TERMS_MAX` (200), and no duplicates; `400 invalid_board` with a message on failure. Anything above the minimum is depth the deal draws from.
- `GET /api/boards/:id` / `PATCH /api/boards/:id` / `DELETE /api/boards/:id` — fetch one board / edit it / permanently delete it (edit and delete are creator-only, `403 unauthorized` otherwise).
- `POST /api/games` — open a live table for a board. Returns the join code (`BNGS-nnn`); everything after creation happens over the socket.
- `GET /api/games` — list joinable tables (lobby + playing, newest first) for the Live Tables screen, which polls it every 5s.

- In **dev**, the client calls same-origin paths (`fetch('/api/...')`) and the Vite dev server proxies them to `http://localhost:3000` (see [client/vite.config.ts](../client/vite.config.ts)). No CORS anywhere.
- In **prod**, the server itself serves the client build same-origin: `BINGUS_STATIC_DIR` (set in the Docker image, unset in dev) points at `client/dist`, and the app mounts it after the API routes with an SPA fallback — any non-`/api` GET that doesn't match a file gets `index.html` so client-side routes survive a hard refresh, while unmatched `/api/*` paths still return JSON 404s.

### 2. Socket.IO — realtime game traffic

Everything live goes over a single **Socket.IO** connection: lobby presence, tile marks, rivals' board updates, chat, win broadcasts. Socket.IO attaches to the same Node HTTP server that Hono runs on ([server/src/index.ts](../server/src/index.ts)) and claims `/socket.io/*`; Hono handles every other route. The Vite proxy forwards `/socket.io` (with websockets) in dev.

Socket.IO was chosen over raw `ws` for its rooms (one room per game), automatic reconnection with buffered events (a sleeping laptop shouldn't eject a player mid-game), and acknowledgment callbacks (request/response semantics for actions like marking a tile).

### The shared package: one source of truth for types

`@bingus/shared` is the single home for every type the packages have in common. Domain types (players, boards, games) are defined once here and imported by the client, the server, **and tests** — no package redeclares a shape locally, and there is never a frontend copy and a backend copy of the same concept. Types are derived from Zod schemas (`z.infer`) wherever a value crosses a trust boundary, so runtime validation and static types cannot drift apart.

**Every message that crosses the wire is defined in [shared/src/protocol.ts](../shared/src/protocol.ts)** — Zod schemas for payloads plus the `ClientToServerEvents` / `ServerToClientEvents` interfaces that parameterize Socket.IO on both sides. Neither client nor server may invent an event or payload shape locally:

- The **server validates** every inbound payload with the Zod schema before acting on it (never trust the client).
- The **client gets compile-time safety** from the typed event maps — emitting an unknown event or a wrong payload shape is a type error.

Adding a feature that needs a new message = add the schema + event signature to `shared/src/protocol.ts` first, then implement both ends against it.

## Server authority

The server is the referee. Cards are dealt server-side per player — shuffle the board's word bank, take the first `size² - 1` terms (so cards can't be re-rolled and rivals' boards render consistently) — and win claims are validated server-side against the marked set (row / column / diagonal / blackout). Clients render state and report intents; they never decide outcomes. A bank sized exactly to the card is the degenerate case, dealing every seat the same terms in a different order; a deeper bank makes cards differ in content, so players aren't all hunting one list.

Active game state lives in memory on the single server process (`server/src/games.ts`: one `GameRoom` per table, managed by `GameManager`); the board archive and players live in SQLite. Rooms deal each joiner a card off the board's word bank server-side (capped at `GAME_MAX_PLAYERS` = 8 seats), referee every mark (row / column / diagonal / blackout detection), support a `game:rematch` event (any seated player resets a finished table — fresh cards, back to the lobby), hand the host role to the longest-seated connected player when the host disconnects (returning ex-hosts don't reclaim it), and get swept once finished and empty — or when a lobby's last player walks out. Sweeps run after a short grace period (10s) rather than instantly, so a leave immediately followed by a rejoin (React StrictMode's dev-mode effect replay, reconnect blips) can't delete a room the player is about to re-enter. The socket layer (`server/src/socket.ts`) authenticates the handshake with the session cookie — rejecting it with `connect_error` message `"unauthorized"` (no/stale session) or `"password_reset_required"` (player still behind the reset gate); the client surfaces both as a friendly error instead of hanging on "joining". A connected socket's player is a handshake-time snapshot, so a code re-issue doesn't kick an already-connected socket until it reconnects (accepted at friends scale). It joins one room per socket and broadcasts the full public game state on every change — at friends scale, simplicity beats deltas. Socket events are typed end-to-end via `ClientToServerEvents` / `ServerToClientEvents` in the shared protocol; the client consumes them through the `useGameRoom` hook (`client/src/lib/gameRoom.ts`), with `/game/:code` switching between the lobby and gameplay screens by game status.

## Persistence & identity

- **SQLite via `node:sqlite`** (Node's built-in driver — still flagged experimental upstream, but the surface we use is tiny and isolated in [server/src/db.ts](../server/src/db.ts); swap the driver there if it ever shifts). The database file defaults to `server/data/bingus.db` (gitignored) and is overridable with `BINGUS_DB`; tests use `:memory:`. There is no migration framework — `openDb` runs idempotent `CREATE TABLE IF NOT EXISTS` DDL plus guarded `ALTER TABLE ADD COLUMN` steps, so pre-auth database files upgrade in place on boot.
- **Players are accounts**: a globally unique name (`UNIQUE COLLATE NOCASE` — uniqueness lives in the schema, not application code) plus a scrypt password hash ([server/src/passwords.ts](../server/src/passwords.ts), `node:crypto` — no native dependency). **There is no public registration.** An admin provisions each account, which generates a one-time code (`XXXX-XXXX`, ambiguity-free alphabet) that is the account's first password — shown to the admin exactly once, stored only as a hash. Players from a pre-auth database have a `NULL` hash and cannot log in until an admin re-issues them a code.
- **The password-reset gate**: provisioned and re-issued accounts carry `needs_password_reset`. Until they set a real password via `POST /api/me/password`, the server refuses everything but `GET /api/me` (REST answers `403 password_reset_required`, the socket handshake is rejected) and the client traps them on the set-password screen.
- **Sessions are an httpOnly cookie** (`bingus_session`, a year-long token unique per player — one active session per player). The token **rotates** on every login, logout, and code re-issue, so logging in on a new device (or being re-issued a code) invalidates every other session. Client JS never sees the token. The cookie is `SameSite=Lax` and gains `Secure` when `BINGUS_SECURE_COOKIES=true` (leave it unset behind plain HTTP — browsers silently drop Secure cookies there and every login would appear to do nothing).
- **The admin**: an `is_admin` flag unlocks provisioning, the roster, and code re-issue (plus the `/admin/users` page in the client). `BINGUS_ADMIN=<name>` bootstraps it on boot ([server/src/bootstrap.ts](../server/src/bootstrap.ts)): first boot provisions the account and prints its one-time code to stdout; later boots just ensure the flag — and if the named account somehow has no password (a pre-auth database), a fresh code is printed so the admin can always get in.
- **The client validates the session on every load** via `GET /api/me` ([client/src/lib/session.tsx](../client/src/lib/session.tsx)). A 401 — no cookie, or a ghost/rotated session — lands on the login screen; nothing but login renders without a server-confirmed player. The session gate in `App.tsx` routes `needsPasswordReset` to the forced set-password screen and registers `/admin/users` only for admins (the server checks admin on the API regardless).

## Dev workflow

- The package manager is **pnpm** (`packageManager` field pins the version; workspace layout in [pnpm-workspace.yaml](../pnpm-workspace.yaml), `@bingus/shared` linked via `workspace:*`). pnpm blocks dependency build scripts by default — approvals live under `allowBuilds` in pnpm-workspace.yaml.
- `pnpm run dev` (root) runs both watchers via `pnpm -r --parallel`: `tsx watch` for the server (port 3000), Vite for the client (port 5173).
- The server runs TypeScript directly via **tsx** — its `build` script is a typecheck (`tsc --noEmit`), and prod runs `pnpm --filter @bingus/server start`. If a bundled artifact becomes worthwhile, revisit then.
- Lint is **oxlint**, configured once at the repo root ([.oxlintrc.json](../.oxlintrc.json)).
- The client routes with **react-router** (`/` home, `/boards` archive, `/boards/new` creator, `/join` live tables, `/game/:code` play, `/admin/users` admin-only). All authenticated routes render inside the signed-in branch of `App.tsx` — the session gate wraps the router, so no screen but login is reachable without a server-confirmed player, a `needsPasswordReset` session only ever sees the set-password screen, and the admin route registers only for admins.
- Tests are **vitest** per workspace (`pnpm test` at the root fans out): jsdom environment in the client, Node in server/shared.

## CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs three jobs on every push/PR: `lint`, `test`, and `build` — the same three root scripts, so CI and local always agree.

## Releases & deployment

Same architecture as omnibus: every merge to `main` cuts a release, each release publishes a Docker image, and the host just pulls `latest`.

- **Release** ([.github/workflows/release.yml](../.github/workflows/release.yml)) — on merged PR, the shared [`seamus-sloan/gh-actions/release@release-v1`](https://github.com/seamus-sloan/gh-actions) action bumps semver from the latest release (patch by default; `minor version` label for a minor bump; `no release` or unlabeled docs/CI-only PRs skip), creates the GitHub release, and dispatches the Docker workflow with the new tag.
- **Docker** ([.github/workflows/docker.yml](../.github/workflows/docker.yml)) — builds `linux/amd64` + `linux/arm64` on native runners, pushes each by digest, then merges them into one multi-arch manifest on Docker Hub as `sesloan/bingus` tagged `X.Y.Z` / `X.Y` / `X` / `latest`. Needs the `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` repo secrets.
- **Image** ([Dockerfile](../Dockerfile)) — single container: a builder stage compiles the Vite client, a deps stage installs the server's prod dependency tree, and the runtime stage serves the SPA from the server via `BINGUS_STATIC_DIR` with tsx running the TypeScript server directly (`tsx` is a runtime dependency of `@bingus/server` for exactly this reason). SQLite lives at `/data/bingus.db` on the `/data` volume; a PUID/PGID entrypoint ([docker/entrypoint.sh](../docker/entrypoint.sh)) drops root before serving; `/api/health` backs the container healthcheck.
- **Server env vars** — `PORT` (default 3000), `BINGUS_DB` (SQLite path), `BINGUS_STATIC_DIR` (client bundle, image-only), `BINGUS_ADMIN` (admin account name to bootstrap on boot — first boot prints its one-time login code to the container logs), `BINGUS_SECURE_COOKIES` (`true` only once TLS terminates in front of the server; behind plain HTTP it silently breaks logins). See [docker-compose.yml](../docker-compose.yml) for the deploy-side defaults.
- **Host** ([docker-compose.yml](../docker-compose.yml)) — pulls `sesloan/bingus:latest`, publishes port 3000, bind-mounts `./data:/data`.
