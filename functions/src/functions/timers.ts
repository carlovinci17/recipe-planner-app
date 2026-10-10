import { app, InvocationContext, Timer } from "@azure/functions";
import { callApp } from "../lib/callApp";

/**
 * Timer-triggered functions (Module 6, 6.4) — the Durable Functions replacement
 * for Inngest crons. NCRONTAB is 6-field (sec min hour day month weekday).
 * Thin: each timer calls an internal endpoint on the Next app that does the work.
 */

// Every 5 minutes: mark long-stuck ingestion jobs as failed (safety net).
app.timer("sweepStuckJobs", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    try {
      const result = await callApp<{ cleared: number }>("sweep-stuck", {});
      if (result.cleared > 0) context.log(`Swept ${result.cleared} stuck ingestion job(s).`);
    } catch (err) {
      context.error(`sweepStuckJobs timer failed: ${(err as Error).message}`);
    }
  },
});

// Every 5 minutes: Google Drive folder sync. The app re-lists folders that are
// due (every 30 min) and starts up to a few new files, so a 100-PDF first sync
// trickles through instead of firing 100 vision calls at once.
app.timer("driveSync", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    try {
      const r = await callApp<{ listed: number; queued: number; failed: number }>("drive-sync", {});
      if (r.listed || r.queued || r.failed) {
        context.log(`Drive sync: listed ${r.listed} folder(s), queued ${r.queued}, failed ${r.failed}.`);
      }
    } catch (err) {
      context.error(`driveSync timer failed: ${(err as Error).message}`);
    }
  },
});
