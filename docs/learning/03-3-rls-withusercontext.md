# Lesson 3.3 — RLS on a direct connection + the first swap (ADR-002)

**Skills in play:** `codebase-design` · `/security-review` mindset (RLS is the security boundary).

**Date:** 2026-08-06   **Module:** 3   **WAF pillar(s):** Security, Reliability   **Token cost:** low   **Status:** 🟡 In progress — `recipeService.list` **and** `getById` ported & proven; writes/RPCs to follow the same pattern.

## The problem
PostgREST scopes every query by the JWT via `auth.uid()`. Drizzle connects **directly** to Postgres —
there is **no `auth.uid()`** on that connection. Worse, the local direct connection is the **superuser**,
which *bypasses RLS entirely*. So a naive Drizzle query would leak across households.

## The solution — three parts
1. **`withUserContext(userId, fn)`** — runs the query in a transaction that first does
   `SET LOCAL ROLE authenticated` (a role RLS *is* enforced for) and sets the `app.user_id` GUC. Both
   reset when the transaction ends.
2. **`public.app_uid()`** — `coalesce(nullif(current_setting('app.user_id', true),'')::uuid, auth.uid())`.
   A **bridge**: prefers the GUC (Drizzle path), falls back to `auth.uid()` (Supabase path).
3. **Rewrite the policy** — the `recipes` SELECT policy now uses `is_household_member(household_id, app_uid())`.

Because `app_uid()` coalesces, the **Supabase path and the Drizzle path both satisfy the same policy** —
which is what makes an *incremental* method-by-method migration possible.

## Production safety: the DATABASE_URL gate
`recipeService.list` dispatches: `env.DATABASE_URL ? drizzle : supabase`. Local/test set
`DATABASE_URL` → Drizzle; **prod doesn't** → Supabase, unchanged. The live demo never runs the new
path until we choose to. `lib/db` is imported *dynamically* inside the Drizzle branch, so prod never
even loads it.

## Proof
The 9 characterization tests (incl. **cross-household isolation**) pass through the Drizzle path —
confirmed by temporarily throwing in the Supabase path and watching them stay green. Same tests,
new engine, identical behaviour.

## Gotcha worth remembering
Connecting as the superuser **silently bypasses RLS** — the isolation test would have passed for the
*wrong reason*. `SET LOCAL ROLE authenticated` is what actually puts the policies in force.

## Evidence / links
- Repo: `lib/db/index.ts` (`withUserContext`), `lib/services/recipe-service.ts` (gated dispatch),
  `supabase/migrations/20260806120000_rls_app_uid.sql` (`app_uid()` + policy), `lib/env.ts`.
