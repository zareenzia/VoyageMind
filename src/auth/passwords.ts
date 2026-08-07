import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * scrypt from node:crypto — standard library, no native dependency, no key.
 * D9 chose it over bcrypt/argon2 for exactly that reason.
 *
 * N=16384, r=8 costs 128 * N * r = 16 MiB per hash, which sits under Node's
 * 32 MiB default `maxmem`. Raising N past this point needs maxmem raised with
 * it or every call fails at runtime rather than at review — so the numbers are
 * encoded in the stored string, and verification uses the parameters the hash
 * was written with, not these. That is what makes them raisable later without
 * invalidating existing passwords.
 */
const PARAMS = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** `scrypt$N$r$p$salt$hash`, salt and hash base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Returns false for a wrong password AND for a malformed/unknown stored hash —
 * never throws. A parse failure here means a corrupt or foreign-format row, and
 * the only safe reading of "I cannot check this credential" is "this credential
 * did not match".
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N <= 0 || r <= 0 || p <= 0) return false;

  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptAsync(password, salt, expected.length, { N, r, p });
  } catch {
    // Parameters that parse but exceed maxmem, or are otherwise unusable.
    return false;
  }

  // Lengths are equal by construction (keylen === expected.length), but
  // timingSafeEqual throws rather than returning false on a mismatch, and a
  // throw here would escape as a 500 instead of a failed login.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * A real hash of a value no user can supply, used to spend the same scrypt work
 * on a login for an address that has no account as on one that does. Without
 * it, "unknown email" returns in microseconds while "wrong password" takes
 * ~100ms, and the difference enumerates registered addresses — which would make
 * D9's identical-response rule cosmetic. Computed once, lazily, and reused.
 */
let dummyHashPromise: Promise<string> | null = null;

export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString("hex"));
  return dummyHashPromise;
}

/** Burns one password-verification's worth of time against a hash that cannot
 * match, so a caller with no user row takes the same path as one with a user. */
export async function spendDummyVerify(password: string): Promise<false> {
  await verifyPassword(password, await getDummyHash());
  return false;
}
