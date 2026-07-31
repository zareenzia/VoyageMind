import { defineConfig } from "vitest/config";

// scripts/check-neon.test.ts hits a real Neon database and must never run as
// part of the default suite — see CLAUDE.md "No live network calls in
// tests." It's excluded here and only picked up by vitest.neon.config.ts,
// run explicitly via `npm run test:neon`.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**", "scripts/**"],
  },
});
