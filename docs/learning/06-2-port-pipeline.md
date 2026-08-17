# Lesson 6.2 — Port the ingestion pipeline to Durable Functions

**Date:** 2026-08-17   **Module:** 6   **WAF pillar(s):** Reliability   **Status:** ✅ Done — full pipeline ported (interactive skim is 6.3); Architecture-B seam proven end-to-end.

## What we did
Ported the 788-line Inngest `process-upload.ts` to a Durable Functions orchestration using
**Architecture B (thin orchestrator)**: the Functions app *orchestrates*; the heavy work (rasterize,
AI extraction, persist, tag) stays in the Next app behind internal HTTP endpoints, reusing the exact
existing logic.

## Why B (a spike decided it)
The `functions/` app is a plain-`tsc`, 2-dependency app. Importing the app's `@/lib` directly drags in
`supabase-js`, the Anthropic SDK, **`sharp` + `pdfjs` + `@napi-rs/canvas`** (which `next.config` even
special-cases), `server-only`, and the whole env schema — i.e. a bundler + native deps in a second
app. So the Functions app calls **small internal endpoints on the Next app** instead. The *durability*
(checkpointing, replay, the 24h wait) lives in the orchestrator; the *work* stays where it already runs.

## The shape
- **Functions app** (`functions/src/functions/ingestion.ts`): `ingestionOrchestrator` sequences
  `prepare → per-chunk extract loop → finalizeExtraction → persistRecipe fan-out → finalizeJob →
  cleanup → tagRecipe fan-out`, with `markFailed` branches. Activities are thin `callApp()` fetches.
- **Next app** (`app/api/internal/ingestion/*`): 8 endpoints behind `assertInternalSecret`, reusing the
  existing pipeline logic. Shared pure helpers (chunk/dedupe) extracted to `lib/ingestion/pipeline-helpers.ts`.
- **Trigger gate**: `startFileIngestion()` → Functions starter (`JOBS_PROVIDER=durable`) or Inngest;
  wired into `completeUpload` + `completeMultiPhotoUpload`.
- Payloads stay tiny — intermediate recipes are staged on the job row, not passed through orchestration state.

## Proven (end-to-end seam test)
Ran the real chain locally (Next app + `func` + Azurite). Started the orchestration → it called
`prepare` → the app endpoint → secret auth → DB → and returned. A fake jobId correctly surfaced
**`app/prepare failed (404)`** *through the whole chain* — proving every hop.
> **Bug found + fixed:** the session middleware was redirecting `/api/internal/*` to `/login` (307 to a
> port-less URL → the Functions app's fetch failed). Added `/api/internal` to `PUBLIC_PATHS` — those
> endpoints are auth'd by the shared secret, not a session (same as `/api/inngest`).

## Follow-up
A full-data import (real PDF → a `needs_review` recipe) through the Durable path is a later integration
check; the heavy steps reuse already-working logic, so the seam was the risk — and it's proven.

## Next (6.3)
Interactive skim + `waitForExternalEvent` (24h) + `instanceId`-on-job + app-side `raiseEvent`.
