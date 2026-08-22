import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  ApiError,
  Board,
  CreateBoardRequest,
  CreateBoardResponse,
  CreatePlayerResponse,
  ListBoardsResponse,
  MeResponse,
} from "@bingus/shared";
import { createApp, SESSION_COOKIE } from "./app.ts";
import { BoardsRepo, openDb, PlayersRepo } from "./db.ts";

let app: Hono;

beforeEach(() => {
  const db = openDb(":memory:");
  app = createApp(new PlayersRepo(db), new BoardsRepo(db));
});

// Test-only view of a response body: success and error fields both visible,
// so assertions can reach whichever side the test expects.
type Body<T> = T & ApiError;

async function signIn(name: string) {
  const res = await app.request("/api/players", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  return {
    status: res.status,
    setCookie,
    cookie,
    body: (await res.json()) as Body<CreatePlayerResponse>,
  };
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

async function listBoards(qs = "") {
  const res = await app.request(`/api/boards${qs}`);
  return {
    status: res.status,
    body: (await res.json()) as Body<ListBoardsResponse>,
  };
}

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
    const { body } = await listBoards();
    expect(body.total).toBe(2);
    expect(body.boards.map((b) => b.name)).toEqual([
      "Meeting Mayhem",
      "Standup Standoff",
    ]);
  });

  it("requires a session to create", async () => {
    const created = await createBoard(`${SESSION_COOKIE}=bogus`);
    expect(created.status).toBe(401);
    expect(created.body.code).toBe("unauthorized");
  });

  it("rejects a term count that does not match the size", async () => {
    const { cookie } = await signIn("Ruth");
    const created = await createBoard(cookie, { size: 5 });
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
    const search = await listBoards("?search=stand");
    expect(search.body.total).toBe(2);
    const page = await listBoards("?limit=1&offset=1");
    expect(page.body.boards).toHaveLength(1);
    expect(page.body.total).toBe(3);
  });

  it("counts boards in stats", async () => {
    const { cookie } = await signIn("Ruth");
    await createBoard(cookie);
    const res = await app.request("/api/stats");
    expect(((await res.json()) as { boards: number }).boards).toBe(1);
  });
});

describe("GET /api/health", () => {
  it("reports the service as healthy", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "bingus-server" });
  });
});

describe("GET /api/stats", () => {
  it("counts signed-up players", async () => {
    await signIn("Ruth");
    await signIn("Priya");
    const res = await app.request("/api/stats");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ players: 2, boards: 0, liveGames: 0 });
  });
});

describe("POST /api/players", () => {
  it("creates a player and sets an httpOnly session cookie", async () => {
    const { status, body, setCookie } = await signIn("Ruth");
    expect(status).toBe(201);
    expect(body.player.name).toBe("Ruth");
    expect(body).not.toHaveProperty("token");
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("rejects a duplicate name, case-insensitively", async () => {
    await signIn("Ruth");
    const dupe = await signIn("ruth");
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe("name_taken");
  });

  it("rejects an invalid name", async () => {
    const { status, body } = await signIn("   ");
    expect(status).toBe(400);
    expect(body.code).toBe("invalid_name");
  });
});

describe("GET /api/me", () => {
  it("resolves the session cookie to the player", async () => {
    const { cookie, body } = await signIn("Ruth");
    const res = await me(cookie);
    expect(res.status).toBe(200);
    expect(res.body.player).toEqual(body.player);
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
