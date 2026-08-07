import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthStore } from "./store.js";

function email(): string {
  return `contract-${randomUUID()}@example.test`;
}

const HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";

/**
 * One set of assertions against both AuthStore implementations — the in-memory
 * fake in `npm test`, and NeonAuthStore against a real database in
 * `npm run test:neon`. Same reasoning as the TripStore contract: a fake that
 * behaves differently from the real store produces green tests over a broken
 * production path, and the two places that matters most here are `createUser`'s
 * atomicity and whether an expired session is honoured on read.
 *
 * Created users are deleted in afterEach — sessions cascade with them, in both
 * implementations, which is itself one of the assertions.
 */
export function authStoreContractTests(
  label: string,
  createStore: () => AuthStore | Promise<AuthStore>,
  teardownStore?: (store: AuthStore) => Promise<void> | void,
): void {
  describe(`AuthStore contract (${label})`, () => {
    let store: AuthStore;
    const createdUserIds: string[] = [];

    beforeEach(async () => {
      store = await createStore();
    });

    afterEach(async () => {
      while (createdUserIds.length > 0) {
        await store.deleteUser(createdUserIds.pop()!);
      }
    });

    afterAll(async () => {
      if (teardownStore) await teardownStore(store);
    });

    async function newUser(address = email()): Promise<{ id: string; email: string }> {
      const id = randomUUID();
      const result = await store.createUser({ id, email: address, passwordHash: HASH });
      if (!result.ok) throw new Error(`expected user creation to succeed, got ${result.reason}`);
      createdUserIds.push(id);
      return { id, email: address };
    }

    it("creates a user and finds it by email and by id", async () => {
      const user = await newUser();

      const byEmail = await store.findUserByEmail(user.email);
      expect(byEmail?.id).toBe(user.id);
      expect(byEmail?.passwordHash).toBe(HASH);

      const byId = await store.findUserById(user.id);
      expect(byId?.email).toBe(user.email);
    });

    it("returns null for an unknown email and an unknown id", async () => {
      expect(await store.findUserByEmail(email())).toBeNull();
      expect(await store.findUserById(randomUUID())).toBeNull();
    });

    /**
     * The store, not the service, is the arbiter of email uniqueness — a
     * check-then-insert in the service would let two concurrent signups both
     * through. Asserted here so the in-memory fake can't quietly be laxer than
     * the unique index that actually enforces it.
     */
    it("refuses a second user with the same email", async () => {
      const user = await newUser();

      const second = await store.createUser({ id: randomUUID(), email: user.email, passwordHash: HASH });
      expect(second.ok).toBe(false);
      if (second.ok) throw new Error("expected email_taken");
      expect(second.reason).toBe("email_taken");
    });

    it("does not create a row for the losing signup", async () => {
      const user = await newUser();
      const losingId = randomUUID();

      await store.createUser({ id: losingId, email: user.email, passwordHash: HASH });

      expect(await store.findUserById(losingId)).toBeNull();
      expect((await store.findUserByEmail(user.email))?.id).toBe(user.id);
    });

    it("stores and resolves a session", async () => {
      const user = await newUser();
      const tokenHash = randomUUID();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();

      await store.createSession({ tokenHash, userId: user.id, expiresAt });

      const session = await store.findValidSession(tokenHash, new Date());
      expect(session?.userId).toBe(user.id);
    });

    it("returns null for an unknown session token hash", async () => {
      expect(await store.findValidSession(randomUUID(), new Date())).toBeNull();
    });

    /**
     * Expiry is enforced on read, not only by the sweep. If this were left to
     * the sweep, a session would stay usable for however long it took the timer
     * to next fire — which is exactly the window an absolute session lifetime
     * exists to close.
     */
    it("refuses a session whose expiry has passed, even before any sweep runs", async () => {
      const user = await newUser();
      const tokenHash = randomUUID();
      await store.createSession({
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      });

      expect(await store.findValidSession(tokenHash, new Date())).toBeNull();
    });

    it("deletes a single session without touching the user's others", async () => {
      const user = await newUser();
      const keep = randomUUID();
      const drop = randomUUID();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      await store.createSession({ tokenHash: keep, userId: user.id, expiresAt });
      await store.createSession({ tokenHash: drop, userId: user.id, expiresAt });

      await store.deleteSession(drop);

      expect(await store.findValidSession(drop, new Date())).toBeNull();
      expect(await store.findValidSession(keep, new Date())).not.toBeNull();
    });

    /** "Log out everywhere" — the operation a JWT could not have supported
     * without a denylist, and the concrete reason D9 chose server-side
     * sessions. */
    it("deletes every session for one user and leaves other users' alone", async () => {
      const mine = await newUser();
      const theirs = await newUser();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const a = randomUUID();
      const b = randomUUID();
      const other = randomUUID();
      await store.createSession({ tokenHash: a, userId: mine.id, expiresAt });
      await store.createSession({ tokenHash: b, userId: mine.id, expiresAt });
      await store.createSession({ tokenHash: other, userId: theirs.id, expiresAt });

      expect(await store.deleteSessionsForUser(mine.id)).toBe(2);
      expect(await store.findValidSession(a, new Date())).toBeNull();
      expect(await store.findValidSession(b, new Date())).toBeNull();
      expect(await store.findValidSession(other, new Date())).not.toBeNull();
    });

    it("sweeps only expired sessions", async () => {
      const user = await newUser();
      const live = randomUUID();
      const dead = randomUUID();
      await store.createSession({ tokenHash: live, userId: user.id, expiresAt: new Date(Date.now() + 60_000).toISOString() });
      await store.createSession({ tokenHash: dead, userId: user.id, expiresAt: new Date(Date.now() - 60_000).toISOString() });

      expect(await store.deleteExpiredSessions(new Date())).toBeGreaterThanOrEqual(1);
      expect(await store.findValidSession(live, new Date())).not.toBeNull();
    });

    it("takes a user's sessions with them when the user is deleted", async () => {
      const user = await newUser();
      const tokenHash = randomUUID();
      await store.createSession({
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      expect(await store.deleteUser(user.id)).toBe(true);
      createdUserIds.pop();

      expect(await store.findValidSession(tokenHash, new Date())).toBeNull();
      expect(await store.findUserById(user.id)).toBeNull();
    });
  });
}
