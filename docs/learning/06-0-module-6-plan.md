# Lesson 6.0 — Background jobs: design + mini-plan

**Date:** 2026-08-13   **Module:** 6   **WAF pillar(s):** Reliability · Cost   **Status:** ✅ Done — design decided ([ADR-0007](../adr/0007-background-jobs.md)).

## Goal
Replace **Inngest** with **Azure Durable Functions** (TypeScript) — durable, replayable background
jobs, cheap long waits, timers — then delete Inngest + n8n.

## Decisions (ADR-0007)
| Decision | Choice | Why |
|---|---|---|
| Engine | **Durable Functions** (orchestrator + activities) | 1:1 with the Inngest shape, stays on Node/TS |
| Host | **Flex Consumption**, scale-to-zero | cheapest; separate from web compute |
| State | **Azure Storage** backend | pay-per-use, no standing cost |
| Cold start | **accept it**, start at zero | background jobs are latency-tolerant; `always-ready=1` knob if ever needed |
| Local dev | **`func` + Azurite** | replaces the Inngest dev CLI |

## What we're porting (8 functions)
`processUpload` (the big one — human-in-the-loop wait + tagging fan-out), `processUrl`, `tagRecipe`,
`driveFolderPoller`, `processDriveFile`, `sweepStuckIngestionJobs`, `indexDriveFile`,
`sweepStuckDriveIndex`.

## Lessons
| # | Do |
|---|---|
| **6.1** | Durable Functions skeleton on Flex Consumption; run locally with `func` + Azurite |
| **6.2** | Port `processUpload` — each `step.run` → an idempotent **activity** (catch persist errors *inside*) |
| **6.3** | Human-in-the-loop: `waitForEvent` → **`waitForExternalEvent` + durable timer** |
| **6.4** | Pollers/sweeps → **timers**; port URL + tagging fan-out; delete **n8n** + Drive webhook |

## Migration note
Background jobs are separate compute → **build alongside Inngest, then cut over** (no in-app
`STORAGE_PROVIDER`-style flag for this one).
