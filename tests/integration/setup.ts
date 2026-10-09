import { createRequire } from "node:module";
import { beforeAll } from "vitest";

/**
 * Setup for the integration suites.
 *
 * React's `cache()` only exists under the `react-server` export condition. In
 * the Node test environment `react` resolves to the client build where it is
 * undefined, so any service that memoizes with it (household-service,
 * active-household, permissions) throws "cache is not a function" on import.
 * React is externalized here, so patching the shared module.exports shims it
 * for every importer. Identity is the right shim — per-request memoization is
 * a no-op in a test, and would actively hide RLS differences between two
 * calls made as different users.
 */
{
  const react = createRequire(import.meta.url)("react") as { cache?: <T>(fn: T) => T };
  if (typeof react.cache !== "function") react.cache = (fn) => fn;
}

/**
 * SAFETY GUARD — runs automatically, for every suite, before anything else.
 *
 * These suites seed and DELETE rows. `DATABASE_URL` in this repo normally
 * resolves to the LIVE Neon database, so an unguarded run mutates production:
 * that is not hypothetical, a read-only page sweep already littered real data
 * with eight junk rows earlier in this project.
 *
 * The previous version of this guard was an exported function nobody called,
 * which is worse than no guard — it reads as protection. This one is a
 * `beforeAll` in a setup file, so a new suite cannot forget it.
 *
 * TEST_ALLOW_HOSTED_DB=1 opts out, for a genuinely disposable Neon branch.
 */
beforeAll(() => {
  if (process.env.TEST_ALLOW_HOSTED_DB === "1") return;
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is unset — run: bash scripts/test-db-up.sh");
  const isLocal = /@(127\.0\.0\.1|localhost|host\.docker\.internal)[:/]/.test(url);
  if (!isLocal) {
    throw new Error(
      "Refusing to run: these suites DELETE rows and DATABASE_URL is not local " +
        `("${url.replace(/:[^:@/]+@/, ":***@")}"). ` +
        "Run `bash scripts/test-db-up.sh`, or set TEST_ALLOW_HOSTED_DB=1 if the target is disposable.",
    );
  }
});
