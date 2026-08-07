import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.js";

describe("hashPassword / verifyPassword", () => {
  it("accepts the password it hashed", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password, including one differing by a single character", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
    expect(await verifyPassword("Correct horse battery staple", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("records the parameters it used, so they can be raised without invalidating stored hashes", async () => {
    const stored = await hashPassword("whatever");
    expect(stored.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(stored.split("$")).toHaveLength(6);
  });

  it("verifies against the parameters in the stored string, not the current defaults", async () => {
    // Written as if by an older, cheaper configuration. If verification used
    // today's PARAMS instead of the stored ones, every pre-existing password in
    // the database would stop working the moment the cost was raised.
    const cheap = "scrypt$1024$8$1$";
    const { scrypt } = await import("node:crypto");
    const derived = await new Promise<Buffer>((resolve, reject) => {
      scrypt("legacy password", Buffer.from("salt-bytes"), 64, { N: 1024, r: 8, p: 1 }, (err, key) =>
        err ? reject(err) : resolve(key),
      );
    });
    const stored = cheap + Buffer.from("salt-bytes").toString("base64") + "$" + derived.toString("base64");

    expect(await verifyPassword("legacy password", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  /**
   * A corrupt or foreign-format row must fail the login, not the request. A
   * throw here would surface as a 500 and, worse, would distinguish "this
   * account has an unreadable hash" from "wrong password".
   */
  it("returns false rather than throwing for malformed stored hashes", async () => {
    for (const bad of [
      "",
      "not-a-hash",
      "scrypt$16384$8$1$onlyfiveparts",
      "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
      "scrypt$notanumber$8$1$c2FsdA==$aGFzaA==",
      "scrypt$0$8$1$c2FsdA==$aGFzaA==",
      "scrypt$-1$8$1$c2FsdA==$aGFzaA==",
      "scrypt$16384$8$1$$aGFzaA==",
      "scrypt$16384$8$1$c2FsdA==$",
      // Parses fine, but 2^30 blows past Node's default maxmem — must be a
      // failed login, not an uncaught error.
      "scrypt$1073741824$8$1$c2FsdA==$aGFzaA==",
    ]) {
      expect(await verifyPassword("anything", bad), `expected false for ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});
