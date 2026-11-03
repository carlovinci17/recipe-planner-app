import { app, InvocationContext, Timer } from "@azure/functions";
import { callApp } from "../lib/callApp";

/**
 * Timer-triggered functions (Module 6, 6.4) — the Durable Functions replacement
 * for Inngest crons. NCRONTAB is 6-field (sec min hour day month weekday).
 * Thin: each timer calls an internal endpoint on the Next app that does the work.
 *
 * Keep these rare. Every tick wakes the container and queries Neon, and Neon only
 * suspends after 5 idle minutes — a 5-minute timer kept both awake all month.
 * Google Drive sync is deliberately NOT a timer: it runs from "Sync now".
 */

// Hourly: mark long-stuck ingestion jobs as failed (safety net). A job only
// counts as stuck after 45 minutes without progress, so hourly is plenty.
app.timer("sweepStuckJobs", {
  schedule: "0 0 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    try {
      const result = await callApp<{ cleared: number }>("sweep-stuck", {});
      if (result.cleared > 0) context.log(`Swept ${result.cleared} stuck ingestion job(s).`);
    } catch (err) {
      context.error(`sweepStuckJobs timer failed: ${(err as Error).message}`);
    }
  },
});
