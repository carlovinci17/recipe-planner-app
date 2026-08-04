/**
 * Next.js instrumentation hook — initializes Azure Monitor (App Insights).
 * Temporarily verbose to diagnose why telemetry isn't emitting.
 */
export async function register() {
  console.log(
    `[instrumentation] register() ran · NEXT_RUNTIME=${process.env.NEXT_RUNTIME} · ` +
      `hasConnString=${!!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING} · ` +
      `connLen=${process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.length ?? 0}`,
  );

  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    try {
      const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
      useAzureMonitor();
      console.log("[instrumentation] useAzureMonitor() initialized ✅");
    } catch (e) {
      console.log(`[instrumentation] useAzureMonitor() FAILED: ${(e as Error).message}`);
    }
  } else {
    console.log(
      "[instrumentation] guard SKIPPED init (runtime not nodejs, or conn string missing)",
    );
  }
}
