# Lesson 3.4 — Port the plpgsql RPCs (via Drizzle)

**Skills in play:** `codebase-design`.

**Date:** 2026-08-06   **Module:** 3   **WAF pillar(s):** Reliability, Security   **Token cost:** low   **Status:** ✅ Done — all three RPCs (`generate_shopping_list_from_planner`, `create_household_with_owner`, `accept_household_invite`) ported & proven.

## The RPCs
Three plpgsql functions do multi-step writes atomically: `create_household_with_owner`,
`accept_household_invite`, and `generate_shopping_list_from_planner` (a thin wrapper over the
range function). Each reads `auth.uid()` internally for the membership check and `created_by`.

## The porting pattern
An RPC on the Drizzle connection has no `auth.uid()`, so:
1. **Rewrite the RPC's internal `auth.uid()` → `public.app_uid()`** (migration). Because `app_uid()`
   coalesces to `auth.uid()`, the Supabase path is unaffected — the same incremental-safe bridge
   used for the table policies.
2. **Call it via `tx.execute`** under `runInUserTx`:
   ```ts
   await tx.execute(sql`select public.generate_shopping_list_from_planner(${hh}, ${weekStart}) as id`)
   ```
3. Gate on `DATABASE_URL`; the same characterization test proves equivalence.

## Security-definer subtlety (the thing to understand)
The RPCs are `security definer` — they run as the *owner* and bypass RLS to do their inserts.
Identity comes only from `app_uid()` *inside* the function (the membership check). So under
`runInUserTx` (which sets `app.user_id` + `SET LOCAL ROLE authenticated`), the RPC sees the right
user and its inserts succeed regardless of the caller's role.

## Shared helper
A second service (planner) needed the user-context wrapper, so `runInUserTx` moved to
`lib/services/user-tx.ts` — one place every service ports through.

## Evidence / links
- Repo: `lib/services/planner-service.ts`, `lib/services/user-tx.ts`,
  `supabase/migrations/20260806150000_rpc_shopping_list_app_uid.sql`.
- Test: `tests/integration/planner-service.test.ts` (green through the Drizzle path).
