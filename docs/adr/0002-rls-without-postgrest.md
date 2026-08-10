# ADR-0002 — Preserve row-level security without PostgREST

**Status:** ✅ Accepted — 2026-08-06 (implemented in Module 3)
**Module:** 3 (Data layer)
**WAF pillar(s):** Security (primary), Reliability
**Deciders:** Carlo (owner), with Claude as advisor
**Full write-up:** [`docs/learning/03-3-rls-withusercontext.md`](../learning/03-3-rls-withusercontext.md)

---

## Context

Supabase RLS scopes every row to the caller via `auth.uid()`, a value PostgREST injects from the
JWT on each request. Drizzle connects **directly** to Postgres over a single superuser-ish
connection — there is no PostgREST, no per-request JWT, and a direct owner connection **bypasses
RLS** entirely. Without a replacement, a forgotten `WHERE household_id = …` could leak another
household's data — losing the core security guarantee.

## Decision

Carry the caller's identity into each transaction and drive RLS from it:

1. A SQL function `public.app_uid()` returns `coalesce(nullif(current_setting('app.user_id', true),'')::uuid, auth.uid())`.
   It reads an app-set GUC first, falling back to `auth.uid()` so the **Supabase path keeps working
   during the incremental swap**.
2. Every RLS policy (and the security-definer RPCs) reads `public.app_uid()` instead of `auth.uid()`.
3. `withUserContext(userId, fn)` runs a transaction that does `SET LOCAL ROLE authenticated` +
   `set_config('app.user_id', userId, true)`, so RLS applies to the direct connection with the
   caller's id. `runInUserTx` resolves the user and wraps the txn.

## Consequences

- **Pros:** the "a missing `WHERE` can't leak across households" property is preserved on Drizzle;
  the `coalesce` bridge let the migration proceed method-by-method with both paths live; identity is
  set in exactly one place. Post-cutover (no Supabase, ADR-0005) `app_uid()` collapses to the GUC.
- **Cons:** every request must run inside a transaction that sets the GUC (a small, uniform cost);
  security-definer RPCs run as owner, so identity must come **only** from `app_uid()` inside them.
- **Verified:** 36 integration tests against a real local Postgres prove cross-household isolation
  (mocks can't — RLS is real only in a real DB).

## Alternatives considered

- **Trust the app's `WHERE` clauses, drop RLS** — rejected; removes defence-in-depth, the whole
  point of the guarantee.
- **A PgBouncer/PostgREST-like shim** — rejected; reintroduces the component we're removing.
