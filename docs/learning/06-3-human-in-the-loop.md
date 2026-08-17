# Lesson 6.3 — Human-in-the-loop: the skim wait

**Date:** 2026-08-17   **Module:** 6   **WAF pillar(s):** Reliability   **Status:** ✅ Done — the orchestration pauses for the user's recipe selection (compile-verified; full interactive run is the Module 6 integration check).

## What we did
Added the interactive skim to the Durable Functions pipeline: for multi-recipe docs, skim the titles,
then **pause** for the user to pick which recipes to deep-extract — the Durable Functions equivalent of
Inngest's `step.waitForEvent`.

## The pause (the interesting bit)
In the orchestrator (docs ≥ 3 pages, non-bulk):
```
skim → Task.any([ waitForExternalEvent("skimSelection"), createTimer(now + 24h) ])
```
- **Selection wins** → cancel the timer, apply the selection (narrow the pages), extract.
- **Timer wins** → mark the job failed (skim timed out).

While parked, Durable Functions **dehydrates** the orchestration — no compute, no tokens — for up to
24h. That's the whole point: a cheap, durable pause that survives restarts.

## The resume
- The orchestration's **`instanceId` = the jobId** (set at `startNew`), so the app knows exactly which
  instance to signal — no extra column, no lookup.
- `commitSkimSelectionAction` is gated: `JOBS_PROVIDER=durable` → POST the Functions `raise-event`
  endpoint → `client.raiseEvent(jobId, "skimSelection", {...})`; else the old Inngest event.
- New endpoints: `skim` (AI skim + save `skim_results`), `apply-selection` (narrow pages ± 1, stash
  selected titles + batch source override). `finalize` applies the title filter; `persist` honours the
  source override.

## Verification
Compile-verified. The wait is standard Durable Functions, and the resume seam mirrors the
already-proven starter seam. A full interactive run (skim → pick → extract) lands with the Module 6
integration check.

## Next (6.4)
Drive poller + stuck-job sweeps → timer triggers; port the URL pipeline; delete n8n + the Drive webhook.
