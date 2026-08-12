# Lesson 4.2 — Add Google sign-in (federation)

**Date:** 2026-08-11 → 08-12   **Module:** 4 (Authentication)   **WAF pillar(s):** Security   **Status:** ✅ Done — Google **and** email/password both sign in and land in the app. Production-URL test deferred to deployment (below).

**Goal:** add a **"Sign in with Google"** button to the Entra-hosted sign-in page. Google sign-in runs
*inside* Entra External ID (one front door, Google is a method behind it — not a separate login).
**No code change** — once Google is on the user flow, the button appears automatically.

## Our tenant values (fill these into Google)
- **Directory (tenant) ID:** `f66738c4-f287-496c-b933-be09e749b945`
- **Tenant subdomain:** `recipeplanner` (from `recipeplanner.onmicrosoft.com`)

## Part A — Google Cloud Console (`console.cloud.google.com`)
1. **New Project** → name `Recipe Planner` → Create; make sure it's selected.
2. **APIs & Services → OAuth consent screen** → User Type **External** → Create.
   - App name, user support email, developer contact email.
   - **Authorized domains:** add `ciamlogin.com` **and** `microsoftonline.com`.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Application type **Web application**.
4. Under **Authorized redirect URIs**, add these seven (verified via MS Learn, values filled in):
   - `https://login.microsoftonline.com`
   - `https://login.microsoftonline.com/te/f66738c4-f287-496c-b933-be09e749b945/oauth2/authresp`
   - `https://login.microsoftonline.com/te/recipeplanner.onmicrosoft.com/oauth2/authresp`
   - `https://f66738c4-f287-496c-b933-be09e749b945.ciamlogin.com/f66738c4-f287-496c-b933-be09e749b945/federation/oidc/accounts.google.com`
   - `https://f66738c4-f287-496c-b933-be09e749b945.ciamlogin.com/recipeplanner.onmicrosoft.com/federation/oidc/accounts.google.com`
   - `https://recipeplanner.ciamlogin.com/f66738c4-f287-496c-b933-be09e749b945/federation/oauth2`
   - `https://recipeplanner.ciamlogin.com/recipeplanner.onmicrosoft.com/federation/oauth2`
5. **Create** → record the **Client ID** and **Client secret**.

## Part B — Entra admin center (`entra.microsoft.com`, in the Recipe Planner Customers tenant)
6. **External Identities → All identity providers → Google** → paste the Google **Client ID** + **Client secret** → **Save**.
7. **External Identities → User flows → `SignUpSignIn` → (Settings) Identity providers →** tick **Google** → **Save**.

## Prove it
Sign out (`/api/auth/signout`), then `/login` → **Sign in with Microsoft** → the hosted page now shows
**Sign in with Google** alongside email/password. Sign in with a Google account → a new customer
account (with a `federated` Google identity) is created and you land in the app.

## Notes
- **Cost:** still **$0** — social sign-in is a core feature under the 50,000 free Monthly Active Users (MAU).
- **No `.env` / code change.** The Google Client ID/secret live in the *Entra tenant*, not our app.
- If a redirect URI is rejected at sign-in, copy the exact one Entra shows on the **Google** provider
  config page and match it in Google (formats occasionally change — the admin center is authoritative).

## Gotcha we hit (recorded)
`redirect_uri_mismatch` from Google — the address External ID actually sent was
`https://<tenant-ID>.ciamlogin.com/<tenant-ID>/federation/oauth2` (the **tenant-ID** host, not the
`recipeplanner` vanity host our first list used for that path). Fix: read the exact `redirect_uri`
from Google's **"see error details"** link and register it verbatim (no `flowName=…` query — that's a
separate parameter, not part of the URI). Also: signing in with Google as `carlovinci17@gmail.com`
hit Entra's **"Account already exists"** prompt → **Next** *links* Google to the existing Carloochy
account (same `oid`) rather than duplicating — good.

## Deferred to deployment (production URL)
When the app has a real Azure URL, do these (nothing else about Google changes):
- **Entra app registration → Redirect URIs:** add `https://<prod-domain>/api/auth/callback/microsoft-entra-id`
  (dev has only the `localhost:3000` one).
- **Google authorized redirect URIs need *no* change** — they point at Entra's `ciamlogin.com`
  endpoints (tenant-specific), not at our app's host.
- Set `AUTH_PROVIDER=entra` + the `AUTH_*` secrets in prod via **Key Vault**; **rotate** the client
  secret (Lesson 4.5 action items).
- Re-run the final sign-in sweep against the production URL.

## Evidence / links
- MS Learn: _Add Google as an identity provider_ (create Google app → configure in tenant → add to user flow).
