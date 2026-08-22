import { describe, expect, it } from "vitest";
import { HelloSchema, PLAYER_NAME_MAX } from "./protocol.ts";

describe("HelloSchema", () => {
  it("accepts a normal name and trims whitespace", () => {
    expect(HelloSchema.parse({ name: "  Ruth " })).toEqual({ name: "Ruth" });
  });

  it("rejects an empty name", () => {
    expect(HelloSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a name over the length cap", () => {
    const name = "x".repeat(PLAYER_NAME_MAX + 1);
    expect(HelloSchema.safeParse({ name }).success).toBe(false);
  });
});
