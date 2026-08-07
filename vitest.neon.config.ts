import { defineConfig } from "vitest/config";

// Only config that runs scripts/check-neon.test.ts. See that file's header
// and `npm run test:neon`. Loads .env the same way `tsx --env-file=.env`
// does for every other script — vitest itself doesn't populate process.env
// from .env, so without this DATABASE_URL would never be seen.
process.loadEnvFile();

export default defineConfig({
  test: {
    include: ["scripts/check-neon.test.ts"],
    // Every assertion here is a network round trip to Neon, and a scale-to-zero
    // instance adds a cold start to the first one. The 5s default is tuned for
    // in-process fakes and fails these on latency rather than on behaviour —
    // which is the worst kind of red, since it looks like a real defect.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
