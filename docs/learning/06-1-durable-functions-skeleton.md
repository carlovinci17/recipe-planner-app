# Lesson 6.1 — Durable Functions skeleton (local + cloud)

**Date:** 2026-08-17   **Module:** 6   **WAF pillar(s):** Reliability · Cost   **Status:** ✅ Done — hello-world orchestration runs locally **and** on Azure (keyless, scale-to-zero).

## What we did
Stood up the Durable Functions app (`functions/` — a separate app from the web app, per
[ADR-0007](../adr/0007-background-jobs.md)) and proved the orchestrator/activity model end-to-end —
first on the laptop, then in the cloud — on a trivial sample, before porting the real pipeline.

## The sample (the "hello" of the model)
`functions/src/functions/hello.ts`, one file, three pieces:
- **activity** `sayHello` — the unit of work.
- **orchestrator** `helloOrchestrator` — fans out to 3 activities, fans in. Deterministic, no I/O.
- **HTTP starter** `helloStart` — kicks off a run, returns status URLs.

## Local
`func` (Azure Functions Core Tools) + **Azurite** (local storage emulator) → `func start` → hit
`/api/orchestrators/hello` → **Completed** with the 3 greetings.

## Cloud (Flex Consumption, keyless)
`infra/functions.bicep`: **FC1** plan (scale-to-zero), `functionAppConfig` (node 22, identity-based
deployment container), **Azure Storage** backend, **system-assigned Managed Identity** + blob/queue/table
role grants (no keys anywhere).
- `az deployment group create … --template-file infra/functions.bicep` → storage + plan + app + roles.
- `func azure functionapp publish func-recipe-jobs` → deploys the code.
- Same `/api/orchestrators/hello` call **in Azure** → **Completed**, 3 greetings (first call ~10s cold-start — expected).

## Why this mattered
De-risked the whole hard combo — Flex Consumption + Durable Functions + Managed-Identity storage — on a
3-line toy, so 6.2's port of `process-upload.ts` fights only the recipe logic, not the platform.

## Next (6.2)
Port `lib/inngest/functions/process-upload.ts` — each `step.run` → an idempotent activity.
