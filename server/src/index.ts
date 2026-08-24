import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { createApp } from "./app.ts";
import { bootstrapAdmin } from "./bootstrap.ts";
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
// Mark the session cookie Secure once TLS terminates in front of the server.
// Off by default: behind plain HTTP a Secure cookie is silently dropped and
// every login appears to do nothing.
const secureCookies = process.env.BINGUS_SECURE_COOKIES === "true";

const db = openDb(dbPath);
const players = new PlayersRepo(db);
const boards = new BoardsRepo(db);
const games = new GameManager();

// BINGUS_ADMIN names the admin account. Provisioned on first boot (the
// printed one-time code is the admin's first login); later boots just make
// sure the flag is set.
const adminName = process.env.BINGUS_ADMIN;
if (adminName) {
  const result = bootstrapAdmin(players, adminName);
  if ("error" in result) {
    console.error(`BINGUS_ADMIN: ${result.error}`);
  } else if (result.oneTimeCode) {
    console.log(
      [
        "=".repeat(60),
        result.created
          ? `BINGUS_ADMIN: provisioned NEW admin "${result.name}"`
          : `BINGUS_ADMIN: issued a login code for existing admin "${result.name}"`,
        `One-time code (shown once, log in with it as your password):`,
        `    ${result.oneTimeCode}`,
        "=".repeat(60),
      ].join("\n"),
    );
  }
}

const app = createApp(players, boards, games, staticDir, { secureCookies });

// serve() returns the underlying node:http server; Socket.IO attaches to it
// and claims /socket.io/*, Hono handles every other route.
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`bingus server listening on http://localhost:${info.port}`);
});

attachSocket(server as HttpServer, { players, boards, games });
