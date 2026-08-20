# ADR-0012 — Sign-in UX: browser-delegated Entra + Company Branding

**Status:** ACCEPTED (2026-08-20)   **Module:** 4 (Authentication)   **WAF pillar(s):** Security · Operational Excellence

## Context
Under `AUTH_PROVIDER=entra` the app authenticates via **Microsoft Entra External ID** (Customer
Identity, CIAM) through **Auth.js (NextAuth v5)** browser-delegated OpenID Connect. During testing the
Microsoft-hosted sign-in page ("RECIPE PLANNER CUSTOMERS / Sign in") felt off-brand and inserted extra
screens. We wanted end users to see a BiteBuddy-looking login with Facebook, email, and Google — ideally
with no Microsoft "entry page" — while keeping the option to add providers (Facebook/Apple) later.

## Decision
**Keep browser-delegated Auth.js and brand the Microsoft-hosted page via Company Branding.** One
reliable, secure sign-in screen, styled to match the app (logo, warm off-white background, terracotta
buttons, tenant renamed to "BiteBuddy"). See `docs/branding/entra-branding-spec.md` + `entra-signin.css`.

## Options considered
| Option | Removes hosted page? | Keeps Entra? | Security | Verdict |
|---|---|---|---|---|
| **Browser-delegated + Company Branding** (chosen) | No (1 branded screen) | ✅ | 🟢 Highest (MS-hosted credential surface) | **ACCEPTED** |
| `domain_hint` issuer acceleration | Partly | ✅ | 🟢 | Rejected — value never matched this tenant's Google IdP (`google`→AADSTS90023, `google.com`/`accounts.google.com` ignored). |
| **Native authentication** (MSAL.js) | ✅ Yes | ✅ | 🟡 shared responsibility | Rejected for now — client-side MSAL rewrite away from server-session Auth.js; MS Learn states browser-delegated is *more secure*. Social still opens the provider's own page anyway. |
| Direct Auth.js Google/Facebook, drop Entra | ✅ Yes | ❌ | 🟡–🔴 | Rejected — abandons Module 4's CIAM; we'd own email/password + user store. |

## Facts that drove it (verified on Microsoft Learn)
- Federated/social sign-in (Google/Facebook/Apple) is **browser-delegated only**; **native auth supports
  local accounts only** — and even native auth opens a browser for the social IdP step.
- *"Browser-delegated authentication is the more secure option. Microsoft manages the sign-in surface…"*
- Entra **auto-provisions** the account on first sign-in — sign-up and sign-in are one flow.
- Company Branding customises logo, background, colours, favicon, custom text, and **custom CSS**; the
  tenant **Name** replaces the header text. External ID tenants are **exempt** from the CSS
  positioning-property retirement.

## Known External ID limitations (verified — do not re-attempt)
Three Microsoft-hosted screens **cannot** be removed in External ID today:
- **"Stay signed in?" (KMSI)** — no toggle in external tenants (User Settings / CA session controls don't apply).
- **"Choose an account to sign out"** — External ID shows it **even with a valid `id_token_hint`** (confirmed:
  the hint was sent correctly and the picker still appeared). We therefore **don't send `id_token_hint`**.
- **"Taking you to your organization's sign-in page"** interstitial — inherent to federation.

Making these feel on-brand (Company Branding, Module 10) is the only lever, not removal.

## Consequences
- **Code:** the in-app provider chooser + `domain_hint` experiment were removed; `/login` and `/signup`
  are a single button into the branded hosted page; the landing CTAs go straight there. Federated
  sign-out and "no forced account picker" are retained.
- **Adding a provider** (Facebook/Apple) = configure it in the Entra portal + it appears on the branded
  page automatically — no app code.
- **Reversible:** if a pixel-perfect in-app login becomes a hard product requirement, revisit **native
  authentication** (Microsoft has a React/Next.js JS SDK) accepting the rewrite + shared security
  responsibility.
