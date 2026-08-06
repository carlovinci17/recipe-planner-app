import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenv } from "dotenv";
import { defineConfig } from "vitest/config";

// Mirror playwright.config's precedence: .env.test → .env.local → .env (test wins).
// Loaded here (main process) so it's set before workers fork and before any
// module reads process.env.
dotenv({ path: ".env.test", override: false });
dotenv({ path: ".env.local", override: false });
dotenv({ path: ".env", override: false });

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // Services start with `import "server-only"`, which throws when imported
      // outside a React Server Component. Stub it to a no-op for node tests.
      "server-only": path.resolve(root, "tests/integration/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // These are true integration tests sharing one local DB — run serially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
