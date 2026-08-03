/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Initializes Azure Monitor (Application Insights) so requests, dependencies,
 * exceptions, and logs are traced. The connection string is read from
 * APPLICATIONINSIGHTS_CONNECTION_STRING (sourced from Key Vault on Container Apps).
 *
 * Guarded to the Node.js runtime — OpenTelemetry needs Node, not the Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
    useAzureMonitor();
  }
}
