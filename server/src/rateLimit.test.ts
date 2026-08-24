import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "./rateLimit.ts";

describe("LoginRateLimiter", () => {
  it("allows up to max attempts per window, then throttles", () => {
    const limiter = new LoginRateLimiter(3, 1_000, () => 0);
    expect(limiter.attempt("ruth")).toBe(true);
    expect(limiter.attempt("ruth")).toBe(true);
    expect(limiter.attempt("ruth")).toBe(true);
    expect(limiter.attempt("ruth")).toBe(false);
  });

  it("keys case-insensitively and per account", () => {
    const limiter = new LoginRateLimiter(1, 1_000, () => 0);
    expect(limiter.attempt("Ruth")).toBe(true);
    expect(limiter.attempt("ruth")).toBe(false);
    expect(limiter.attempt("priya")).toBe(true);
  });

  it("forgets an account after the window passes", () => {
    let now = 0;
    const limiter = new LoginRateLimiter(1, 1_000, () => now);
    expect(limiter.attempt("ruth")).toBe(true);
    expect(limiter.attempt("ruth")).toBe(false);
    now = 1_000;
    expect(limiter.attempt("ruth")).toBe(true);
  });

  it("clears the window on success", () => {
    const limiter = new LoginRateLimiter(2, 1_000, () => 0);
    limiter.attempt("ruth");
    limiter.attempt("ruth");
    limiter.succeed("Ruth");
    expect(limiter.attempt("ruth")).toBe(true);
  });
});
