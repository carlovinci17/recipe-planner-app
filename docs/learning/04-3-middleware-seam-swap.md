# Lesson 4.3 — Middleware + the identity-seam swap

**Date:** 2026-08-11   **Module:** 4 (Authentication)   **WAF pillar(s):** Security   **Status:** ✅ Done — typecheck + 36 tests green; Entra login works end-to-end.
**Decided in:** [ADR-0005](../adr/0005-authentication.md) Decisions 3–4.

## What we did
Made the app actually *use* the Auth.js session everywhere — the point where signing in via Entra
drops you into the logged-in app — **without breaking the existing Supabase path** the 36 tests +
e2e still rely on. Done as three verifiable slices.

## The gating idea (both auth stacks coexist)
A single env flag, **`AUTH_PROVIDER`**, selects the active stack:
- `entra` → read the Auth.js session.
- unset / `supabase` → the legacy `supabase.auth.getUser()` path (prod today + every test).

So the swap is behaviour-neutral until the flag flips — tests stay on Supabase, dev flips to Entra.

## The pieces
| Piece | What |
|---|---|
| **`getCurrentUser()`** (`lib/auth/current-user.ts`) | The one seam. Dispatches on `AUTH_PROVIDER`; returns `{ id: profiles.id, email, name, oid }`. Replaces **all 22** `getUser()` call sites. |
| **`runInUserTx`** | Resolves identity through `getCurrentUser()` → feeds the same `withUserContext` GUC. RLS unchanged. |
| **Middleware** | Provider-aware: for `entra`, gates on the Auth.js session cookie (edge-safe); the real check is `getCurrentUser()` + RLS at each page. |
| **`profile-service`** | `getMyProfile` / `updateMyDisplayName` (gated Drizzle/Supabase) so the layout + settings read/write the caller's own row under Entra. |
| **`recipeService.createDraft`** | The manual "New recipe" insert as a gated service method (+ a `recipes` INSERT `app_uid()` RLS bridge — the one policy Module 3 hadn't needed). |
| **Login page** | Shows a **"Sign in with Microsoft"** button when `AUTH_PROVIDER=entra`, else the old form. |

## Proven
- `npm run typecheck` clean; **36 integration tests green** (Supabase fallback exercised through the seam).
- With `AUTH_PROVIDER=entra` + `DATABASE_URL` set: sign in → land in the app logged in (verified live).

## Follow-ups (not on the login path)
- The Google Drive callback still writes `integration_accounts` via Supabase (Module 5/6).
- A few service Supabase-*branch* `getUser()` calls remain dormant under Entra (Drizzle branch runs);
  swap them at the pure cutover.

## Evidence / links
- `lib/auth/current-user.ts`, `lib/services/{user-tx,profile-service,permissions,active-household,recipe-service}.ts`,
  `lib/supabase/middleware.ts`, `app/(auth)/login/page.tsx`, `supabase/migrations/20260811110000_rls_recipe_insert.sql`.
