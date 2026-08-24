import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { createApp } from "./app.ts";
import { BoardsRepo, openDb, PlayersRepo } from "./db.ts";
import { GameManager } from "./games.ts";
import { attachSocket } from "./socket.ts";

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.BINGUS_DB ?? "data/bingus.db";
// Prod (Docker) points this at the built client bundle so the server serves
// the SPA same-origin; unset in dev, where Vite serves the client and proxies.
const staticDir = process.env.BINGUS_STATIC_DIR;
if (staticDir && !existsSync(staticDir)) {
  console.warn(`BINGUS_STATIC_DIR '${staticDir}' does not exist; API only.`);
}

const db = openDb(dbPath);
const players = new PlayersRepo(db);
const boards = new BoardsRepo(db);
const games = new GameManager();
const app = createApp(players, boards, games, staticDir);

// serve() returns the underlying node:http server; Socket.IO attaches to it
// and claims /socket.io/*, Hono handles every other route.
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`bingus server listening on http://localhost:${info.port}`);
});

attachSocket(server as HttpServer, { players, boards, games });
