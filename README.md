# Bingus

Multiplayer bingo with friends. And trash talk.

Players log in with a name and password, pick a bingo board from the archive (or print a fresh one), and play live against friends — every player is dealt their own card off the board's word bank, marks their own tiles, and races to a row, column, diagonal, or blackout. Stock a board with more terms than a card holds and players stop sharing one term list — the deeper the bank, the less two cards tend to overlap. Game chat included for the banter.

There's no public sign-up: an admin creates each account, which mints a one-time code the new player uses as their first password — their first login walks them into choosing a real one. (Dev tip: run the server with `BINGUS_ADMIN=<name>` and the first boot prints that admin's one-time code.)

## Stack

- **Client** — React 19 + TypeScript, built with Vite
- **Server** — Hono (REST) + Socket.IO (realtime) on Node, SQLite for persistence
- **Shared** — Zod-validated wire protocol used by both sides

See [docs/architecture.md](docs/architecture.md) for how the pieces talk to each other.

## Getting started

```bash
pnpm install
pnpm run dev
```

This starts the server on `http://localhost:3000` and the Vite dev server on `http://localhost:5173` (which proxies `/api` and `/socket.io` to the server). Open `http://localhost:5173`.

## Scripts

All run from the repo root:

| Script | What it does |
|---|---|
| `pnpm run dev` | Run server + client together with live reload |
| `pnpm run lint` | Lint the whole repo with oxlint |
| `pnpm test` | Run vitest suites in every workspace |
| `pnpm run build` | Build the client, typecheck server + shared |

## Layout

```
client/   Vite + React app
server/   Hono + Socket.IO server
shared/   Wire protocol (Zod schemas + Socket.IO event types)
docker/   Container entrypoint (PUID/PGID privilege drop)
docs/     Architecture and design docs
```

## Deployment

Bingus ships as a single Docker image — the server serves the built client
same-origin, with SQLite on a `/data` volume:

```bash
docker compose up -d
```

pulls `sesloan/bingus:latest` (multi-arch: amd64 + arm64) and serves on
`http://<host>:3000`. The first boot prints the admin's one-time login code
to the container logs. See [docker-compose.yml](docker-compose.yml) for the
volume, PUID/PGID, `BINGUS_ADMIN`, and `BINGUS_SECURE_COOKIES` knobs, and
[docs/architecture.md](docs/architecture.md) for the release pipeline that
publishes the image.
