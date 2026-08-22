import { Hono } from "hono";

// HTTP surface: REST endpoints live here (board archive, search, health).
// Realtime traffic goes through Socket.IO — see socket.ts.
export const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true, service: "bingus-server" }));
