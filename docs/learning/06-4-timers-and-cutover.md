# Lesson 6.4 — Timer triggers (+ what's deferred to cutover)

**Date:** 2026-08-17   **Module:** 6   **WAF pillar(s):** Reliability   **Status:** ✅ Timer pattern done. URL-pipeline port + Drive-poller swap + n8n/webhook deletion are sequenced into the Module 11 cutover (rationale below).

## What we did
Ported the **cron → timer** pattern — the last new Durable Functions mechanic. The stuck-job sweep now
runs as a timer-triggered function, the DF replacement for Inngest crons.

## The timer
`functions/src/functions/timers.ts`: `app.timer("sweepStuckJobs", { schedule: "0 */5 * * * *", … })`
(NCRONTAB is 6-field: sec min hour day month weekday). Thin — it calls
`/api/internal/ingestion/sweep-stuck` (architecture B). The sweep logic is extracted to
`lib/ingestion/sweep-stuck.ts` and **shared** with the Inngest cron; it's **idempotent**, so both
running during coexistence is harmless.

## Deferred to Module 11 (cutover) — and why
- **URL-pipeline port** (`process-url.ts` → Durable Functions): a *mechanical repeat* of the 6.2
  Architecture-B port (endpoints + orchestrator; no rasterize/chunk/skim). Little new learning — do it
  with the cutover so URL imports move across with everything else. Until then URL imports stay on
  Inngest (only `file.uploaded` is gated to durable).
- **Drive poller → timer**: unlike the sweep, polling is **not idempotent** — running both the Inngest
  cron and a DF timer would double-import. So it's a *flip-at-cutover* (one off, one on), not a
  coexistence step.
- **Delete n8n + `app/api/webhooks/drive/`**: teardown — deleting now breaks the live Drive path.
  Lives in the decommission checklist.

## Module 6 outcome
The hard, learning-rich migration is **done and proven**: the full interactive file-ingestion pipeline
(6.2) with a durable human-in-the-loop pause (6.3), on the skeleton (6.1), plus the timer pattern (6.4),
all running on Durable Functions behind `JOBS_PROVIDER=durable` — with Inngest still the default so
nothing breaks. What remains is mechanical repeats or teardown, sequenced into the cutover.
