# Lesson 4.4 — Mobile hedge (decided: no API)

**Date:** 2026-08-11   **Module:** 4 (Authentication)   **WAF pillar(s):** Cost Optimization, Performance   **Status:** ✅ Done — design decision, nothing built.
**Decided in:** [ADR-0004](../adr/0004-mobile-strategy.md) · [ADR-0005](../adr/0005-authentication.md) Decision 5.

## The lesson (and why it's a no-op)
The original plan hedged for a future native mobile app by exposing a small **token-secured
Application Programming Interface (API)** — because a native app can't call a Next.js Server Action,
only an API. This lesson's outcome was to **decide *not* to build it.**

## Why not
Mobile here means a **first-class responsive web app (installable PWA)**, not a store-listed native
app (ADR-0004). Mobile browsers and an installed PWA use the **same Auth.js cookie session** as
desktop, and Entra's browser-delegated Google sign-in works in a mobile browser. So there's no native
client → no Bearer-token API surface to build, test, or security-review — for zero current users.

## The cheap hedge we *did* keep
The genuinely expensive-to-retrofit thing (services coupled to the web session) **doesn't exist**:
every service resolves identity through `runInUserTx` / `getCurrentUser()`, never raw cookies, and
`runInUserTx` already accepts an explicit `userId`. So if a native app is ever wanted, a future Bearer
validator plugs into the same `withUserContext` — additive, not a rewrite. **Revisit ADR-0004 only if
"ship a native/store app" becomes a real goal.**

## Net
- **Built:** nothing.
- **Cost:** $0 extra auth/API surface.
- **Kept open:** the native-app path stays cheap because the services are already identity-pluggable.
