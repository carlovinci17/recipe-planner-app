import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenv } from "dotenv";
import { defineConfig, configDefaults } from "vitest/config";

/**
 * Integration suites — real Postgres, real RLS, no mocks below the service layer.
 *
 * Separate from vitest.config.mts on purpose: these need a database, they seed
 * and DELETE rows, and they must never be picked up by a plain `npm test`.
 *
 * Stand the database up first:  bash scripts/test-db-up.sh
 */
dotenv({ path: ".env.test", override: false });
dotenv({ path: ".env.local", override: false });
dotenv({ path: ".env", override: false });

const root = path.dirname(fileURLToPath(import.meta.url));

// The container from scripts/test-db-up.sh. Overridable so the suite can be
// pointed at a disposable Neon branch instead.
const TEST_DB =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:testpass@127.0.0.1:55432/postgres";

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: [...configDefaults.exclude],
    setupFiles: ["tests/integration/setup.ts"],
    // DATABASE_URL is what lib/db connects with, and it memoizes on first use —
    // so it has to be right before any import, not set inside a test.
    env: { TZ: "UTC", DATABASE_URL: TEST_DB, TEST_DATABASE_URL: TEST_DB },
    // One database, shared. Parallel files would race on the same rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
