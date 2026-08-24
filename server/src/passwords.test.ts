import { describe, expect, it } from "vitest";
import { generateOneTimeCode, hashPassword, verifyPassword } from "./passwords.ts";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a password", () => {
    const stored = hashPassword("hunter22well");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("hunter22well", stored)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const stored = hashPassword("hunter22well");
    expect(verifyPassword("hunter22welt", stored)).toBe(false);
  });

  it("salts: the same password hashes differently every time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("returns false for garbage stored values instead of throwing", () => {
    for (const garbage of ["", "nonsense", "scrypt$bad", "bcrypt$x$y$z$a$b"]) {
      expect(verifyPassword("anything", garbage)).toBe(false);
    }
  });

  it("preserves whitespace as part of the password", () => {
    const stored = hashPassword(" padded ");
    expect(verifyPassword("padded", stored)).toBe(false);
    expect(verifyPassword(" padded ", stored)).toBe(true);
  });
});

describe("generateOneTimeCode", () => {
  it("emits XXXX-XXXX from the ambiguity-free alphabet", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateOneTimeCode()).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    }
  });

  it("does not repeat itself in a small sample", () => {
    const sample = new Set(Array.from({ length: 100 }, generateOneTimeCode));
    expect(sample.size).toBe(100);
  });
});
