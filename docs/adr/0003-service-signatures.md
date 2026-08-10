# ADR-0003 — Service signatures stay identical during the swap

**Status:** ✅ Accepted — 2026-07 (governs every module)
**Module:** cross-cutting (established Module 1, proven Module 3)
**WAF pillar(s):** Operational Excellence (primary), Reliability
**Deciders:** Carlo (owner), with Claude as advisor

---

## Context

The rebuild swaps four platforms under a working app: Postgres client (M3), auth (M4), storage
(M5), jobs (M6), AI (M7), realtime (M8). If each swap rippled into the ~12,800 lines of `app/`
(routes, server actions, components), the app would be broken for months and every module would be
entangled with the next.

The codebase already has clean seams: `lib/services/*` is the domain API, `lib/{supabase,ai,inngest}/*`
are the platform adapters. That structure only pays off if we commit to a rule.

## Decision

**`lib/services/*` keeps its exact public API across the entire migration — only the internals
change.** A method's name, typed arguments, and return shape are a contract; the body may be
rewritten from Supabase → Drizzle → Entra as long as callers can't tell.

Corollaries:
- Platform coupling lives *behind* the service boundary, never in `app/`.
- New platform seams are introduced as **single helpers** (e.g. `runInUserTx` in M3, `getCurrentUser`
  in M4) rather than scattered call-site changes.
- Characterization tests pin the *observable* behaviour, so "the swap preserved behaviour" is
  provable, not hopeful (see [ADR-0002](0002-rls-without-postgrest.md), Lesson 3.5).

## Consequences

- **Pros:** the app runs throughout; modules stay independent and independently testable; `app/` is
  effectively untouched (Module 3 changed 0 route/component files behind the service API).
- **Cons:** occasionally forces an adapter to preserve a slightly awkward legacy shape rather than
  redesign it (logged as tech-debt to revisit *after* cutover, not during).
- **Proven:** Module 3 ported the entire data layer (6 services, 3 RPCs) with the service API and
  all `app/` call sites unchanged.

## Alternatives considered

- **Refactor services and callers together per module** — rejected; couples modules, multiplies the
  broken-state window, and makes "did behaviour change?" unanswerable.
