# Module 4 — Authentication: mini-plan

**Decided in:** [ADR-0005](../adr/0005-authentication.md) (+ [0002](../adr/0002-rls-without-postgrest.md),
[0003](../adr/0003-service-signatures.md), [0004](../adr/0004-mobile-strategy.md)).
**Goal:** replace Supabase Auth with **Entra External ID + Auth.js**, keep Google + email/password,
touch `app/` only via the identity seam. **This is the steepest module — mandatory `/security-review`.**

## Design baseline (from ADR-0005)
- **Auth.js (NextAuth v5)** + Entra External ID provider (`ciamlogin.com` authority), browser-delegated.
- `profiles.id` = app-owned UUID; new unique **`profiles.entra_oid`**; drop the `auth.users` FK + `handle_new_user` trigger.
- **JIT-provision** the profile in the Auth.js sign-in callback (link existing users by verified email — a shim to delete post-cutover).
- One **`getCurrentUser()`** seam (session carries id + email/name/avatar) replaces all 22 `getUser()` sites; feeds `withUserContext` unchanged.
- **No Bearer API** — mobile = responsive PWA on the shared cookie session.

## Cutover approach
Dev-first, like Module 3's flag but for auth: build and verify against a **dev External ID tenant**
while **prod stays on Supabase Auth** until the Module 9 cutover. Keep the two auth stacks from
fighting by switching the identity seam (`getCurrentUser`) behind the same env signal the data layer
uses, or a dedicated `AUTH_PROVIDER` flag — decide at 4.3 when the middleware is rewritten.

## Lessons
| Lesson | Do | Prove it |
|---|---|---|
| **4.1** Concepts + tenant | You create the External ID **external tenant** (free trial `aka.ms/ciam-free-trial`) + an **app registration** (redirect `…/api/auth/callback/microsoft-entra-id`). Wire Auth.js. *MS Learn: "Create an external tenant", "Register an app".* | Auth.js redirects to the Entra-hosted sign-in. |
| **4.2** Google + email/password | Register a Google OAuth app → client id/secret into the tenant; build the **user flow** (Google + email/pwd). *MS Learn: "Add Google as an identity provider".* | Both methods reach the app authenticated. |
| **4.3** Middleware + seam | Schema migration (below); Auth.js callbacks (provision + link + stash `profiles.id`); add `getCurrentUser()`; rewrite `lib/supabase/middleware.ts` (keep `PUBLIC_PATHS`, swap the session check); **swap all 22 `getUser()` sites**. | Typecheck clean; protected routes gate; RLS still isolates households. |
| **4.4** Mobile hedge (ADR-0004) | Design-only: confirm `runInUserTx` accepts an explicit `userId` so a future Bearer path plugs in. **No API code.** | ADR-0004 recorded; services stay identity-pluggable. |
| **4.5** Security review | `/security-review` on token handling + the provisioning/link callback. Budget extra time. | Findings triaged/fixed before merge. |

## Schema migration (new forward-only file)
1. `alter table public.profiles drop constraint profiles_id_fkey;` (drop the `auth.users` FK) and
   `alter column id set default gen_random_uuid();`
2. `alter table public.profiles add column entra_oid text unique;`
3. `drop trigger on_auth_user_created on auth.users;` + `drop function handle_new_user();`
   (guard for the Supabase-only `auth` schema; in the Neon world these don't exist.)
4. Run `npm run db:types`; add characterization tests for the provisioning/link callback.

## The identity-seam swap — 22 `supabase.auth.getUser()` sites → `getCurrentUser()`
`lib/services/`: `user-tx.ts` · `active-household.ts` · `household-service.ts` · `permissions.ts` ·
`planner-service.ts` · `rating-service.ts` · `shopping-service.ts` · `ingestion-service.ts`.
`app/`: `(app)/layout.tsx` · `(app)/recipes/[id]/page.tsx` · `(app)/recipes/new/page.tsx` ·
`(app)/settings/account/{page,actions}.ts(x)` · `(auth)/login/login-form.tsx` ·
`(auth)/signup/signup-form.tsx` · `onboarding/page.tsx` · `page.tsx` · `invites/[token]/page.tsx` ·
`components/shell/app-shell.tsx` · `api/integrations/google/{start,callback}/route.ts` ·
`lib/supabase/middleware.ts`. (Login/signup **forms** are replaced by a "Sign in" redirect, not swapped.)

## Exit criteria
- Playwright **01** (auth + onboarding) passes; Google sign-in works end-to-end.
- `npm run typecheck` + the integration suite green; households still isolated under RLS.
- `/security-review` clean.

## Prereqs / decisions still to make at execution time
- **Whose Azure subscription / tenant** hosts the dev External ID tenant (free trial vs existing sub).
- The `AUTH_PROVIDER` gating signal (4.3).
- Branding on the Entra-hosted sign-in page (logo/colours) — deferred to taste.
