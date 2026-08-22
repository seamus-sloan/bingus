# Bingus

Multiplayer bingo with friends. And trash talk.

Players sign in with just a name, pick a bingo board from the archive (or print a fresh one), and play live against friends — everyone gets the same terms shuffled into their own card, marks their own tiles, and races to a row, column, diagonal, or blackout. Game chat included for the banter.

## Stack

- **Client** — React 19 + TypeScript, built with Vite
- **Server** — Hono (REST) + Socket.IO (realtime) on Node
- **Shared** — Zod-validated wire protocol used by both sides

See [docs/architecture.md](docs/architecture.md) for how the pieces talk to each other.

## Getting started

```bash
npm install
npm run dev
```

This starts the server on `http://localhost:3000` and the Vite dev server on `http://localhost:5173` (which proxies `/api` and `/socket.io` to the server). Open `http://localhost:5173`.

## Scripts

All run from the repo root:

| Script | What it does |
|---|---|
| `npm run dev` | Run server + client together with live reload |
| `npm run lint` | Lint the whole repo with oxlint |
| `npm test` | Run vitest suites in every workspace |
| `npm run build` | Build the client, typecheck server + shared |

## Layout

```
client/   Vite + React app
server/   Hono + Socket.IO server
shared/   Wire protocol (Zod schemas + Socket.IO event types)
docs/     Architecture and design docs
```
