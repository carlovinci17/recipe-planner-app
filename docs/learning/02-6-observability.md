# Lesson 2.6 — Observability (Application Insights)

**Skills in play:** Microsoft Learn MCP (verified: Container Apps has no auto-instrumentation agent) · `diagnosing-bugs` (and a sharp lesson in *mis*-diagnosis — see below).

**Date:** 2026-08-03 (resolved 2026-08-04)   **Module:** 2   **WAF pillar(s):** Operational Excellence   **Token cost:** low   **Status:** ✅ **Done** — App Insights receiving requests, dependencies, traces + Live Metrics from the live app.

## What we did
- Created **Application Insights** `appi-recipe-planner` (workspace-based, linked to the Log Analytics workspace the Container Apps environment already provisioned).
- Stored its connection string in **Key Vault**; wired it onto the container app as a Key Vault reference secret → env var `APPLICATIONINSIGHTS_CONNECTION_STRING` (same passwordless pattern as Lesson 2.3).
- Instrumented the app: `@azure/monitor-opentelemetry` (the Azure Monitor OpenTelemetry **Distro**) + a Next.js `instrumentation.ts` calling `useAzureMonitor()`, with the package in `serverExternalPackages`.

## What works ✅ (verified in the portal, 2026-08-04)
- **Live Metrics** — real-time stream shows `1 server online` (revision `0000010`), ~1.3 req/sec, ~2.5 dependency calls/sec, live sample telemetry.
- **Transaction Search** — 234 traces / ~1.48k spans in a 30-min window; each request (`GET /recipes`, `/recipes/[id]/edit`, …) is a clickable end-to-end trace.
- **Dependencies auto-instrumented** — outbound `fetch` to Supabase (`…supabase.co/rest/v1/…`) shows as tracked dependencies. (Useful for Module 3: you'll *watch* these Supabase calls disappear as the DB moves to Neon.)
- **Console logs → Log Analytics** still flow independently (how we read logs all through Module 2).
- Sampling is on by default (portal shows the "data is being sampled" notice) — expected, cost-saving, nothing to fix.

## The plot twist: we misdiagnosed this first ⚠️→✅
Initially telemetry looked completely dead — Live Metrics blank, zero traces — even under traffic. We ran `diagnosing-bugs`, added startup logging, and concluded it was a **"Next.js-standalone + Azure Monitor OTel composition gap"** (Next owns the tracer provider; the Azure exporter doesn't see its spans). **That conclusion was wrong.**

The real culprit was the **expired ghcr pull PAT** (Lesson 2.4). While it was expired, new revisions failed to pull the image (`ImagePullUnauthorized` → `ActivationFailed`), so the *instrumented* image we thought we were testing **was never the one actually serving traffic** — Container Apps kept an older revision alive. We were reading blank telemetry from a build that didn't have working instrumentation, and blaming the SDK.

Once the PAT was rotated and revision **`0000010`** (clean `useAzureMonitor()` wiring) deployed *and pulled correctly*, telemetry flowed **exactly as Microsoft documents** — no `@vercel/otel`, no manual exporter, no code change needed.

**The lesson (worth more than the feature):** don't trust a diagnosis while a *confounding failure* is still in play. A broken deploy pipeline made a working SDK look broken. Fix the plumbing you *know* is broken before theorising about the thing you *think* is broken. **Verify what's actually running beats reasoning about what should be running.**

## Cost note
App Insights is pay-per-GB ingested; near-zero at demo volume, and default sampling keeps it there. It stays — it's the target observability, not transitional.

## Minor cosmetic note
Some dependency rows show `NaN ms` duration in the live sample list (a quirk of the OTel `fetch` instrumentation under Next). Cosmetic only — Transaction Search shows correct durations. Not chasing it.

## Evidence / links
- Verified via Microsoft Learn: [Observability in Container Apps](https://learn.microsoft.com/azure/container-apps/observability), [Enable Azure Monitor OpenTelemetry](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable), [Live Metrics is a Distro feature](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-configuration#live-metrics).
- Portal (2026-08-04): Live Metrics `1 server online`; Transaction Search 234 traces / 1.48k spans.
- Repo: `instrumentation.ts`, `next.config.ts` (`serverExternalPackages`), `package.json`.
- Live: `https://recipe-planner.delightfulrock-67fe0b09.australiaeast.azurecontainerapps.io`
