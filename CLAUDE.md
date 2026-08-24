# Bingus

Multiplayer bingo web app: password login with admin-provisioned accounts (no public registration — one-time codes, forced first-login password set), board archive + board creator, live game tables with per-player cards dealt off the board's word bank, self-marked tiles, row/column/diagonal/blackout wins, and game chat.

**Read [docs/architecture.md](docs/architecture.md) before touching client↔server communication.** It defines the two channels (Hono REST under `/api`, Socket.IO for realtime) and the shared-protocol rule.

## Commands (run from repo root)

- `pnpm run dev` — server (:3000) + client (:5173) with live reload
- `pnpm run lint` — oxlint over the whole repo
- `pnpm test` — vitest in every workspace
- `pnpm run build` — client build + server/shared typecheck

## Layout

pnpm workspaces: `client/` (Vite + React 19 + TS), `server/` (Hono + Socket.IO on Node, run via tsx; SQLite via node:sqlite in `server/data/`), `shared/` (`@bingus/shared` — the wire protocol). Deployment: single Docker image (`sesloan/bingus`, published per release — see the "Releases & deployment" section of [docs/architecture.md](docs/architecture.md)).

## Non-negotiable conventions

- **One definition per type, and it lives in `@bingus/shared`.** Any domain type used by more than one package — or by both code and tests — is defined once in `shared/` and imported everywhere (`client/`, `server/`, and all `*.test.ts(x)` files). Never redeclare a shape locally, never hand-write a "test copy" of a type, never let a frontend and backend version of the same concept drift apart. Prefer deriving types from Zod schemas (`z.infer`) so runtime validation and static types share a single source.
- **All wire messages are defined in `shared/src/protocol.ts`** — Zod schema + entry in `ClientToServerEvents` / `ServerToClientEvents`. Never define an event name or payload shape inline in client or server code. Protocol first, then both ends.
- **Server validates every inbound payload** with its Zod schema before acting. Never trust client data.
- **The server is authoritative** for game outcomes: cards are dealt server-side, wins are validated server-side. Clients render and report intents.
- Tests live next to the code (`*.test.ts` / `*.test.tsx`) and run under vitest.

## Docs

Keep `README.md`, this file, and `docs/` in sync with reality when you change structure, commands, or architecture — see `.claude/rules/99-end-of-session.md`.
