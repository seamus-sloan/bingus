import { Hono, type Context } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  CreateBoardRequestSchema,
  CreateGameRequestSchema,
  ListBoardsQuerySchema,
  LoginRequestSchema,
  ProvisionPlayerRequestSchema,
  RenamePlayerRequestSchema,
  SetPasswordRequestSchema,
  UpdateBoardRequestSchema,
  type ApiError,
  type CreateBoardResponse,
  type CreateGameResponse,
  type DeleteBoardResponse,
  type GetBoardResponse,
  type ListBoardsResponse,
  type ListGamesResponse,
  type ListPlayersResponse,
  type LoginResponse,
  type LogoutResponse,
  type MeResponse,
  type ProvisionPlayerResponse,
  type ReissueCodeResponse,
  type StatsResponse,
} from "@bingus/shared";
import type { AuthedPlayer, BoardsRepo, PlayersRepo } from "./db.ts";
import type { GameManager } from "./games.ts";
import { LoginRateLimiter } from "./rateLimit.ts";

// The session cookie holds the player's token. httpOnly keeps it out of
// reach of client-side JS; the browser sends it on every same-origin request
// (including the Socket.IO handshake, which realtime auth leans on).
export const SESSION_COOKIE = "bingus_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // a year of trash talk

export interface AppOptions {
  /** Mark the session cookie Secure (set once TLS terminates somewhere). */
  secureCookies?: boolean;
  /** Injectable for tests; defaults to 10 failures / 15 min per account. */
  loginLimiter?: LoginRateLimiter;
}

// HTTP surface: REST endpoints live here (session, players, board archive,
// health). Realtime traffic goes through Socket.IO — see socket.ts.
// `staticDir` (prod only) is the built client bundle; serving it from this
// app keeps client and API same-origin, which the whole design assumes.
export function createApp(
  players: PlayersRepo,
  boards: BoardsRepo,
  games: GameManager,
  staticDir?: string,
  opts: AppOptions = {},
) {
  const app = new Hono();
  const limiter = opts.loginLimiter ?? new LoginRateLimiter();

  const currentPlayer = (c: Context) => {
    const token = getCookie(c, SESSION_COOKIE);
    return token ? players.getByToken(token) : undefined;
  };

  // The one auth policy choke point: a valid session that is still behind
  // the password-reset gate may only touch /api/me and /api/me/password —
  // every other route funnels through here. Returns the ready-to-send
  // Response on failure so call sites stay one-liners.
  const requireActive = (c: Context): AuthedPlayer | Response => {
    const me = currentPlayer(c);
    if (!me) return c.json(unauthorized(), 401);
    if (me.needsPasswordReset) return c.json(passwordResetRequired(), 403);
    return me;
  };

  const requireAdmin = (c: Context): AuthedPlayer | Response => {
    const me = requireActive(c);
    if (me instanceof Response) return me;
    if (!me.isAdmin) return c.json(forbidden(), 403);
    return me;
  };

  const setSessionCookie = (c: Context, token: string) => {
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
      secure: opts.secureCookies === true,
    });
  };

  const meResponse = (me: AuthedPlayer): MeResponse => ({
    player: me.player,
    needsPasswordReset: me.needsPasswordReset,
    isAdmin: me.isAdmin,
  });

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "bingus-server" }),
  );

  app.get("/api/stats", (c) => {
    const me = requireActive(c);
    if (me instanceof Response) return me;
    return c.json({
      players: players.count(),
      boards: boards.count(),
      liveGames: games.liveCount(),
    } satisfies StatsResponse);
  });

  app.get("/api/boards", (c) => {
    const me = requireActive(c);
    if (me instanceof Response) return me;
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
    const me = requireActive(c);
    if (me instanceof Response) return me;
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
    const me = requireActive(c);
    if (me instanceof Response) return me;
    const found = boards.get(c.req.param("id"));
    if (!found) return c.json(boardNotFound(), 404);
    return c.json({ board: found.board } satisfies GetBoardResponse);
  });

  app.patch("/api/boards/:id", async (c) => {
    const me = requireActive(c);
    if (me instanceof Response) return me;
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

  app.delete("/api/boards/:id", (c) => {
    const me = requireActive(c);
    if (me instanceof Response) return me;
    const found = boards.get(c.req.param("id"));
    if (!found) return c.json(boardNotFound(), 404);
    if (found.createdById !== me.player.id) {
      return c.json(
        {
          code: "unauthorized",
          error: "Only the board's creator can delete it.",
        } satisfies ApiError,
        403,
      );
    }
    boards.delete(found.board.id);
    return c.json({ ok: true } satisfies DeleteBoardResponse);
  });

  app.post("/api/games", async (c) => {
    const me = requireActive(c);
    if (me instanceof Response) return me;
    const body = CreateGameRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    const found = body.success ? boards.get(body.data.boardId) : undefined;
    if (!found) return c.json(boardNotFound(), 404);
    const room = games.create(found.board, me.player);
    return c.json({ code: room.code } satisfies CreateGameResponse, 201);
  });

  app.get("/api/games", (c) => {
    const me = requireActive(c);
    if (me instanceof Response) return me;
    return c.json({ games: games.list() } satisfies ListGamesResponse);
  });

  app.post("/api/login", async (c) => {
    const body = LoginRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(invalidCredentials(), 401);
    }
    if (!limiter.attempt(body.data.name)) {
      return c.json(rateLimited(), 429);
    }
    // One 401 body for unknown-name and wrong-password alike — the login
    // form must not double as a "does this name exist?" oracle.
    const me = players.verifyLogin(body.data.name, body.data.password);
    if (!me) return c.json(invalidCredentials(), 401);
    limiter.succeed(body.data.name);
    setSessionCookie(c, me.token);
    return c.json(meResponse(me) satisfies LoginResponse);
  });

  app.post("/api/logout", (c) => {
    // Works for any cookie state — even mid-reset or already-stale sessions
    // deserve a clean exit. Rotating the token kills the session server-side;
    // clearing the cookie tidies the browser.
    const me = currentPlayer(c);
    if (me) players.rotateToken(me.player.id);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true } satisfies LogoutResponse);
  });

  // Admin only: provision an account. The one-time code in the response is
  // the only time the plaintext exists — no cookie is set; this is not a
  // sign-in.
  app.post("/api/players", async (c) => {
    const admin = requireAdmin(c);
    if (admin instanceof Response) return admin;
    const body = ProvisionPlayerRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(invalidName(body.error.issues[0]?.message), 400);
    }
    const result = players.provision(body.data.name);
    if (result === "name_taken") return c.json(nameTaken(body.data.name), 409);
    return c.json(
      {
        player: result.player,
        oneTimeCode: result.oneTimeCode,
      } satisfies ProvisionPlayerResponse,
      201,
    );
  });

  app.get("/api/players", (c) => {
    const admin = requireAdmin(c);
    if (admin instanceof Response) return admin;
    return c.json({ players: players.listAll() } satisfies ListPlayersResponse);
  });

  // Admin only: re-issue a one-time code — the locked-out-friend rescue.
  // Invalidates the player's password and any live session.
  app.post("/api/players/:id/code", (c) => {
    const admin = requireAdmin(c);
    if (admin instanceof Response) return admin;
    const result = players.reissueCode(c.req.param("id"));
    if (!result) return c.json(playerNotFound(), 404);
    return c.json(result satisfies ReissueCodeResponse);
  });

  // Exempt from the reset gate: the client needs it to learn it should show
  // the set-password screen.
  app.get("/api/me", (c) => {
    const me = currentPlayer(c);
    if (!me) return c.json(unauthorized(), 401);
    return c.json(meResponse(me) satisfies MeResponse);
  });

  // Exempt from the reset gate — it IS the reset path.
  app.post("/api/me/password", async (c) => {
    const me = currentPlayer(c);
    if (!me) return c.json(unauthorized(), 401);
    const body = SetPasswordRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(invalidPassword(body.error.issues[0]?.message), 400);
    }
    players.setPassword(me.player.id, body.data.password);
    return c.json(
      meResponse({ ...me, needsPasswordReset: false }) satisfies MeResponse,
    );
  });

  app.patch("/api/me", async (c) => {
    const me = requireActive(c);
    if (me instanceof Response) return me;
    const body = RenamePlayerRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(invalidName(body.error.issues[0]?.message), 400);
    }
    const result = players.rename(me.player.id, body.data.name);
    if (result === "name_taken") return c.json(nameTaken(body.data.name), 409);
    // Game rooms hold player snapshots — push the new name to every seat.
    games.renamePlayer(me.player.id, result.name);
    return c.json(
      meResponse({ ...me, player: result }) satisfies MeResponse,
    );
  });

  if (staticDir) {
    // API routes above always win — this middleware only sees requests none
    // of them matched. /socket.io/* never reaches Hono at all (Socket.IO
    // claims it on the raw HTTP server — see index.ts).
    app.use("*", serveStatic({ root: staticDir }));
    // SPA fallback: client-side routes (/boards, /game/:code) must survive a
    // hard refresh, so any non-API GET that didn't match a file gets
    // index.html. Unmatched /api paths keep returning JSON, not HTML.
    const spaIndex = serveStatic({ root: staticDir, path: "index.html" });
    app.get("*", async (c, next) => {
      if (c.req.path.startsWith("/api/")) {
        return c.json(
          { code: "not_found", error: "No such endpoint." } satisfies ApiError,
          404,
        );
      }
      // serveStatic yields void when the file is missing (it deferred to
      // next()); surface that as a plain 404 instead of an untyped hole.
      return (await spaIndex(c, next)) ?? c.notFound();
    });
  }

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

function playerNotFound(): ApiError {
  return { code: "not_found", error: "No player with that id." };
}

function unauthorized(): ApiError {
  return { code: "unauthorized", error: "No seat at the table. Sign in." };
}

function invalidCredentials(): ApiError {
  return {
    code: "invalid_credentials",
    error: "Name and code/password don't match.",
  };
}

function passwordResetRequired(): ApiError {
  return {
    code: "password_reset_required",
    error: "Set a new password before playing.",
  };
}

function forbidden(): ApiError {
  return { code: "forbidden", error: "Admins only back here." };
}

function invalidPassword(message: string | undefined): ApiError {
  return {
    code: "invalid_password",
    error: message ?? "That password won't fly.",
  };
}

function rateLimited(): ApiError {
  return {
    code: "rate_limited",
    error: "Too many tries. Cool off and come back.",
  };
}
