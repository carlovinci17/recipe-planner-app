# Lesson 4.5 — Security review (authentication)

**Date:** 2026-08-11   **Module:** 4   **WAF pillar(s):** Security   **Status:** 🟡 Reviewed; two deploy-time action items open.

Focused review of the Module 4 auth surface: token/session handling, the provisioning callback,
the identity seam, the middleware gate, and the RLS bridges. (Full slash-command `/security-review`
can still run before the final merge; this is the hands-on lesson pass.)

## Findings
| # | Area | Verdict | Why |
|---|---|---|---|
| 1 | **Session integrity** | ✅ Safe | The Auth.js cookie is signed with `AUTH_SECRET`; `session.user.id` (= `profiles.id`) can't be forged, so a user can't impersonate another profile. |
| 2 | **Provisioning SQL** (`provision.ts`) | ✅ Safe | All queries are parameterized Drizzle (`eq`, `.values`) — no string interpolation, no injection. |
| 3 | **Middleware gate** | ✅ Safe (defense-in-depth) | It checks *cookie presence* only (edge-safe, UX). The real check is `getCurrentUser()` (validates the cookie signature) + RLS at every page/action — a forged cookie yields `null` and a redirect. |
| 4 | **`profile-service` raw DB** (bypasses RLS) | ✅ Safe | Reads/writes are filtered by `getCurrentUser().id` — which comes from the *signed session*, not user input — so no Insecure Direct Object Reference (IDOR): a user can only touch their own row. |
| 5 | **Provisioning raw DB** (bypasses RLS) | ✅ Safe | A system op driven only by verified token claims (`oid`, `email`); not user-controllable beyond what the identity provider asserts. |
| 6 | **RLS `app_uid()` bridges** | ✅ Safe | `withUserContext` sets the `app.user_id` GUC (transaction-local) to the session's `profiles.id`; every policy scopes on `is_household_member(…, app_uid())`. A forgotten `WHERE` still can't leak across households. |
| 7 | **Open redirect via `?next=`** | ✅ Fixed | Hardened the login page to accept only same-site paths (reject absolute + `//` protocol-relative). Auth.js validates `redirectTo` too — belt and suspenders. |
| 8 | **`trustHost: true`** | ✅ Acceptable | Required behind the Container Apps ingress (forwarded host). Host-spoofing can't redirect the OAuth code elsewhere because the redirect URI is allowlisted in the Entra app registration. |
| 9 | **OAuth scopes** | ✅ Least privilege | Only `openid profile email offline_access` requested. |

## Accepted / tracked
- **Email-linking shim** (ADR-0005 Decision 6) trusts the `email` claim to link a pre-existing
  profile. Acceptable because External ID verifies email (Google verified; email+password via
  one-time passcode) and it's temporary + 2 users. **Mitigation: delete the shim after cutover**
  (already on `docs/decommission-checklist.md`).

## Action items before production (deploy-time)
1. **Move the client secret + `AUTH_SECRET` into Key Vault** (Module 2 pattern) — never ship them in
   env files to Azure.
2. **Rotate the Entra client secret** — it passed through chat during dev setup; issue a fresh one
   for production and retire the dev value.

## Evidence / links
- Reviewed: `auth.ts`, `lib/auth/{provision,current-user}.ts`, `lib/services/{profile-service,user-tx,permissions,active-household}.ts`, `lib/supabase/middleware.ts`, `app/(auth)/login/page.tsx`, the `app_uid` RLS bridges.
