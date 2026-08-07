/**
 * Runs the exact same TripStore and AuthStore contract suites as
 * src/trips/in-memory-store.test.ts and src/auth/in-memory-store.test.ts, but
 * against a real Neon database. This is the "one divergent set of assertions"
 * trap named in the D7 discussion made impossible: both fakes and the real
 * stores are proven against identical assertions, just parameterised
 * differently.
 *
 * It matters more since D9. Trip ownership is now expressed twice — as
 * `isTripOwner` in JS and as a SQL predicate in NeonTripStore — because the
 * database has to enforce it inside the same statement as the UPDATE. Only this
 * file proves the SQL half agrees with the JS half, and a disagreement there
 * leaks another user's trip.
 *
 * NOT part of `npm test` — see vitest.config.ts's exclude and
 * vitest.neon.config.ts, which is the only config that includes this file.
 * Run deliberately:
 *
 *   npm run migrate                 # apply migrations/*.sql once
 *   npm run test:neon               # requires a real DATABASE_URL in .env
 *
 * This writes and deletes real rows. Point DATABASE_URL at a disposable Neon
 * branch, not a database you care about.
 */
import { NeonAuthStore } from "../src/auth/neon-store.js";
import { authStoreContractTests } from "../src/auth/store.contract.js";
import { NeonTripStore } from "../src/trips/neon-store.js";
import { tripStoreContractTests } from "../src/trips/store.contract.js";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "scripts/check-neon.test.ts requires a real DATABASE_URL (see .env.example) — this is a manual, " +
      "real-network check, never part of `npm test`.",
  );
}

/**
 * One store per suite, not one per test. The contract calls `createStore` in
 * `beforeEach`, which is free for an in-memory fake and decidedly not free
 * here — a `new NeonTripStore()` per test means a new `pg.Pool` per test, so
 * connections accumulate for the whole run and only the last pool is ever
 * closed. Both stores are stateless, so a single instance is correct.
 */
const tripStore = new NeonTripStore();
const authStore = new NeonAuthStore();

/**
 * `trips.user_id` is a real foreign key here, so a trip attached to a user id
 * with no `users` row is rejected by the database. The contract provisions ids
 * through this rather than fabricating them — see TripStoreContractOptions.users
 * for why the in-memory fake cannot do the same and what that means.
 *
 * A throwaway password hash: these rows exist to satisfy referential integrity
 * and are never authenticated against, so spending scrypt on them would add
 * ~100ms per test for nothing.
 */
const users = {
  async create(userId: string): Promise<void> {
    const result = await authStore.createUser({
      id: userId,
      email: `trip-contract-${userId}@example.test`,
      passwordHash: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
    });
    if (!result.ok) throw new Error(`could not provision contract user ${userId}: ${result.reason}`);
  },
  async remove(userId: string): Promise<void> {
    await authStore.deleteUser(userId);
  },
};

tripStoreContractTests("neon", {
  createStore: () => tripStore,
  users,
  teardown: async () => {
    await tripStore.close();
  },
});

authStoreContractTests(
  "neon",
  () => authStore,
  async () => {
    await authStore.close();
  },
);
