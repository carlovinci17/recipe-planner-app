# ADR-0007 — Background jobs: Inngest → Azure Durable Functions

**Status:** Accepted (2026-08-13)   **Module:** 6
**Related:** [0003 service signatures](0003-service-signatures.md), [0006 storage](0006-storage.md). Verified via Microsoft Learn.

## Context
Inngest runs the durable background work — 8 functions, the core being `process-upload.ts`
(788 lines): checkpointed `step.run` stages, a **human-in-the-loop wait**
(`step.waitForEvent("await-skim-selection")` + timeout), a **tagging fan-out** (`step.sendEvent`),
plus **cron pollers/sweeps** (Drive + stuck-job). Inngest must go. We need durable, replayable,
idempotent orchestration with cheap long waits and timers — on Azure, on our TypeScript stack.

## Decision
1. **Azure Durable Functions** (TypeScript), orchestrator + activity model. It maps 1:1 onto the
   Inngest shape (checkpoint/replay, `waitForExternalEvent`, fan-out/fan-in, timers) and stays on Node.
2. **Host on the Flex Consumption plan** — a *separate* serverless Functions app, **scale-to-zero**,
   pay-per-execution. Not the Container App (that couples jobs to web compute).
3. **State backend: Azure Storage** (pay-per-use), not Durable Task Scheduler (managed, standing cost).
4. **Cold start is acceptable, start at scale-to-zero.** These are background jobs (an import already
   takes seconds–minutes; the UI shows progress), so a few cold-start seconds are invisible — unlike a
   synchronous service. Durable waits are *dehydrated* (no compute, no cost while waiting). If cold
   start ever matters, flip the Flex **always-ready = 1** knob on the `durable` group (one setting).
5. **Local dev: `func` (Azure Functions Core Tools) + Azurite** — replaces the Inngest dev CLI.

## Mapping (Inngest → Durable Functions)
| Inngest | Durable Functions |
|---|---|
| `step.run(...)` | an **activity** (idempotent; catch persist errors *inside*, return tagged result) |
| `step.waitForEvent(..., timeout)` | `waitForExternalEvent` + a **durable timer** |
| `step.sendEvent` fan-out (tagging) | **fan-out/fan-in** (sub-orchestrations / activities) |
| cron pollers + sweeps | **timer-triggered** functions |
| event catalog (`ingestion/*`) | HTTP/queue **starter** functions that raise external events |

## Migration shape
Unlike the DB/auth/storage swaps (env-gated dual-run in one process), background jobs are a **separate
compute** — so we **build the Functions app alongside** Inngest, then **cut over** and delete Inngest
+ **n8n** + the Drive webhook. No `STORAGE_PROVIDER`-style flag inside the app for this one.

## Alternatives rejected
- **Container-App-hosted Functions runtime** — one resource, but couples jobs to web compute, no clean scale-to-zero.
- **Durable Task Scheduler backend** — recommended by MS, but a standing managed cost; overkill at 2 users.
- **Logic Apps** — low-code, not the code-first TS control we want.
- **Plain Service Bus queue + workers** — reinvents durability/replay/waits by hand.

## Consequences
- New resources: a Functions app (Flex Consumption) + an Azure Storage account for orchestration state; deploy via `azd`.
- Cutover deletes Inngest, n8n, and `app/api/webhooks/drive/`.
