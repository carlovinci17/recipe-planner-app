/**
 * Next.js instrumentation hook — initializes Azure Monitor (Application Insights).
 *
 * `useAzureMonitor()` (the Azure Monitor OpenTelemetry Distro) auto-instruments the Next.js
 * server: incoming requests, outbound fetch/dependencies, and Live Metrics all flow to App
 * Insights — verified live in the portal (Lesson 2.6). Driven by
 * APPLICATIONINSIGHTS_CONNECTION_STRING, which resolves from Key Vault via the container app's
 * managed identity. (An earlier "no telemetry" scare was an expired-image-pull-PAT red herring,
 * not an SDK gap — see Lesson 2.6.)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
    useAzureMonitor();
  }
  // NOTE: Langfuse tracing of the /api/assistant route is a follow-up (docs/TODO.md).
  // @opentelemetry/sdk-node doesn't bundle in Next's instrumentation hook; the
  // Kitchen Assistant scripts trace fine, but wiring app-route tracing needs a
  // lighter tracer-provider setup. Tracked with the token-capture TODO.
}
