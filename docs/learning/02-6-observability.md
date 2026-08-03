# Lesson 2.6 — Observability (Application Insights)

**Skills in play:** Microsoft Learn MCP (verified: Container Apps has no auto-instrumentation agent) · `diagnosing-bugs` (timeboxed).

**Date:** 2026-08-03   **Module:** 2   **WAF pillar(s):** Operational Excellence   **Token cost:** low   **Status:** ⚠️ **Partial (timeboxed)** — App Insights resource + platform logs/metrics ✅; live OTel request-tracing not emitting → **revisit**

## What we did
- Created **Application Insights** `appi-recipe-planner` (workspace-based, linked to the Log Analytics workspace the Container Apps environment already provisioned).
- Stored its connection string in **Key Vault**; wired it onto the container app as a Key Vault reference secret → env var `APPLICATIONINSIGHTS_CONNECTION_STRING` (same passwordless pattern as Lesson 2.3).
- Instrumented the app: `@azure/monitor-opentelemetry` + a Next.js `instrumentation.ts` calling `useAzureMonitor()`, with the package in `serverExternalPackages`. Local build clean; auto-deployed via the 2.5 pipeline.

## What works today ✅
- **Console logs → Log Analytics.** Container Apps ships pino stdout to the workspace (`ContainerAppConsoleLogs` table / `az containerapp logs show`). This is how we read logs throughout Module 2.
- **Container Apps metrics** (CPU/mem/replicas/requests) in Azure Monitor.
- The App Insights **resource exists** and is ready to receive data.

## What didn't work (the timeboxed gap) ⚠️
No telemetry of any type reaches App Insights — Live Metrics stays blank even under active traffic. The
instrumented image runs with no crash and no logged instrumentation error, but the SDK isn't emitting.
This is the known **Next.js-standalone + Azure Monitor OpenTelemetry** finickiness: the exporter is
fiddly to initialise/hook inside Next's standalone server (either the connection string doesn't resolve
at runtime, or the exporter doesn't wrap Next's request handling). Flagged as a risk before we started;
per the plan we **timeboxed** rather than rabbit-hole, since nothing is blocked.

## To revisit (later)
- Cleaner path: the **Container Apps OpenTelemetry agent** (preview) — a managed env-level agent that pipes OTel to App Insights, avoiding wrestling the exporter into the build.
- Or debug the in-process init: confirm the connection-string env resolves at runtime (container `exec`), and whether `register()` runs + `http` is patched before Next loads it.

## Cost note
App Insights is pay-per-GB ingested; near-zero at demo volume. It stays — it's the target observability, not transitional.

## Evidence / links
- Verified via Microsoft Learn: [Observability in Container Apps](https://learn.microsoft.com/azure/container-apps/observability) ("Container Apps doesn't support the Application Insights auto-instrumentation agent… instrument your application code using SDKs"), [Enable Azure Monitor OpenTelemetry](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable).
- Repo: `instrumentation.ts`, `next.config.ts` (`serverExternalPackages`), `package.json`.
