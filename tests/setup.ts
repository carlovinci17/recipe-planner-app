import { createRequire } from "node:module";
import { config as dotenv } from "dotenv";

/**
 * Vitest worker setup.
 *
 * Replaces `tests/integration/setup.ts`, which went with the Supabase-based
 * integration suite. Two things survive from it, and the Supabase-specific
 * safety guard does not — see the note at the bottom.
 */

// React's `cache()` only exists under the `react-server` export condition (RSC).
// In the Node test env, `react` resolves to the client build where it's
// undefined, so services that memoize with it (household-service,
// active-household, permissions) throw "cache is not a function" at import.
// React is externalized in tests, so patching the shared module.exports shims it
// for those imports. Identity is correct here — per-request memoization is a
// no-op in a test.
{
  const react = createRequire(import.meta.url)("react") as { cache?: <T>(fn: T) => T };
  if (typeof react.cache !== "function") react.cache = (fn) => fn;
}

// The config loads env in the main process, but vitest workers fork — re-load
// so anything reading `lib/env.ts` inside a worker sees the same values.
dotenv({ path: ".env.test", override: false });
dotenv({ path: ".env.local", override: false });
dotenv({ path: ".env", override: false });

/**
 * The old setup refused to run unless NEXT_PUBLIC_SUPABASE_URL and DATABASE_URL
 * both pointed at localhost, because the integration tests seeded and DELETED
 * rows. That guard is gone with those tests: every suite that runs here now is
 * a pure unit test which touches no database.
 *
 * If service-level integration tests come back, the guard must come back with
 * them — pointed at a Neon branch, not localhost. `DATABASE_URL` in this repo
 * resolves to the live Neon database, so an unguarded write-and-delete suite
 * would mutate production. See docs/TODO.md.
 */
