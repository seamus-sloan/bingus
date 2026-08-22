import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { createApp } from "./app.ts";
import { openDb, PlayersRepo } from "./db.ts";
import { attachSocket } from "./socket.ts";

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.BINGUS_DB ?? "data/bingus.db";

const app = createApp(new PlayersRepo(openDb(dbPath)));

// serve() returns the underlying node:http server; Socket.IO attaches to it
// and claims /socket.io/*, Hono handles every other route.
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`bingus server listening on http://localhost:${info.port}`);
});

attachSocket(server as HttpServer);
