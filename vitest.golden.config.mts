import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenv } from "dotenv";
import { defineConfig } from "vitest/config";

// Golden-set harness (Lesson 7.3): compare AI providers on real recipe pages.
// Separate from vitest.config.mts on purpose — it does NOT load the integration
// setup guard (that refuses to run unless Supabase is local), because the golden
// set touches no database: it only calls the AI providers on local files.
//
// Env precedence mirrors the main config: .env.test → .env.local → .env.
// The golden set reads ANTHROPIC_API_KEY (Claude) + AZURE_FOUNDRY_ENDPOINT (Foundry,
// keyless — needs `az login`), which typically live in .env.local.
dotenv({ path: ".env.test", override: false });
dotenv({ path: ".env.local", override: false });
dotenv({ path: ".env", override: false });

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // Providers + the rasterizer begin with `import "server-only"`, which throws
      // outside a React Server Component. Alias it to the same no-op stub the
      // integration suite uses.
      "server-only": path.resolve(root, "tests/integration/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/golden/**/*.test.ts"],
    setupFiles: ["tests/golden/setup.ts"],
    fileParallelism: false,
    // Vision extraction is slow (~10–60s per call, ×2 providers × N docs).
    testTimeout: 1_200_000,
    hookTimeout: 60_000,
  },
});
