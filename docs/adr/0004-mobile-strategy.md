# ADR-0004 — Mobile strategy

**Status:** ✅ Accepted — 2026-08-10 (resolved during Module 4 planning)
**Module:** 4 (designed here), 10 (responsive UI)
**WAF pillar(s):** Cost Optimization (primary), Performance Efficiency
**Deciders:** Carlo (owner), with Claude as advisor
**Related:** [ADR-0005](0005-authentication.md) (shared web session)

---

## Context

The app must be fully usable on mobile, as the original was. The open question was *how native*:
a store-listed native app (Expo/React Native), a Capacitor webview wrapper, or a responsive web
app / PWA. The answer drives whether the backend must expose a token-secured **API** (a native app
can't call a Next.js Server Action) — an expensive thing to retrofit if assumed away.

## Decision

**Mobile is a first-class responsive web experience (installable PWA), not a native app.**

- **No native/store app** is planned. Requirement = "full functioning web experience on mobile;
  mobile-friendly design."
- Therefore **no Bearer-token API surface** is built (ADR-0005 Decision 5). Mobile browsers and the
  installed PWA use the **same Auth.js cookie session** as desktop; Entra's browser-delegated Google
  sign-in works in a mobile browser redirect.
- **Mobile-friendly design is real work** — but it's UI (Module 10: bottom-nav shell, the planner
  grid transposing to slot-columns × day-rows on small screens), not auth or API.

## Consequences

- **Pros:** zero extra auth/API surface to build, test, and security-review for a 2-user demo; the
  cheapest path that still ships a good mobile experience.
- **Cons / hedge:** if a native app is ever wanted, a Bearer path must be added. That stays **cheap**
  because services are identity-pluggable (they resolve identity via `runInUserTx`/`getCurrentUser`,
  never raw cookies) — a future Bearer validator plugs into the same `withUserContext`. Revisit this
  ADR only if "ship a native/store app" becomes a real goal.

## Alternatives considered (and why not)

- **Expo / React Native (native UI)** — best native feel, highest cost; requires the Bearer API.
  Not justified without a product/store requirement.
- **Capacitor webview wrapper** — store presence with high reuse, but risks Apple's "minimum
  functionality" rejection and adds a build/release pipeline for no current need.
- **Static export + client rendering** — would force dropping Server Actions/RSC; an architectural
  rewrite that fights the whole design. Rejected.
