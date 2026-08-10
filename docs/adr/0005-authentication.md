# ADR-0005 — Authentication (Entra External ID + Auth.js)

**Status:** ✅ Accepted — 2026-08-10
**Module:** 4 (Authentication)
**WAF pillar(s):** Security (primary), Operational Excellence
**Deciders:** Carlo (owner), with Claude as advisor
**Related:** [ADR-0002](0002-rls-without-postgrest.md) (RLS/GUC), [ADR-0003](0003-service-signatures.md) (stable service API), [ADR-0004](0004-mobile-strategy.md) (mobile = responsive PWA)

---

## Context

The rebuild drops Supabase Auth. Today the app uses `@supabase/ssr` cookie sessions, client-side
`signInWithPassword`/`signInWithOAuth`, and resolves identity via `supabase.auth.getUser()` at
**22 call sites**. `profiles.id` is a FK to `auth.users(id)`, mirrored 1:1 by the `handle_new_user`
trigger, and **all 16 tables** FK to `profiles(id)`. RLS already reads `app_uid()` =
`coalesce(app.user_id GUC, auth.uid())` and `withUserContext(userId)` sets that GUC (ADR-0002).

The replacement must: keep **Google + email/password** sign-in; not touch the ~12,800 lines in
`app/` beyond a mechanical identity-seam swap (ADR-0003); and preserve the household-isolation
guarantee unchanged.

**Forced constraint:** Google federation in Entra External ID requires **browser-delegated auth**
(Microsoft-hosted sign-in pages) — native/in-app auth supports local accounts only. So the app's
custom login/signup forms are replaced by a redirect to the Entra-hosted user flow. Same Google
account, same result; the sign-in screen becomes Entra's (brandable). Verified via MS Learn:
_"Identity providers for external tenants"_ and _"Create a sign-up and sign-in user flow"_.

## Decisions

### 1. Library — **Auth.js (NextAuth v5)** with the Entra External ID provider
Points at the external tenant's `ciamlogin.com` OIDC authority. Chosen over MSAL Node and a
hand-rolled OIDC client to **minimise self-written security code** in a security-critical module,
and because Auth.js's `auth()` gives one drop-in seam for the 22 `getUser()` sites. MSAL Node is
the fallback if External ID hits an Auth.js limitation.

### 2. Canonical user id — **`profiles.id` stays an app-owned UUID; add unique `profiles.entra_oid`**
`profiles.id` drops its `auth.users` FK and becomes a standalone `gen_random_uuid()` PK. The Entra
`oid` is stored in a new unique `entra_oid` column, not used as the PK. Rejected the alternative
(`profiles.id = oid`) because it would force rewriting the PK **and every FK across all 16 tables**
during cutover. This keeps ADR-0002 byte-for-byte identical (same UUID into the same GUC) and keeps
the data model IdP-agnostic.

### 3. Provisioning — **JIT in the Auth.js sign-in callback**
Replaces the `handle_new_user` DB trigger. On first sign-in, upsert the profile (id, email,
display_name, avatar_url from token claims) before the session is issued. Runs once per login, off
the request hot path, with claims in hand.

### 4. Identity seam — **one `getCurrentUser()` helper; session carries id + basic profile fields**
The Auth.js `jwt` callback stores `profiles.id` (+ email/name/avatar) on the token. `getCurrentUser()`
reads it from the signed cookie — **no DB or network round-trip**. All 22 `supabase.auth.getUser()`
sites swap to `getCurrentUser()`; `runInUserTx` feeds `user.id` into `withUserContext` exactly as
before. **Retires tech-debt #3** (the per-request round-trip to the Supabase auth server).

### 5. Mobile / API — **no Bearer API; responsive PWA on the shared web session** (ADR-0004)
Mobile is a first-class responsive web experience, not a native app, so mobile browsers and an
installed PWA use the **same Auth.js cookie session**. No Bearer-token API surface is built.
Services are already identity-pluggable (they get identity via `runInUserTx`/`getCurrentUser`, never
raw cookies), so a Bearer path can be added later at near-zero cost **only if** a native app is ever
wanted. Zero API auth code in Module 4.

### 6. Existing-user cutover — **link-by-verified-email in the callback (temporary shim)**
On first Entra login the provisioning callback branches:

| Match on token | Action | Keep after cutover? |
|---|---|---|
| `oid` found | log in as that profile | ✅ normal login |
| `oid` absent, **email** matches an unlinked profile | set `entra_oid` (link, data preserved) | ❌ **remove** — one-time shim |
| `oid` absent, no email match | create a new profile | ✅ invited members are new users |

No separate bulk migration: linking is a one-column backfill, so every recipe/household FK is
untouched (Decision 2 pays off). Trusts the **email claim**, honoured only because the IdP verifies
it (Google verified; External ID local accounts verify via OTP/password). The email-linking branch
is a migration shim — **deleted after both users have linked** (tracked in
`docs/decommission-checklist.md`); it closes an email-collision takeover vector.

## Consequences

- **Pros:** minimal custom security code; zero-risk data cutover; RLS/ADR-0002 unchanged; faster
  identity checks (local cookie vs network); IdP-agnostic schema; one testable identity seam.
- **Cons / trade-offs:** the login screen moves to Entra-hosted pages (forced by Google); a new
  `entra_oid` column + migration to drop the `auth.users` FK and the `handle_new_user` trigger; a
  temporary linking shim to remember to delete.
- **Security review:** mandatory `/security-review` on token handling and the provisioning callback
  (Lesson 4.5) before merge.

## Alternatives considered (and why not)

- **MSAL Node** — first-party, but hand-rolls the cookie/session and token refresh: more custom
  security surface for no benefit here. Kept as fallback.
- **`profiles.id = oid`** — direct, but a high-risk PK+FK rewrite across 16 tables at cutover.
- **Bearer-token API now** — insures a native app we've decided not to build; deferred.

## Evidence / links

- MS Learn: _Identity providers for external tenants_; _Create a sign-up and sign-in user flow for
  an external tenant app_; _Add Google as an identity provider_ (browser-delegated requirement).
- Repo: `lib/supabase/{server,middleware}.ts`, `lib/services/user-tx.ts`, `lib/services/active-household.ts`,
  `supabase/migrations/20260101000000_init_schema.sql` (profiles + `handle_new_user`).
