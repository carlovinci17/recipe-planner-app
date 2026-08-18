# ADR-0011 — Cutover & decommission strategy

**Status:** Accepted (2026-08-18)
**Deciders:** Carlo (+ Claude)
**Supersedes / relates to:** the per-subsystem ADRs 0001, 0005, 0006, 0007, 0009 (each built the flag this ADR now flips) and the living [`docs/decommission-checklist.md`](../decommission-checklist.md).

## Context
Every subsystem was migrated behind an **independent provider flag** that still defaults to the
old service in production: `DATABASE_URL` (Supabase→Neon), `AUTH_PROVIDER`, `STORAGE_PROVIDER`,
`REALTIME_PROVIDER`, `AI_PROVIDER`, `JOBS_PROVIDER`. The new stack is built and proven in dev; the
app in production is still 100% on Supabase / Inngest / Vercel / n8n. Module 11 is the go-live: flip
production onto Azure/Neon, watch, then delete the old services.

Three subsystems carry **cutover-coupled deferrals** that must land before their flag can flip:
Jobs (URL-import pipeline + Drive poller not yet ported to Durable Functions), Realtime (ingestion
progress still publishes on Supabase), and DB (prod Neon needs final data re-sync + the pooled
connection string).

## Decision

**1. Staged flip, one flag at a time — not big-bang.** Flip one subsystem in production, smoke-test
+ watch, then the next. Order (dependency-driven):

> **DB → Storage → AI → Auth → Realtime → Jobs**

DB first because everything reads from it (Neon already holds the migrated data with the *same*
user ids, so it's consistent while Auth is still Supabase). Storage + AI are near-stateless reads.
Auth mid-sequence (riskiest — a wrong flip locks users out; put it after the easy wins are proven).
Realtime + Jobs last because they have pre-flight engineering to finish.

**Why staged (Reliability + Operational Excellence):** the blast radius of any failure is a single
subsystem, and **every flag flips back instantly** — a bad deploy is a one-line env revert, not a
rollback. It's also the best teaching: each seam is exercised in isolation.

**2. Cut over on the current UI; Module 10 (redesign) comes after.** The redesign is independent of
the migration and must not gate go-live for a two-user demo. Mixing a big visual change into the
cutover window would also make design bugs indistinguishable from cutover bugs.

**3. Finish the Jobs port so Inngest is fully retired.** Port the URL-import pipeline + Drive poller
to Durable Functions (a mechanical repeat of the Lesson 6.2 thin-orchestrator pattern) before
flipping `JOBS_PROVIDER=durable`. Descoping would leave Inngest + n8n alive past cutover and defeat
the point of the module.

**4. Delete nothing until its replacement is proven in production, then watch a week.** Run the new
flag in prod, confirm via Application Insights + a manual smoke test, keep the old service reachable
(flag-revertable) through a ~1-week watch, and only then execute the [decommission checklist]
removals. Deletion is the one irreversible step — it comes last, deliberately.

## Consequences
- **Positive:** minimal-risk go-live; each step independently reversible; a clean, complete teardown
  (no orphaned services on the bill); a documented runbook others can follow.
- **Negative / cost:** more deploys and more elapsed time than a big-bang; the Jobs port is real
  work; both stacks bill in parallel during the watch window (acceptable — days, at demo scale).
- **Follow-ups after cutover confirmed:** remove the auth email-linking shim (closes an
  email-collision takeover vector); strip old env/secrets/deps/dashboards per the checklist; update
  `CLAUDE.md` + `README.md`.

## The staged runbook
Per-subsystem detail lives in [`docs/learning/11-0-cutover-plan.md`](../learning/11-0-cutover-plan.md).
Each flip is the same shape: **set the flag in prod (Key Vault / Container Apps) → redeploy →
smoke-test the one subsystem → watch → tick the checklist**. Pre-flight (Neon final sync, realtime
ingestion publish, Jobs port) lands first; deletion lands last.
