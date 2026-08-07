# Module 3 — Drizzle migration status (resume anchor)

**Purpose:** the single authoritative snapshot of the Supabase→Drizzle port, so any session
(compacted or brand-new) resumes from *this file + the code*, not chat history. Update it as methods
are ported.

_Last updated: 2026-08-08 · 27 integration tests green._

## The porting recipe (repeat per method)
1. **Bridge RLS to `app_uid()`** in a new migration (`supabase/migrations/`, timestamp later than the
   latest). Change the policy's (or RPC's internal) `auth.uid()` → `public.app_uid()`. `app_uid()` =
   `coalesce(app.user_id GUC, auth.uid())`, so the Supabase path keeps working during the swap.
2. **Add a Drizzle impl gated by `env.DATABASE_URL`** (else the existing Supabase impl):
   - Reads → `runInUserTx((tx) => tx.select({ /* snake_case aliases */ }).from(table)…)`
   - Writes → `runInUserTx((tx) => tx.update/insert/delete(…))`
   - RPCs → `runInUserTx((tx) => tx.execute(sql`select public.fn(${a}) as id`))`
   - `runInUserTx` (in `lib/services/user-tx.ts`) resolves the user (Supabase `getUser()`), then wraps
     the txn in `withUserContext` (`SET LOCAL ROLE authenticated` + `app.user_id`). `fn` also receives
     the resolved `userId` as a 2nd arg for inserts that stamp `created_by`/`invited_by`.
3. **Characterization test first** (`tests/integration/`): seed via an authed client, `vi.mock`
   `createSupabaseServerClient` → that client, assert. Reads that return full rows must **alias columns
   back to snake_case** to preserve `Tables<>` shapes (tech-debt #2).
4. **Verify:** `npx supabase db reset` → `npm run typecheck` → `npm test`.
5. **Prove the Drizzle path**: temporarily throw in `runInUserTx`; the method's tests must fail.

## Key files
- `lib/db/index.ts` — Drizzle client + `withUserContext`.
- `lib/db/schema.ts` — introspected schema (camelCase props; RLS policies are documentation only).
- `lib/services/user-tx.ts` — shared `runInUserTx` (every service ports through it).
- `lib/env.ts` — `DATABASE_URL` (optional; **prod has none → Supabase path**).
- `tests/integration/{helpers,setup}.ts` — seed helpers + safety guard + React.cache shim.

## Environment to run tests
Docker Desktop running → `npx supabase start` → `.env.test` points at local (`127.0.0.1:54322`).
Then: `source ~/.nvm/nvm.sh && nvm use 24.15.0 && npm test`. Apply a new migration with
`npx supabase db reset`.

## Migrations added (the app_uid bridges)
| Migration | Bridges |
|---|---|
| `20260806120000_rls_app_uid` | **`app_uid()` fn** + recipes SELECT |
| `20260806130000_rls_recipe_children_read` | recipe_ingredients/instructions SELECT |
| `20260806140000_rls_recipe_writes` | recipes UPDATE/DELETE |
| `20260806150000_rpc_shopping_list_app_uid` | shopping-list RPC (range) |
| `20260806160000_rpc_household_app_uid` | create + accept RPCs |
| `20260806170000_rls_recipe_service_remainder` | planner_entries SELECT + recipe children INSERT/DELETE |
| `20260806180000_rls_planner_write` | planner_entries UPDATE/DELETE |
| `20260806190000_rls_household_reads` | households + household_members + profiles SELECT |
| `20260806200000_rls_shopping_reads` | shopping_lists SELECT + shopping_list_items (all) |
| `20260806210000_rls_planner_insert` | planner_entries INSERT |
| `20260806220000_rls_invite_write` | household_invites INSERT + SELECT |

## Method-by-method status
### recipeService — ✅ data layer complete
`list` · `getById` · `setFavorite` · `setRating` · `publish` · `archive` · `delete` · `bulkDelete` ·
`update` · `replaceIngredients` · `replaceInstructions` · `countPlannerEntries` — all ✅.
`createImageUploadUrl` · `attachImage` · `setCoverImage` · `removeImage` — ⬜ **storage → Module 5**.

### household-service — ✅ data layer complete
`create` ✅ (RPC) · `acceptInvite` ✅ (RPC) · `listForCurrentUser` ✅ (read; households join) ·
`getActive` ✅ (read) · `members` ✅ (read; profiles join) · `invite` ✅ (insert + returning).

### planner-service — ✅ data layer complete
`getWeek` ✅ (read; recipes LEFT join) · `addEntry` ✅ (insert; embedded return) ·
`moveEntry` ✅ · `removeEntry` ✅ · `generateShoppingList` ✅ (RPC) ·
`generateShoppingListRange` ✅ (RPC + count).

### Not yet started (to inspect + port)
`shopping-service` · `rating-service` · `ingestion-service` · `permissions` (`getRecipePermissions`) ·
`active-household` (`getActiveHousehold`, reads via householdService).

## Then (later modules)
Flip `DATABASE_URL` on in dev to run the app on Drizzle locally; **Module 9** migrates the host to Neon;
storage methods move to Blob in **Module 5**. See `docs/tech-debt.md` for the getUser hot-path and
snake_case-schema simplification.
