import { describe, expect, it } from "vitest";
import { LIMITS } from "../config.js";
import { InMemoryAuthStore } from "./in-memory-store.js";
import { LoginAttemptTracker } from "./login-attempts.js";
import { AuthService } from "./service.js";
import { hashSessionToken } from "./session-tokens.js";

const PASSWORD = "a-long-enough-password";

function makeService(options: { max?: number; now?: () => Date } = {}) {
  const store = new InMemoryAuthStore();
  const clock = options.now ?? (() => new Date());
  const tracker = new LoginAttemptTracker(options.max ?? LIMITS.maxLoginAttempts, 60_000, () => clock().getTime());
  return { store, service: new AuthService(store, tracker, clock) };
}

describe("AuthService — signup", () => {
  it("creates an account and signs it in", async () => {
    const { service } = makeService();

    const result = await service.signup("traveller@example.test", PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.user.email).toBe("traveller@example.test");

    expect((await service.authenticate(result.session.token))?.id).toBe(result.user.id);
  });

  it("normalises the email, so case and padding don't create a second account", async () => {
    const { service } = makeService();
    await service.signup("  Traveller@Example.TEST  ", PASSWORD);

    const duplicate = await service.signup("traveller@example.test", PASSWORD);
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error("expected email_taken");
    expect(duplicate.reason).toBe("email_taken");

    // ...and the normalised form is what logs in.
    expect((await service.login("TRAVELLER@example.test", PASSWORD)).ok).toBe(true);
  });

  it("rejects an implausible email", async () => {
    const { service } = makeService();
    for (const bad of ["", "no-at-sign", "two@@ats.test", "@nolocal.test", "no@domain", "spaces in@x.test"]) {
      const result = await service.signup(bad, PASSWORD);
      expect(result.ok, `expected ${JSON.stringify(bad)} to be rejected`).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_email");
    }
  });

  it("rejects a password shorter than the configured minimum", async () => {
    const { service } = makeService();
    const short = "x".repeat(LIMITS.minPasswordLength - 1);

    const result = await service.signup("traveller@example.test", short);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected weak_password");
    expect(result.reason).toBe("weak_password");
  });

  /** The plaintext token exists only in the cookie. A database dump has to be a
   * set of dead hashes, not a set of usable sessions (D9). */
  it("stores only a hash of the session token", async () => {
    const { store, service } = makeService();
    const result = await service.signup("traveller@example.test", PASSWORD);
    if (!result.ok) throw new Error(result.reason);

    expect(await store.findValidSession(result.session.token, new Date())).toBeNull();
    expect(await store.findValidSession(hashSessionToken(result.session.token), new Date())).not.toBeNull();
  });

  it("never stores the password itself", async () => {
    const { store, service } = makeService();
    await service.signup("traveller@example.test", PASSWORD);

    const user = await store.findUserByEmail("traveller@example.test");
    expect(user?.passwordHash).not.toContain(PASSWORD);
    expect(user?.passwordHash.startsWith("scrypt$")).toBe(true);
  });
});

describe("AuthService — login", () => {
  it("signs in with the right password", async () => {
    const { service } = makeService();
    await service.signup("traveller@example.test", PASSWORD);

    const result = await service.login("traveller@example.test", PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect((await service.authenticate(result.session.token))?.email).toBe("traveller@example.test");
  });

  /**
   * D9's identical-response rule. If these two returned different reasons, the
   * login form would report which addresses have accounts — a disclosure in its
   * own right, and the first step of a targeted attack.
   */
  it("reports the same failure for a wrong password and for an unknown address", async () => {
    const { service } = makeService();
    await service.signup("traveller@example.test", PASSWORD);

    const wrongPassword = await service.login("traveller@example.test", "not-the-password");
    const noSuchUser = await service.login("nobody@example.test", PASSWORD);

    expect(wrongPassword).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(noSuchUser).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("blocks an address after the configured number of failures", async () => {
    const { service } = makeService({ max: 3 });
    await service.signup("traveller@example.test", PASSWORD);

    for (let i = 0; i < 3; i++) {
      expect((await service.login("traveller@example.test", "wrong")).ok).toBe(false);
    }

    const blocked = await service.login("traveller@example.test", PASSWORD);
    expect(blocked).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  /** The cap counts failures against an address, so it must not be dodged by
   * varying the capitalisation of that address. */
  it("counts failures against the normalised address", async () => {
    const { service } = makeService({ max: 2 });
    await service.signup("traveller@example.test", PASSWORD);

    await service.login("Traveller@Example.test", "wrong");
    await service.login("TRAVELLER@EXAMPLE.TEST", "wrong");

    expect(await service.login("traveller@example.test", PASSWORD)).toEqual({
      ok: false,
      reason: "too_many_attempts",
    });
  });

  it("forgets earlier failures once a login succeeds", async () => {
    const { service } = makeService({ max: 3 });
    await service.signup("traveller@example.test", PASSWORD);

    await service.login("traveller@example.test", "wrong");
    await service.login("traveller@example.test", "wrong");
    expect((await service.login("traveller@example.test", PASSWORD)).ok).toBe(true);

    // A full fresh allowance, not one attempt away from a lockout.
    await service.login("traveller@example.test", "wrong");
    await service.login("traveller@example.test", "wrong");
    expect((await service.login("traveller@example.test", PASSWORD)).ok).toBe(true);
  });
});

describe("AuthService — sessions", () => {
  it("returns null for a missing, empty, or unrecognised token", async () => {
    const { service } = makeService();
    expect(await service.authenticate(null)).toBeNull();
    expect(await service.authenticate(undefined)).toBeNull();
    expect(await service.authenticate("")).toBeNull();
    expect(await service.authenticate("not-a-real-token")).toBeNull();
  });

  it("stops honouring a token after logout", async () => {
    const { service } = makeService();
    const result = await service.signup("traveller@example.test", PASSWORD);
    if (!result.ok) throw new Error(result.reason);

    await service.logout(result.session.token);
    expect(await service.authenticate(result.session.token)).toBeNull();
  });

  it("logs out one session without disturbing the user's others", async () => {
    const { service } = makeService();
    const first = await service.signup("traveller@example.test", PASSWORD);
    const second = await service.login("traveller@example.test", PASSWORD);
    if (!first.ok || !second.ok) throw new Error("expected both to succeed");

    await service.logout(first.session.token);

    expect(await service.authenticate(first.session.token)).toBeNull();
    expect(await service.authenticate(second.session.token)).not.toBeNull();
  });

  /** Revocation across every device — what a JWT would have needed a denylist
   * for, and the concrete reason D9 chose server-side sessions. */
  it("revokes every session for a user at once", async () => {
    const { service } = makeService();
    const first = await service.signup("traveller@example.test", PASSWORD);
    const second = await service.login("traveller@example.test", PASSWORD);
    if (!first.ok || !second.ok) throw new Error("expected both to succeed");

    expect(await service.logoutEverywhere(first.user.id)).toBe(2);
    expect(await service.authenticate(first.session.token)).toBeNull();
    expect(await service.authenticate(second.session.token)).toBeNull();
  });

  /** Absolute, not sliding: an actively used stolen cookie still dies on
   * schedule. */
  it("expires a session after the configured lifetime, without needing a sweep", async () => {
    let now = new Date("2026-08-07T00:00:00.000Z");
    const { service } = makeService({ now: () => now });
    const result = await service.signup("traveller@example.test", PASSWORD);
    if (!result.ok) throw new Error(result.reason);

    now = new Date(now.getTime() + (LIMITS.sessionLifetimeDays * 86_400_000 - 1_000));
    expect(await service.authenticate(result.session.token)).not.toBeNull();

    now = new Date(now.getTime() + 2_000);
    expect(await service.authenticate(result.session.token)).toBeNull();
  });

  it("reclaims expired sessions on sweep", async () => {
    let now = new Date("2026-08-07T00:00:00.000Z");
    const { service } = makeService({ now: () => now });
    await service.signup("traveller@example.test", PASSWORD);

    expect(await service.sweepExpiredSessions()).toBe(0);

    now = new Date(now.getTime() + (LIMITS.sessionLifetimeDays + 1) * 86_400_000);
    expect(await service.sweepExpiredSessions()).toBe(1);
  });
});
