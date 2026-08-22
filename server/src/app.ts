import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  CreateBoardRequestSchema,
  CreateGameRequestSchema,
  CreatePlayerRequestSchema,
  ListBoardsQuerySchema,
  RenamePlayerRequestSchema,
  UpdateBoardRequestSchema,
  type ApiError,
  type CreateBoardResponse,
  type CreateGameResponse,
  type CreatePlayerResponse,
  type GetBoardResponse,
  type ListBoardsResponse,
  type MeResponse,
  type StatsResponse,
} from "@bingus/shared";
import type { BoardsRepo, PlayersRepo } from "./db.ts";
import type { GameManager } from "./games.ts";

// The session cookie holds the player's token. httpOnly keeps it out of
// reach of client-side JS; the browser sends it on every same-origin request
// (including the Socket.IO handshake, which realtime auth will lean on).
export const SESSION_COOKIE = "bingus_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // a year of trash talk

// HTTP surface: REST endpoints live here (players, board archive, health).
// Realtime traffic goes through Socket.IO — see socket.ts.
export function createApp(
  players: PlayersRepo,
  boards: BoardsRepo,
  games: GameManager,
) {
  const app = new Hono();

  const currentPlayer = (c: Context) => {
    const token = getCookie(c, SESSION_COOKIE);
    return token ? players.getByToken(token) : undefined;
  };

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "bingus-server" }),
  );

  app.get("/api/stats", (c) =>
    c.json({
      players: players.count(),
      boards: boards.count(),
      liveGames: games.liveCount(),
    } satisfies StatsResponse),
  );

  app.get("/api/boards", (c) => {
    const query = ListBoardsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { code: "invalid_board", error: "Bad archive query." } satisfies ApiError,
        400,
      );
    }
    return c.json(boards.list(query.data) satisfies ListBoardsResponse);
  });

  app.post("/api/boards", async (c) => {
    const me = currentPlayer(c);
    if (!me) return c.json(unauthorized(), 401);
    const body = CreateBoardRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(
        {
          code: "invalid_board",
          error: body.error.issues[0]?.message ?? "That board won't print.",
        } satisfies ApiError,
        400,
      );
    }
    const board = boards.create(body.data, me.player.id);
    return c.json({ board } satisfies CreateBoardResponse, 201);
  });

  app.get("/api/boards/:id", (c) => {
    const found = boards.get(c.req.param("id"));
    if (!found) return c.json(boardNotFound(), 404);
    return c.json({ board: found.board } satisfies GetBoardResponse);
  });

  app.patch("/api/boards/:id", async (c) => {
    const me = currentPlayer(c);
    if (!me) return c.json(unauthorized(), 401);
    const found = boards.get(c.req.param("id"));
    if (!found) return c.json(boardNotFound(), 404);
    if (found.createdById !== me.player.id) {
      return c.json(
        {
          code: "unauthorized",
          error: "Only the board's creator can edit it.",
        } satisfies ApiError,
        403,
      );
    }
    const body = UpdateBoardRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(
        {
          code: "invalid_board",
          error: body.error.issues[0]?.message ?? "That edit won't print.",
        } satisfies ApiError,
        400,
      );
    }
    const board = boards.update(found.board.id, body.data);
    return c.json({ board } satisfies GetBoardResponse);
  });

  app.post("/api/games", async (c) => {
    const me = currentPlayer(c);
    if (!me) return c.json(unauthorized(), 401);
    const body = CreateGameRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    const found = body.success ? boards.get(body.data.boardId) : undefined;
    if (!found) return c.json(boardNotFound(), 404);
    const room = games.create(found.board, me.player);
    return c.json({ code: room.code } satisfies CreateGameResponse, 201);
  });

  app.post("/api/players", async (c) => {
    const body = CreatePlayerRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(invalidName(body.error.issues[0]?.message), 400);
    }
    const result = players.create(body.data.name);
    if (result === "name_taken") return c.json(nameTaken(body.data.name), 409);
    setCookie(c, SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return c.json({ player: result.player } satisfies CreatePlayerResponse, 201);
  });

  app.get("/api/me", (c) => {
    const me = currentPlayer(c);
    if (!me) return c.json(unauthorized(), 401);
    return c.json({ player: me.player } satisfies MeResponse);
  });

  app.patch("/api/me", async (c) => {
    const me = currentPlayer(c);
    if (!me) return c.json(unauthorized(), 401);
    const body = RenamePlayerRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(invalidName(body.error.issues[0]?.message), 400);
    }
    const result = players.rename(me.player.id, body.data.name);
    if (result === "name_taken") return c.json(nameTaken(body.data.name), 409);
    return c.json({ player: result } satisfies MeResponse);
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

function boardNotFound(): ApiError {
  return { code: "not_found", error: "No such board in the archive." };
}

function unauthorized(): ApiError {
  return { code: "unauthorized", error: "No seat at the table. Sign in." };
}
