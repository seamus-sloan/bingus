import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  BOARD_TERMS_MAX,
  CreateBoardRequestSchema,
  MeResponseSchema,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PasswordSchema,
  PLAYER_NAME_MAX,
  PlayerNameSchema,
  termsRequired,
} from "./protocol.ts";

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

describe("PasswordSchema", () => {
  it("enforces the length bounds", () => {
    expect(PasswordSchema.safeParse("x".repeat(PASSWORD_MIN - 1)).success).toBe(false);
    expect(PasswordSchema.safeParse("x".repeat(PASSWORD_MIN)).success).toBe(true);
    expect(PasswordSchema.safeParse("x".repeat(PASSWORD_MAX + 1)).success).toBe(false);
  });

  it("does not trim — whitespace is part of the password", () => {
    expect(PasswordSchema.parse("  spaced  ")).toBe("  spaced  ");
  });
});

describe("MeResponseSchema", () => {
  it("defaults the private flags so bare {player} payloads still parse", () => {
    const me = MeResponseSchema.parse({ player: { id: "p1", name: "Ruth" } });
    expect(me.needsPasswordReset).toBe(false);
    expect(me.isAdmin).toBe(false);
  });
});

describe("ApiErrorSchema", () => {
  it("accepts the auth error codes", () => {
    for (const code of [
      "invalid_credentials",
      "password_reset_required",
      "forbidden",
      "invalid_password",
      "rate_limited",
    ]) {
      expect(ApiErrorSchema.safeParse({ code, error: "nope" }).success).toBe(true);
    }
  });
});

describe("CreateBoardRequestSchema", () => {
  const bank = (n: number) => Array.from({ length: n }, (_, i) => `term ${i}`);
  const board = (terms: string[]) => ({ name: "Standup", size: 3 as const, terms });

  it("accepts a bank sized exactly to the card", () => {
    expect(CreateBoardRequestSchema.safeParse(board(bank(termsRequired(3)))).success).toBe(
      true,
    );
  });

  it("accepts a bank deeper than the card", () => {
    expect(CreateBoardRequestSchema.safeParse(board(bank(60))).success).toBe(true);
  });

  it("rejects a bank too small to fill a card", () => {
    const short = CreateBoardRequestSchema.safeParse(
      board(bank(termsRequired(3) - 1)),
    );
    expect(short.success).toBe(false);
  });

  it("rejects a bank over the cap", () => {
    expect(
      CreateBoardRequestSchema.safeParse(board(bank(BOARD_TERMS_MAX + 1))).success,
    ).toBe(false);
    expect(
      CreateBoardRequestSchema.safeParse(board(bank(BOARD_TERMS_MAX))).success,
    ).toBe(true);
  });

  it("still rejects duplicates, however deep the bank", () => {
    const dupes = [...bank(30), "term 0"];
    expect(CreateBoardRequestSchema.safeParse(board(dupes)).success).toBe(false);
  });
});
