import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  ApiError,
  CreatePlayerResponse,
  RenamePlayerResponse,
} from "@bingus/shared";
import { createApp } from "./app.ts";
import { openDb, PlayersRepo } from "./db.ts";

let app: Hono;

beforeEach(() => {
  app = createApp(new PlayersRepo(openDb(":memory:")));
});

// Test-only view of a response body: success and error fields both visible,
// so assertions can reach whichever side the test expects.
type Body<T> = T & ApiError;

async function signIn(name: string) {
  const res = await app.request("/api/players", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Body<CreatePlayerResponse>,
  };
}

async function rename(id: string, token: string, name: string) {
  const res = await app.request(`/api/players/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Body<RenamePlayerResponse>,
  };
}

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
  it("creates a player and returns a token", async () => {
    const { status, body } = await signIn("Ruth");
    expect(status).toBe(201);
    expect(body.player.name).toBe("Ruth");
    expect(body.player.id).toBeTruthy();
    expect(body.token).toBeTruthy();
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

describe("PATCH /api/players/:id", () => {
  it("renames the player with a valid token", async () => {
    const { body } = await signIn("Ruth");
    const renamed = await rename(body.player.id, body.token, "TileSlayer");
    expect(renamed.status).toBe(200);
    expect(renamed.body.player).toEqual({
      id: body.player.id,
      name: "TileSlayer",
    });
  });

  it("allows changing only the casing of your own name", async () => {
    const { body } = await signIn("ruth");
    const renamed = await rename(body.player.id, body.token, "Ruth");
    expect(renamed.status).toBe(200);
    expect(renamed.body.player.name).toBe("Ruth");
  });

  it("rejects renaming to a name another player holds", async () => {
    await signIn("Priya");
    const { body } = await signIn("Ruth");
    const renamed = await rename(body.player.id, body.token, "priya");
    expect(renamed.status).toBe(409);
    expect(renamed.body.code).toBe("name_taken");
  });

  it("rejects a wrong token", async () => {
    const { body } = await signIn("Ruth");
    const renamed = await rename(body.player.id, "not-the-token", "Sneaky");
    expect(renamed.status).toBe(401);
    expect(renamed.body.code).toBe("unauthorized");
  });

  it("404s for an unknown player", async () => {
    const renamed = await rename("nope", "token", "Ghost");
    expect(renamed.status).toBe(404);
    expect(renamed.body.code).toBe("not_found");
  });
});
