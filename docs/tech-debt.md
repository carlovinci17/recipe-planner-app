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
