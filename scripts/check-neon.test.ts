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

tripStoreContractTests(
  "neon",
  () => new NeonTripStore(),
  async (store) => {
    await (store as NeonTripStore).close();
  },
);

authStoreContractTests(
  "neon",
  () => new NeonAuthStore(),
  async (store) => {
    await (store as NeonAuthStore).close();
  },
);
