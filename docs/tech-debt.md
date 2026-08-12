# Tech debt / deferred cleanups

Running list of quality issues and real bugs surfaced **during the Azure migration**, deliberately
**not** fixed in place. The migration is behaviour-preserving (bug-for-bug) so that "characterization
tests stay green" reliably means *"I swapped the engine, not the behaviour."* Mixing fixes into a swap
destroys that signal.

**The rule (three buckets):**
1. **Blocks the swap** → fix as part of the migration (it *is* the migration; not logged here).
2. **Cosmetic / quality in code we keep** → log here, fix in a **dedicated pass after the module's
   tests are green**.
3. **Real behaviour bug** → capture the *current* (buggy) behaviour in a test first, log here, then fix
   as its **own** isolated commit with its own test change.

> Note: some things *improve for free* as a consequence of the swap (e.g. PostgREST embedded selects
> become typed Drizzle joins). That's not debt — it's just the swap being better. Not logged here.

| # | Location | Bucket | Issue | Found during | Status |
|---|---|---|---|---|---|
| 1 | `lib/services/permissions.ts` | 2 (quality) | The `if (!isCreator) … else …` ran the **identical** `household_members` role query in *both* branches (only the comment differed). | Module 3 data-layer mapping | **Resolved** — collapsed to one query when porting `getRecipePermissions` to Drizzle (commit on 2026-08-08) |
| 2 | `lib/db/schema.ts` + ported read methods | 2 (quality) | The Drizzle schema uses camelCase property names, so every ported read method that returns full rows aliases each column back to snake_case (`getById` aliases ~57). A **snake_case-keyed schema** (props = DB column names) would make ports near one-liners and remove typo risk. Deferred: revisit if aliasing fatigue grows as more methods are ported. | Module 3 getById port | Open — candidate simplification |
| 3 | `lib/services/recipe-service.ts` (`runInUserTx`) | 2 (efficiency) | Each ported Drizzle read/write resolves the user via `supabase.auth.getUser()` — an auth-server round-trip — on hot paths like `list()`. Now centralized in `runInUserTx`, so a per-request cache (React `cache()`, applied so multi-user tests don't share a memo) or threading the id from `getActiveHousehold` would remove the extra call. | Module 3 /code-review | Open |
| 4 | `lib/services/recipe-service.ts` | behaviour | Ported methods throw `"Not authenticated"` on a missing session; the old Supabase path silently matched 0 rows. **Accepted** as an improvement (fail loud; these are only called post-auth) — logged as an uncovered behaviour change. | Module 3 /code-review | Accepted — no action |
| 5 | `types/database.types.ts` | 2 (quality) | The file is **hand-authored** but mixes in custom exports (`MealSlot`, `RecipeSourceKind`, `UpdateTables`, …); running `npm run db:types` (`supabase gen types`) overwrites the whole file and deletes those, breaking ~19 importers. **Transitional** — the risk exists only while the Supabase `db:types` generator is in the mix. Endgame (Module 9, when Supabase is removed): retire `database.types.ts` and derive row/insert/update types from the Drizzle schema (`lib/db/schema.ts`, via `$inferSelect`/`$inferInsert`) as the single source of truth; `db:types` is dropped entirely. Doing a "separate helpers" refactor *now* would just be polishing a file we're about to delete. Until cutover: **hand-edit, never run `db:types`**. | Module 4 (schema change for `entra_oid`) | Open — resolves as part of Module 9 (DB → Neon/Drizzle) |
| 6 | `app/api/storage/upload/route.ts` | behaviour | Unauthenticated uploads get a **307 → /login** (middleware) instead of a `401`. Access is correctly blocked, but an *authenticated fetch whose session expired mid-upload* follows the redirect and can read the login page as an HTTP 200 "success". Low impact at 2 users. Fix: let `/api/storage/**` return `401` from the route instead of redirecting (exclude it from the redirecting matcher, or short-circuit for `/api/` in the middleware). | Module 5 security review (Lesson 5.5, F3) | Open |
| 7 | `app/api/storage/upload/route.ts` | 2 (efficiency) | `req.formData()` buffers the **entire** upload into memory before the 25 MB size check runs, so a large body is a memory-DoS vector. Gated behind member auth + `maxDuration 60`, so accepted for now; revisit with a streaming/`Content-Length`-preflight check if upload volume grows. | Module 5 security review (Lesson 5.5, F5) | Open |
