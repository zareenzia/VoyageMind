import { randomBytes } from "node:crypto";

/** 192 bits, URL-safe. A share token is the entire credential for reading the
 * trip it unlocks, so it is CSPRNG output and not derived from the trip id —
 * a token you can compute from the id you are trying to read protects nothing. */
export function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}
