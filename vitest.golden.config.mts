import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenv } from "dotenv";
import { defineConfig } from "vitest/config";

// Golden-set harness (Lesson 7.3): compare AI providers on real recipe pages.
// Separate from vitest.config.mts on purpose — it does NOT load the integration
// setup guard (that refuses to run unless Supabase is local), because the golden
// set touches no database: it only calls the AI providers on local files.
//
// The golden set touches no DB, so it deliberately does NOT load .env.test (that
// file exists for the integration suite's throwaway Supabase, and its
// ANTHROPIC_API_KEY is a stale placeholder that would shadow the real one). It
// reads ANTHROPIC_API_KEY (Claude baseline) + AZURE_FOUNDRY_ENDPOINT (keyless
// Foundry — needs `az login`) from .env.local / .env.
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
    // Vision extraction is slow — Claude Opus with adaptive thinking can take
    // minutes per multi-page doc. Report is written incrementally, but give the
    // whole set a generous 40-min ceiling so it finishes in one pass.
    testTimeout: 2_400_000,
    hookTimeout: 60_000,
  },
});
