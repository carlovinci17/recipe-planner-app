/**
 * Next.js instrumentation hook — initializes Azure Monitor (Application Insights).
 *
 * KNOWN GAP (Lesson 2.6): this initializes *cleanly* — `register()` runs, the connection
 * string resolves from Key Vault, and `useAzureMonitor()` returns without error — but **no
 * telemetry exports** under Next.js standalone. Next registers its own OpenTelemetry tracer
 * provider and the Azure exporter doesn't capture its spans. Wiring is kept here, ready for the
 * fix (manual OTel setup / `@vercel/otel` with the Azure Monitor exporter). Console logs from the
 * app still flow to Log Analytics regardless.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
    useAzureMonitor();
  }
}
