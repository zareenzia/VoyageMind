import { defineConfig } from "vitest/config";

// Only config that runs scripts/check-neon.test.ts. See that file's header
// and `npm run test:neon`. Loads .env the same way `tsx --env-file=.env`
// does for every other script — vitest itself doesn't populate process.env
// from .env, so without this DATABASE_URL would never be seen.
process.loadEnvFile();

export default defineConfig({
  test: {
    include: ["scripts/check-neon.test.ts"],
  },
});
