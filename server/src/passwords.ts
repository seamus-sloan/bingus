import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt from node:crypto — no native dependency, same spirit as node:sqlite.
// Stored strings carry their own parameters (scrypt$N$r$p$salt$hash, base64)
// so future cost bumps don't invalidate old hashes.

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/** Constant-time check against a stored hash. Garbage input → false, never a throw. */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
    if (algo !== "scrypt" || !n || !r || !p || !saltB64 || !hashB64) {
      return false;
    }
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// One-time codes double as first passwords. Alphabet drops 0/O/1/I/L so a
// code survives being read aloud or scrawled on a sticky note. Not the
// BNGS-nnn shape — that's a game code, and the two must never look alike.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateOneTimeCode(): string {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const chunk = () => Array.from({ length: 4 }, pick).join("");
  return `${chunk()}-${chunk()}`;
}
