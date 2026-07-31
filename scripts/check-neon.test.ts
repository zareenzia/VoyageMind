/**
 * Runs the exact same TripStore contract suite as
 * src/trips/in-memory-store.test.ts, but against a real Neon database via
 * NeonTripStore. This is the "one divergent set of assertions" trap named in
 * the D7 discussion made impossible: both fakes and the real store are
 * proven against identical assertions, just parameterised differently.
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
