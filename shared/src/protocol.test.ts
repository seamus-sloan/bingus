import { describe, expect, it } from "vitest";
import { PLAYER_NAME_MAX, PlayerNameSchema } from "./protocol.ts";

describe("PlayerNameSchema", () => {
  it("accepts a normal name and trims whitespace", () => {
    expect(PlayerNameSchema.parse("  Ruth ")).toBe("Ruth");
  });

  it("rejects an empty name", () => {
    expect(PlayerNameSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects a name over the length cap", () => {
    const name = "x".repeat(PLAYER_NAME_MAX + 1);
    expect(PlayerNameSchema.safeParse(name).success).toBe(false);
  });
});
