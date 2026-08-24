import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdmin } from "./bootstrap.ts";
import { openDb, PlayersRepo } from "./db.ts";

let players: PlayersRepo;

beforeEach(() => {
  players = new PlayersRepo(openDb(":memory:"));
});

describe("bootstrapAdmin", () => {
  it("provisions a new admin and returns a one-time code", () => {
    const result = bootstrapAdmin(players, "Seamus");
    expect(result).toMatchObject({ name: "Seamus", created: true });
    if ("error" in result || !result.oneTimeCode) {
      throw new Error("expected a one-time code");
    }
    expect(result.oneTimeCode).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    const found = players.findByName("Seamus");
    expect(found?.isAdmin).toBe(true);
    expect(found?.needsPasswordReset).toBe(true);
    expect(players.verifyLogin("Seamus", result.oneTimeCode)).toBeTruthy();
  });

  it("is idempotent: a second boot issues nothing new", () => {
    const first = bootstrapAdmin(players, "Seamus");
    if ("error" in first || !first.oneTimeCode) throw new Error("bootstrap failed");
    players.setPassword(players.findByName("Seamus")!.player.id, "hunter22well");
    const second = bootstrapAdmin(players, "Seamus");
    expect(second).toEqual({ name: "Seamus", created: false });
    // The set password survived untouched.
    expect(players.verifyLogin("Seamus", "hunter22well")).toBeTruthy();
  });

  it("rescues a pre-auth player row with no password", () => {
    // Simulate a database from before auth existed: the row is there (via
    // provision) but its hash has been nulled like a legacy row's would be.
    const provisioned = players.provision("Seamus");
    if (provisioned === "name_taken") throw new Error("setup failed");
    players["db"]
      .prepare("UPDATE players SET password_hash = NULL WHERE id = ?")
      .run(provisioned.player.id);

    const result = bootstrapAdmin(players, "Seamus");
    expect(result).toMatchObject({ name: "Seamus", created: false });
    if ("error" in result) throw new Error("unexpected error");
    expect(result.oneTimeCode).toBeDefined();
    expect(players.findByName("Seamus")?.isAdmin).toBe(true);
    expect(players.verifyLogin("Seamus", result.oneTimeCode!)).toBeTruthy();
  });

  it("matches the admin name case-insensitively", () => {
    bootstrapAdmin(players, "Seamus");
    const again = bootstrapAdmin(players, "seamus");
    expect(again).toMatchObject({ created: false });
    // Still exactly one player.
    expect(players.count()).toBe(1);
  });

  it("rejects an invalid name without touching the database", () => {
    const result = bootstrapAdmin(players, "   ");
    expect("error" in result).toBe(true);
    expect(players.count()).toBe(0);
  });
});
