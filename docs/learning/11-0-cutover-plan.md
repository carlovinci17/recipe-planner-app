# Lesson 11.0 — Cutover & decommission: the plan (grilled → ADR-0011)

**Date:** 2026-08-18   **Module:** 11 (Cutover & decommission)   **WAF pillar(s):** Operational Excellence · Reliability   **Status:** ✅ Plan set — execution is the rest of Module 11.

## What we did
Grilled the go-live and settled three framing decisions ([ADR-0011](../adr/0011-cutover-decommission.md)):
**staged** flip (one flag at a time), **cut over first** and redesign (Module 10) later, and **finish
the Jobs port** so Inngest is fully retired. This lesson is the runbook the rest of the module executes.

## The mental model
Think of it like moving house one room at a time while still living there. Each subsystem has a light
switch (a provider flag) wired to both the old house (Supabase/Inngest/Vercel/n8n) and the new one
(Azure/Neon). We flip one switch, check that room works, sleep on it — and if anything's wrong, flip
it straight back. Only once every room is proven in the new house for a week do we hand back the keys
to the old one (delete the services). That last step is the only one we can't undo.

## Pre-flight (must land before the coupled flags flip)
| # | Task | Gates which flip | Where |
|---|---|---|---|
| P1 | **Neon prod prep**: confirm `authenticated` role + prelude (extensions + `auth.uid()` shim) are applied; do a **final data re-sync**; switch prod `DATABASE_URL` to the **pooled** (`…-pooler…`) string | DB | `scripts/neon-roles.sql`, `scripts/neon-prelude.sql`, migrate import |
| **P2+P3** | **The ingestion cutover (one unit).** See finding below. | DB · Realtime · Jobs | ingestion-service, Durable/internal endpoints, `active-jobs.tsx` |

### Finding (2026-08-18): P2 and P3 are one job — "the ingestion cutover"
P2 was scoped as "swap `active-jobs.tsx` realtime + publish ingestion progress." Investigation
showed that can't stand alone: **the entire ingestion subsystem was never ported to the Neon data
layer.** The core services dual-dispatch on `DATABASE_URL` (recipe-service 13 branches, planner 6),
but **`ingestion-service.ts` has 0** — it, the Inngest functions, and `active-jobs.tsx` are 100%
Supabase (`createSupabaseServerClient` / browser `supabase.from`). So the moment `DATABASE_URL`→Neon,
ingestion reads/writes hit an empty Supabase — regardless of realtime.

Therefore the realtime swap (P2) and the Durable port (P3) share the same prerequisite — porting
ingestion data access to Neon — and are done as **one unit**:
1. **Port ingestion data access** to the Drizzle/Neon dual-dispatch pattern (service reads/writes).
2. **Port the URL pipeline + Drive poller** to Durable Functions (Lesson 6.2 thin-orchestrator).
3. **Publish from the new write path** (`publishToHousehold` at job-status / event / recipe writes) —
   lands in the *permanent* Durable/internal-endpoint code, not throwaway Inngest code.
4. **Swap `active-jobs.tsx`** to server-fed reads (Neon) + `useHouseholdRealtime` (dual-run).

This unit gates the DB, Realtime, **and** Jobs flips. It's the biggest remaining piece of Module 11
and deserves its own focused pass (likely its own mini-plan).

## The staged flip order (each: set flag → redeploy → smoke-test → watch → tick checklist)
| Step | Flag → value | Why here | Smoke test |
|---|---|---|---|
| 1 | `DATABASE_URL` → Neon (pooled) | Foundation; Neon holds the migrated data with the **same user ids**, so it's consistent while Auth is still Supabase | App loads; recipes/planner/shopping read correctly |
| 2 | `STORAGE_PROVIDER=azure` | Near-stateless read; covers already uploaded to Blob (Module 9) | Images render; upload a photo |
| 3 | `AI_PROVIDER=foundry` | Independent; only affects *new* ingestions | Import a recipe → extraction succeeds |
| 4 | `AUTH_PROVIDER=entra` | Riskiest — do it after the easy wins are proven; links Entra identities to existing profiles by email | Google + email sign-in; existing user lands on their data |
| 5 | `REALTIME_PROVIDER=azure` | After P2 | Two browsers: planner/shopping/ingestion sync live |
| 6 | `JOBS_PROVIDER=durable` | After P3 | File + URL + Drive imports all produce `needs_review` |

## Then: watch, then decommission
- **Watch ~1 week** on Application Insights + a manual end-to-end pass (import → review → plan →
  shopping → check off → second browser live).
- **Decommission** per [`decommission-checklist.md`](../decommission-checklist.md): delete Vercel,
  Supabase, Inngest, n8n; strip old env/secrets/deps/dashboards; remove the auth email-linking shim;
  rotate the migration-era + chat-exposed Anthropic keys; update `CLAUDE.md` + `README.md`.
- **Confirm the Azure bill** matches the ~$18–22/mo estimate.

## Alternatives rejected
- **Big-bang flip** — six moving parts failing at once, no isolation. Rejected for a demo with a
  perfectly good staged path already built in.
- **Redesign first** — delays go-live a whole module and muddies cutover debugging.
- **Keep Inngest for URL/Drive** — leaves a service (and n8n) alive past cutover; incomplete teardown.

## Next
Two tracks run in parallel: **P1 — Neon prod prep** (you drive: role/prelude check + final re-sync,
then switch to the pooled string) unblocks the DB flip; **the ingestion cutover (P2+P3)** — a focused
coding unit — unblocks the Realtime + Jobs flips.
