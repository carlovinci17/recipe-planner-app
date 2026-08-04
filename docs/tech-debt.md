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
| 1 | `lib/services/permissions.ts:24-42` | 2 (quality) | The `if (!isCreator) … else …` runs the **identical** `household_members` role query in *both* branches (only the comment differs). The "saves a round-trip" comment is misleading — the round-trip happens either way. Collapses to a single unconditional query. | Module 3 data-layer mapping | Open — fix in post-M3 cleanup |
