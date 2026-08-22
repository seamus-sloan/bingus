import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { app } from "./app.ts";
import { attachSocket } from "./socket.ts";

const port = Number(process.env.PORT ?? 3000);

// serve() returns the underlying node:http server; Socket.IO attaches to it
// and claims /socket.io/*, Hono handles every other route.
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`bingus server listening on http://localhost:${info.port}`);
});

attachSocket(server as HttpServer);
