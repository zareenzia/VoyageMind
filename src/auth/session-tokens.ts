import { createHash, randomBytes } from "node:crypto";

/** 256 bits from the CSPRNG. The token is the entire credential, so it is not
 * derived from anything guessable — not the user id, not a timestamp. */
const TOKEN_BYTES = 32;

export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Only the hash is stored (D9). SHA-256 with no salt and no stretching is
 * correct here and would be wrong for a password: this input is 256 bits of
 * uniform randomness, so there is no dictionary to attack and nothing for a
 * work factor to slow down — the cost of stretching would be paid on every
 * authenticated request for no gain. What it buys is that a leaked `sessions`
 * table is a list of dead hashes rather than a set of usable cookies.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
