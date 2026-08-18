# Lesson 9.4 — Validate the migration on Neon + Azure

**Date:** 2026-08-18   **Module:** 9   **WAF pillar(s):** Reliability   **Status:** ✅ Done — app run against Neon + Azure, covers render, confirmed in-browser.

## What we did
Pointed the app's `DATABASE_URL` at the migrated **Neon** DB (dev only) with `STORAGE_PROVIDER=azure`,
signed in, and confirmed the full stack live: **Entra login → linked profile on Neon → RLS-scoped
household → 173 migrated recipes → WebP covers served from Azure Blob**. Spot-checked 5 recipes in the
browser — covers display.

## Two things the validation surfaced (both fixed)
1. **Neon needs the `authenticated` role.** `withUserContext` does `set local role authenticated`
   (ADR-0002: connect as owner, drop to a non-privileged role so RLS applies). Supabase ships that
   role; a bare Neon doesn't. `scripts/neon-roles.sql` creates it, grants `neondb_owner` membership
   (so `SET ROLE` is allowed), and grants the same table/function/schema privileges Supabase gives it.
   **This is a Module 11 cutover prerequisite** — run it on the prod Neon before flipping.
2. **Stale-session gotcha.** Switching `DATABASE_URL` mid-session leaves the browser session bound to
   the *old* DB's profile id, which doesn't exist in Neon → the app shows **onboarding** and
   `create_household_with_owner` fails with `not authenticated` (`auth.uid()` null). Fix: **sign out
   and back in** — the email-link shim (both migrated profiles had `entra_oid = null`) links the
   account to the migrated profile. Landed straight in "Casa Della Vinci" (173 recipes).

## Proof
`scripts/neon-validate.ts` replicates `withUserContext` against Neon: role + RLS + `auth.uid()` GUC
shim resolve, 173 recipes read with `.webp` covers. Then confirmed visually in the running app.

## Revert / cutover
- **Revert dev to local:** swap the two `DATABASE_URL` lines back in `.env.local` and restart.
- **At cutover (Module 11):** create the `authenticated` role on prod Neon (`scripts/neon-roles.sql`),
  point prod `DATABASE_URL` at the pooled Neon string, then retire Supabase.
