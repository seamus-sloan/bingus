import { Hono } from "hono";
import {
  CreatePlayerRequestSchema,
  RenamePlayerRequestSchema,
  type ApiError,
  type CreatePlayerResponse,
  type RenamePlayerResponse,
} from "@bingus/shared";
import type { PlayersRepo } from "./db.ts";

// HTTP surface: REST endpoints live here (players, board archive, health).
// Realtime traffic goes through Socket.IO — see socket.ts.
export function createApp(players: PlayersRepo) {
  const app = new Hono();

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "bingus-server" }),
  );

  app.post("/api/players", async (c) => {
    const body = CreatePlayerRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(invalidName(body.error.issues[0]?.message), 400);
    }
    const result = players.create(body.data.name);
    if (result === "name_taken") return c.json(nameTaken(body.data.name), 409);
    return c.json(result satisfies CreatePlayerResponse, 201);
  });

  app.patch("/api/players/:id", async (c) => {
    const id = c.req.param("id");
    const existing = players.get(id);
    if (!existing) {
      return c.json(
        { code: "not_found", error: "No such player." } satisfies ApiError,
        404,
      );
    }
    const token = c.req.header("Authorization")?.replace(/^Bearer /, "");
    if (token !== existing.token) {
      return c.json(
        { code: "unauthorized", error: "That's not your name to change." } satisfies ApiError,
        401,
      );
    }
    const body = RenamePlayerRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(invalidName(body.error.issues[0]?.message), 400);
    }
    const result = players.rename(id, body.data.name);
    if (result === "name_taken") return c.json(nameTaken(body.data.name), 409);
    return c.json({ player: result } satisfies RenamePlayerResponse);
  });

  return app;
}

function invalidName(message: string | undefined): ApiError {
  return { code: "invalid_name", error: message ?? "That name won't fly." };
}

function nameTaken(name: string): ApiError {
  return {
    code: "name_taken",
    error: `"${name}" is taken. Choose more wisely.`,
  };
}
