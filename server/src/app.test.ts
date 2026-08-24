import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { BOARD_TERMS_MAX } from "@bingus/shared";
import type {
  ApiError,
  Board,
  CreateBoardRequest,
  CreateBoardResponse,
  ListBoardsResponse,
  ListPlayersResponse,
  MeResponse,
  ProvisionPlayerResponse,
  ReissueCodeResponse,
} from "@bingus/shared";
import { createApp, SESSION_COOKIE, type AppOptions } from "./app.ts";
import { bootstrapAdmin } from "./bootstrap.ts";
import { BoardsRepo, openDb, PlayersRepo } from "./db.ts";
import { GameManager } from "./games.ts";
import { LoginRateLimiter } from "./rateLimit.ts";

let app: Hono;
let games: GameManager;
let players: PlayersRepo;
let adminCookie: string;

const ADMIN_NAME = "Admin";
const PASSWORD = "hunter22well";

function makeApp(opts?: AppOptions) {
  const db = openDb(":memory:");
  games = new GameManager();
  players = new PlayersRepo(db);
  app = createApp(players, new BoardsRepo(db), games, undefined, opts);
}

beforeEach(async () => {
  makeApp();
  adminCookie = await adminSession();
});

// Test-only view of a response body: success and error fields both visible,
// so assertions can reach whichever side the test expects.
type Body<T> = T & ApiError;

async function login(name: string, password: string) {
  const res = await app.request("/api/login", {
    method: "POST",
    body: JSON.stringify({ name, password }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  return {
    status: res.status,
    setCookie,
    cookie,
    body: (await res.json()) as Body<MeResponse>,
  };
}

async function setPassword(cookie: string, password: string) {
  const res = await app.request("/api/me/password", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ password }),
  });
  return { status: res.status, body: (await res.json()) as Body<MeResponse> };
}

async function provision(cookie: string, name: string) {
  const res = await app.request("/api/players", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    setCookie,
    body: (await res.json()) as Body<ProvisionPlayerResponse>,
  };
}

/** Bootstrap the admin and walk them through their own first login. */
async function adminSession(): Promise<string> {
  const boot = bootstrapAdmin(players, ADMIN_NAME);
  if ("error" in boot || !boot.oneTimeCode) {
    throw new Error("admin bootstrap failed");
  }
  const first = await login(ADMIN_NAME, boot.oneTimeCode);
  await setPassword(first.cookie, PASSWORD);
  return first.cookie;
}

/** The full journey a friend takes: provisioned, first login, real password. */
async function signIn(name: string) {
  const prov = await provision(adminCookie, name);
  const first = await login(name, prov.body.oneTimeCode);
  await setPassword(first.cookie, PASSWORD);
  return { cookie: first.cookie, setCookie: first.setCookie, body: first.body };
}

async function me(cookie: string) {
  const res = await app.request("/api/me", { headers: { Cookie: cookie } });
  return { status: res.status, body: (await res.json()) as Body<MeResponse> };
}

async function rename(cookie: string, name: string) {
  const res = await app.request("/api/me", {
    method: "PATCH",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  return { status: res.status, body: (await res.json()) as Body<MeResponse> };
}

const TERMS8 = ["a", "b", "c", "d", "e", "f", "g", "h"];

async function createBoard(
  cookie: string,
  req: Partial<CreateBoardRequest> = {},
) {
  const res = await app.request("/api/boards", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name: "Standup Standoff", size: 3, terms: TERMS8, ...req }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Body<CreateBoardResponse>,
  };
}

async function listBoards(cookie: string, qs = "") {
  const res = await app.request(`/api/boards${qs}`, {
    headers: { Cookie: cookie },
  });
  return {
    status: res.status,
    body: (await res.json()) as Body<ListBoardsResponse>,
  };
}

const CODE_PATTERN = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

describe("POST /api/login", () => {
  it("logs in with a real password and sets the session cookie", async () => {
    await signIn("Ruth");
    const res = await login("Ruth", PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.player.name).toBe("Ruth");
    expect(res.body.needsPasswordReset).toBe(false);
    expect(res.body.isAdmin).toBe(false);
    expect(res.body).not.toHaveProperty("token");
    expect(res.setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(res.setCookie).toContain("HttpOnly");
    expect(res.setCookie).toContain("SameSite=Lax");
    expect(res.setCookie).not.toContain("Secure");
  });

  it("is case-insensitive about the name", async () => {
    await signIn("Ruth");
    const res = await login("ruth", PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.player.name).toBe("Ruth");
  });

  it("rejects a wrong password and an unknown name identically", async () => {
    await signIn("Ruth");
    const wrongPassword = await login("Ruth", "not-the-password");
    const unknownName = await login("Nobody", "whatever!");
    expect(wrongPassword.status).toBe(401);
    expect(unknownName.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownName.body);
    expect(wrongPassword.body.code).toBe("invalid_credentials");
    expect(wrongPassword.setCookie).toBe("");
  });

  it("invalidates the previous session on a fresh login", async () => {
    const first = await signIn("Ruth");
    const second = await login("Ruth", PASSWORD);
    expect(second.status).toBe(200);
    expect((await me(second.cookie)).status).toBe(200);
    expect((await me(first.cookie)).status).toBe(401);
  });
});

describe("POST /api/logout", () => {
  it("kills the session and clears the cookie", async () => {
    const { cookie } = await signIn("Ruth");
    const res = await app.request("/api/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await me(cookie)).status).toBe(401);
  });

  it("succeeds even without a session", async () => {
    const res = await app.request("/api/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("the password-reset gate", () => {
  it("gates a freshly provisioned player until they set a password", async () => {
    const prov = await provision(adminCookie, "Puck");
    const first = await login("Puck", prov.body.oneTimeCode);
    expect(first.status).toBe(200);
    expect(first.body.needsPasswordReset).toBe(true);

    // /api/me stays open — the client needs it to route to the reset screen.
    const who = await me(first.cookie);
    expect(who.status).toBe(200);
    expect(who.body.needsPasswordReset).toBe(true);

    // Everything else is shut.
    for (const blocked of [
      await createBoard(first.cookie),
      await listBoards(first.cookie),
      await rename(first.cookie, "Robin"),
    ]) {
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe("password_reset_required");
    }
  });

  it("rejects a too-short new password and keeps the gate up", async () => {
    const prov = await provision(adminCookie, "Puck");
    const first = await login("Puck", prov.body.oneTimeCode);
    const res = await setPassword(first.cookie, "short");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_password");
    expect((await createBoard(first.cookie)).status).toBe(403);
  });

  it("opens the app once a real password is set, retiring the code", async () => {
    const prov = await provision(adminCookie, "Puck");
    const first = await login("Puck", prov.body.oneTimeCode);
    const set = await setPassword(first.cookie, PASSWORD);
    expect(set.status).toBe(200);
    expect(set.body.needsPasswordReset).toBe(false);
    expect((await createBoard(first.cookie)).status).toBe(201);
    // The one-time code was the old password; it died with the reset.
    expect((await login("Puck", prov.body.oneTimeCode)).status).toBe(401);
    expect((await login("Puck", PASSWORD)).status).toBe(200);
  });
});

describe("provisioning (admin only)", () => {
  it("provisions a player and returns the one-time code, without a cookie", async () => {
    const res = await provision(adminCookie, "Ruth");
    expect(res.status).toBe(201);
    expect(res.body.player.name).toBe("Ruth");
    expect(res.body.oneTimeCode).toMatch(CODE_PATTERN);
    expect(res.setCookie).toBeNull();
  });

  it("refuses anonymous and non-admin callers", async () => {
    const anon = await provision("", "Ruth");
    expect(anon.status).toBe(401);
    const { cookie } = await signIn("Priya");
    const nonAdmin = await provision(cookie, "Ruth");
    expect(nonAdmin.status).toBe(403);
    expect(nonAdmin.body.code).toBe("forbidden");
  });

  it("rejects a duplicate name, case-insensitively", async () => {
    await provision(adminCookie, "Ruth");
    const dupe = await provision(adminCookie, "ruth");
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe("name_taken");
  });

  it("rejects an invalid name", async () => {
    const res = await provision(adminCookie, "   ");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_name");
  });

  it("lists the roster for admins only", async () => {
    await provision(adminCookie, "Ruth");
    const res = await app.request("/api/players", {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListPlayersResponse;
    expect(body.players.map((p) => p.name)).toEqual([ADMIN_NAME, "Ruth"]);
    expect(body.players[0]).toMatchObject({ isAdmin: true, needsPasswordReset: false });
    expect(body.players[1]).toMatchObject({ isAdmin: false, needsPasswordReset: true });

    const { cookie } = await signIn("Priya");
    const nonAdmin = await app.request("/api/players", {
      headers: { Cookie: cookie },
    });
    expect(nonAdmin.status).toBe(403);
  });

  it("re-issues a code: old password dies, gate re-arms, session drops", async () => {
    const { cookie, body } = await signIn("Ruth");
    const res = await app.request(`/api/players/${body.player.id}/code`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const { oneTimeCode } = (await res.json()) as ReissueCodeResponse;
    expect(oneTimeCode).toMatch(CODE_PATTERN);
    // Live session died with the token rotation.
    expect((await me(cookie)).status).toBe(401);
    // Old password is gone; the new code logs in behind the gate.
    expect((await login("Ruth", PASSWORD)).status).toBe(401);
    const fresh = await login("Ruth", oneTimeCode);
    expect(fresh.status).toBe(200);
    expect(fresh.body.needsPasswordReset).toBe(true);
  });

  it("404s a re-issue for an unknown player", async () => {
    const res = await app.request("/api/players/nope/code", {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });
});

describe("secure cookies", () => {
  it("marks the session cookie Secure when configured", async () => {
    makeApp({ secureCookies: true });
    adminCookie = await adminSession();
    await signIn("Ruth");
    const res = await login("Ruth", PASSWORD);
    expect(res.setCookie).toContain("Secure");
  });
});

describe("login rate limiting", () => {
  it("throttles per name and recovers after the window", async () => {
    let now = 0;
    makeApp({ loginLimiter: new LoginRateLimiter(3, 1_000, () => now) });
    adminCookie = await adminSession();
    await signIn("Ruth");

    for (let i = 0; i < 3; i++) {
      expect((await login("Ruth", "wrong-guess")).status).toBe(401);
    }
    const throttled = await login("Ruth", PASSWORD);
    expect(throttled.status).toBe(429);
    expect(throttled.body.code).toBe("rate_limited");
    // Other accounts are unaffected.
    expect((await login(ADMIN_NAME, PASSWORD)).status).toBe(200);
    // The window expires and the real password works again.
    now += 1_000;
    expect((await login("Ruth", PASSWORD)).status).toBe(200);
  });
});

describe("board editing", () => {
  it("fetches one board by id", async () => {
    const { cookie } = await signIn("Ruth");
    const created = await createBoard(cookie);
    const res = await app.request(`/api/boards/${created.body.board.id}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body<CreateBoardResponse>).board.name).toBe(
      "Standup Standoff",
    );
  });

  it("lets the creator edit their board", async () => {
    const { cookie } = await signIn("Ruth");
    const created = await createBoard(cookie);
    const res = await app.request(`/api/boards/${created.body.board.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie },
      body: JSON.stringify({
        name: "Standup Standoff 2",
        size: 3,
        terms: TERMS8.map((t) => t + "!"),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body<CreateBoardResponse>;
    expect(body.board.name).toBe("Standup Standoff 2");
    expect(body.board.terms).toEqual(TERMS8.map((t) => t + "!"));
  });

  it("refuses edits from anyone but the creator", async () => {
    const ruth = await signIn("Ruth");
    const created = await createBoard(ruth.cookie);
    const priya = await signIn("Priya");
    const res = await app.request(`/api/boards/${created.body.board.id}`, {
      method: "PATCH",
      headers: { Cookie: priya.cookie },
      body: JSON.stringify({ name: "Hijacked", size: 3, terms: TERMS8 }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ApiError).code).toBe("unauthorized");
  });

  it("lets the creator delete their board", async () => {
    const { cookie } = await signIn("Ruth");
    const created = await createBoard(cookie);
    const res = await app.request(`/api/boards/${created.body.board.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const list = await listBoards(cookie);
    expect(list.body.total).toBe(0);
    const gone = await app.request(`/api/boards/${created.body.board.id}`, {
      headers: { Cookie: cookie },
    });
    expect(gone.status).toBe(404);
  });

  it("refuses deletion from anyone but the creator", async () => {
    const ruth = await signIn("Ruth");
    const created = await createBoard(ruth.cookie);
    const priya = await signIn("Priya");
    const res = await app.request(`/api/boards/${created.body.board.id}`, {
      method: "DELETE",
      headers: { Cookie: priya.cookie },
    });
    expect(res.status).toBe(403);
    const noAuth = await app.request(`/api/boards/${created.body.board.id}`, {
      method: "DELETE",
    });
    expect(noAuth.status).toBe(401);
  });

  it("404s for an unknown board", async () => {
    const { cookie } = await signIn("Ruth");
    const res = await app.request("/api/boards/nope", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiError).code).toBe("not_found");
  });
});

describe("games", () => {
  it("opens a table for a board and counts it live", async () => {
    const { cookie } = await signIn("Ruth");
    const created = await createBoard(cookie);
    const res = await app.request("/api/games", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ boardId: created.body.board.id }),
    });
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    expect(code).toMatch(/^BNGS-\d{3}$/);
    expect(games.get(code)?.hostId).toBeTruthy();
    const stats = await app.request("/api/stats", {
      headers: { Cookie: cookie },
    });
    expect(((await stats.json()) as { liveGames: number }).liveGames).toBe(1);
  });

  it("requires a session and a real board", async () => {
    const noAuth = await app.request("/api/games", {
      method: "POST",
      body: JSON.stringify({ boardId: "x" }),
    });
    expect(noAuth.status).toBe(401);
    const { cookie } = await signIn("Ruth");
    const badBoard = await app.request("/api/games", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ boardId: "nope" }),
    });
    expect(badBoard.status).toBe(404);
  });

  it("lists joinable tables", async () => {
    const { cookie } = await signIn("Ruth");
    const created = await createBoard(cookie);
    const opened = await app.request("/api/games", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ boardId: created.body.board.id }),
    });
    const { code } = (await opened.json()) as { code: string };
    const res = await app.request("/api/games", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const { games: list } = (await res.json()) as {
      games: { code: string; hostName: string; status: string }[];
    };
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      code,
      hostName: "Ruth",
      status: "lobby",
    });
  });

  it("propagates a profile rename into live game seats", async () => {
    const { cookie } = await signIn("Ruth");
    const created = await createBoard(cookie);
    const res = await app.request("/api/games", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ boardId: created.body.board.id }),
    });
    const { code } = (await res.json()) as { code: string };
    await rename(cookie, "TileSlayer");
    const seat = games.get(code)!.toState().players[0]!;
    expect(seat.player.name).toBe("TileSlayer");
  });
});

describe("boards", () => {
  it("creates a board and lists it newest-first", async () => {
    const { cookie } = await signIn("Ruth");
    const created = await createBoard(cookie);
    expect(created.status).toBe(201);
    const board: Board = created.body.board;
    expect(board.name).toBe("Standup Standoff");
    expect(board.createdBy).toBe("Ruth");
    expect(board.plays).toBe(0);
    await createBoard(cookie, { name: "Meeting Mayhem" });
    const { body } = await listBoards(cookie);
    expect(body.total).toBe(2);
    expect(body.boards.map((b) => b.name)).toEqual([
      "Meeting Mayhem",
      "Standup Standoff",
    ]);
  });

  it("requires a session to create or browse", async () => {
    const created = await createBoard(`${SESSION_COOKIE}=bogus`);
    expect(created.status).toBe(401);
    expect(created.body.code).toBe("unauthorized");
    const list = await listBoards(`${SESSION_COOKIE}=bogus`);
    expect(list.status).toBe(401);
  });

  it("rejects a word bank too small to fill a card", async () => {
    const { cookie } = await signIn("Ruth");
    const created = await createBoard(cookie, { size: 5 });
    expect(created.status).toBe(400);
    expect(created.body.code).toBe("invalid_board");
  });

  it("accepts a word bank deeper than the card", async () => {
    const { cookie } = await signIn("Ruth");
    const terms = Array.from({ length: 40 }, (_, i) => `term ${i}`);
    const created = await createBoard(cookie, { size: 3, terms });
    expect(created.status).toBe(201);
    expect(created.body.board.terms).toHaveLength(40);
  });

  it("rejects a word bank over the cap", async () => {
    const { cookie } = await signIn("Ruth");
    const terms = Array.from(
      { length: BOARD_TERMS_MAX + 1 },
      (_, i) => `term ${i}`,
    );
    const created = await createBoard(cookie, { size: 3, terms });
    expect(created.status).toBe(400);
    expect(created.body.code).toBe("invalid_board");
  });

  it("rejects duplicate terms", async () => {
    const { cookie } = await signIn("Ruth");
    const created = await createBoard(cookie, {
      terms: ["a", "b", "c", "d", "e", "f", "g", "A"],
    });
    expect(created.status).toBe(400);
    expect(created.body.code).toBe("invalid_board");
  });

  it("searches and paginates", async () => {
    const { cookie } = await signIn("Ruth");
    await createBoard(cookie, { name: "Standup Standoff" });
    await createBoard(cookie, { name: "Meeting Mayhem" });
    await createBoard(cookie, { name: "Stand and Deliver" });
    const search = await listBoards(cookie, "?search=stand");
    expect(search.body.total).toBe(2);
    const page = await listBoards(cookie, "?limit=1&offset=1");
    expect(page.body.boards).toHaveLength(1);
    expect(page.body.total).toBe(3);
  });

  it("counts boards in stats", async () => {
    const { cookie } = await signIn("Ruth");
    await createBoard(cookie);
    const res = await app.request("/api/stats", {
      headers: { Cookie: cookie },
    });
    expect(((await res.json()) as { boards: number }).boards).toBe(1);
  });
});

describe("GET /api/health", () => {
  it("reports the service as healthy without a session", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "bingus-server" });
  });
});

describe("GET /api/stats", () => {
  it("counts provisioned players (admin included)", async () => {
    const { cookie } = await signIn("Ruth");
    await signIn("Priya");
    const res = await app.request("/api/stats", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ players: 3, boards: 0, liveGames: 0 });
  });

  it("requires a session", async () => {
    const res = await app.request("/api/stats");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/me", () => {
  it("resolves the session cookie to the player with their flags", async () => {
    const { cookie, body } = await signIn("Ruth");
    const res = await me(cookie);
    expect(res.status).toBe(200);
    expect(res.body.player).toEqual(body.player);
    expect(res.body.needsPasswordReset).toBe(false);
    expect(res.body.isAdmin).toBe(false);
  });

  it("reports the admin flag for the admin", async () => {
    const res = await me(adminCookie);
    expect(res.body.isAdmin).toBe(true);
  });

  it("401s without a cookie", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
    expect(((await res.json()) as ApiError).code).toBe("unauthorized");
  });

  it("401s for a ghost session whose player no longer exists", async () => {
    const res = await me(`${SESSION_COOKIE}=no-such-token`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthorized");
  });
});

describe("PATCH /api/me", () => {
  it("renames the signed-in player", async () => {
    const { cookie, body } = await signIn("Ruth");
    const renamed = await rename(cookie, "TileSlayer");
    expect(renamed.status).toBe(200);
    expect(renamed.body.player).toEqual({
      id: body.player.id,
      name: "TileSlayer",
    });
  });

  it("allows changing only the casing of your own name", async () => {
    const { cookie } = await signIn("ruth");
    const renamed = await rename(cookie, "Ruth");
    expect(renamed.status).toBe(200);
    expect(renamed.body.player.name).toBe("Ruth");
  });

  it("rejects renaming to a name another player holds", async () => {
    await signIn("Priya");
    const { cookie } = await signIn("Ruth");
    const renamed = await rename(cookie, "priya");
    expect(renamed.status).toBe(409);
    expect(renamed.body.code).toBe("name_taken");
  });

  it("rejects an invalid name", async () => {
    const { cookie } = await signIn("Ruth");
    const renamed = await rename(cookie, "   ");
    expect(renamed.status).toBe(400);
    expect(renamed.body.code).toBe("invalid_name");
  });

  it("401s without a valid session", async () => {
    const renamed = await rename(`${SESSION_COOKIE}=bogus`, "Sneaky");
    expect(renamed.status).toBe(401);
    expect(renamed.body.code).toBe("unauthorized");
  });
});

describe("static client serving (prod)", () => {
  let staticApp: Hono;
  let staticDir: string;

  beforeEach(() => {
    staticDir = mkdtempSync(join(tmpdir(), "bingus-static-"));
    writeFileSync(join(staticDir, "index.html"), "<html>bingus shell</html>");
    writeFileSync(join(staticDir, "app.js"), "console.log('bingus')");
    const db = openDb(":memory:");
    staticApp = createApp(
      new PlayersRepo(db),
      new BoardsRepo(db),
      new GameManager(),
      staticDir,
    );
  });

  afterEach(() => {
    rmSync(staticDir, { recursive: true, force: true });
  });

  it("serves files from the static dir", async () => {
    const res = await staticApp.request("/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log('bingus')");
  });

  it("serves index.html at the root", async () => {
    const res = await staticApp.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>bingus shell</html>");
  });

  it("falls back to index.html for client-side routes", async () => {
    const res = await staticApp.request("/game/BNGS-123");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>bingus shell</html>");
  });

  it("keeps API routes winning over static files", async () => {
    const res = await staticApp.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "bingus-server" });
  });

  it("404s unknown API paths with JSON, not the SPA shell", async () => {
    const res = await staticApp.request("/api/nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiError).code).toBe("not_found");
  });

  it("serves nothing extra when no static dir is configured", async () => {
    const res = await app.request("/game/BNGS-123");
    expect(res.status).toBe(404);
  });
});
