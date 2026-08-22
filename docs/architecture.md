# Architecture

Bingus is an npm-workspaces monorepo with three packages:

```
client/   @bingus/client — Vite + React 19 + TypeScript SPA
server/   @bingus/server — Hono (REST) + Socket.IO (realtime) on Node
shared/   @bingus/shared — the wire protocol both sides import
```

## How the frontend talks to the backend

There are exactly two channels, both terminating at the same Node process:

### 1. REST — request/response data

Everything that is not live game traffic goes over plain HTTP under `/api/*`, served by **Hono** ([server/src/app.ts](../server/src/app.ts)). This covers players, the board archive (list, search, create), health checks, and any other CRUD.

Current endpoints:

- `GET /api/health` — liveness probe.
- `POST /api/players` — sign in by claiming a unique name (case-insensitive). Returns the `Player` plus a `token`; `409 name_taken` on collision.
- `PATCH /api/players/:id` — rename. Requires `Authorization: Bearer <token>` from the create response; same `409 name_taken` on collision.

- In **dev**, the client calls same-origin paths (`fetch('/api/...')`) and the Vite dev server proxies them to `http://localhost:3000` (see [client/vite.config.ts](../client/vite.config.ts)). No CORS anywhere.
- In **prod**, the client build is static and is expected to be served from the same origin as the server, so the same same-origin calls work unchanged.

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

The server is the referee. Board shuffles are generated server-side per player (so cards can't be re-rolled and rivals' boards render consistently), and win claims are validated server-side against the marked set (row / column / diagonal / blackout). Clients render state and report intents; they never decide outcomes.

Active game state lives in memory on the single server process. Persistence lives in SQLite.

## Persistence & identity

- **SQLite via `node:sqlite`** (Node's built-in driver — still flagged experimental upstream, but the surface we use is tiny and isolated in [server/src/db.ts](../server/src/db.ts); swap the driver there if it ever shifts). The database file defaults to `server/data/bingus.db` (gitignored) and is overridable with `BINGUS_DB`; tests use `:memory:`.
- **Players** are the identity model: no accounts, just a globally unique name (enforced `UNIQUE COLLATE NOCASE` in the DB — uniqueness lives in the schema, not application code). Creating a player returns a bearer `token` that authorizes profile changes.
- **The client session** (`player` + `token`) is kept in localStorage by [client/src/lib/session.tsx](../client/src/lib/session.tsx). No session = sign-in screen; the header's profile chip edits the name via the PATCH endpoint.

## Dev workflow

- `npm run dev` (root) runs both watchers via concurrently: `tsx watch` for the server (port 3000), Vite for the client (port 5173).
- The server runs TypeScript directly via **tsx** — its `build` script is a typecheck (`tsc --noEmit`), and prod runs `npm run start -w server`. If a bundled artifact becomes worthwhile, revisit then.
- Lint is **oxlint**, configured once at the repo root ([.oxlintrc.json](../.oxlintrc.json)).
- Tests are **vitest** per workspace (`npm test` at the root fans out): jsdom environment in the client, Node in server/shared.

## CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs three jobs on every push/PR: `lint`, `test`, and `build` — the same three root scripts, so CI and local always agree.
