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

// Daily, 17:00 UTC (3–4 am Sydney): mark long-stuck ingestion jobs as failed
// (safety net). The container scales to zero when idle, so an hourly tick would
// wake it and Neon 24 times a day just to find nothing stuck.
app.timer("sweepStuckJobs", {
  schedule: "0 0 17 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    try {
      const result = await callApp<{ cleared: number }>("sweep-stuck", {});
      if (result.cleared > 0) context.log(`Swept ${result.cleared} stuck ingestion job(s).`);
    } catch (err) {
      context.error(`sweepStuckJobs timer failed: ${(err as Error).message}`);
    }
  },
});
