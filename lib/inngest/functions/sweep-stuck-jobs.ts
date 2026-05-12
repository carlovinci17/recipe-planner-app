import "server-only";
import { inngest } from "@/lib/inngest/client";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Safety net: any ingestion_jobs row that's been in `status='processing'`
 * for more than NO_PROGRESS_MIN minutes is almost certainly orphaned (the
 * worker died, onFailure hook didn't fire, etc.). Mark them failed with a
 * human-readable reason that includes which step was last alive — much
 * more actionable than a generic "pipeline timed out".
 *
 * The pipeline emits heartbeat events between chunks of long operations
 * (vision-extract, persist loop) which refresh `updated_at`. A row that
 * still doesn't move after 45 min is genuinely dead.
 */
const NO_PROGRESS_MIN = 45;

const STEP_LABELS: Record<string, string> = {
  file_uploaded: "downloading the file",
  ingestion_requested: "queueing the import",
  ai_processing_started: "AI vision extraction",
  extraction_completed: "validating the extraction",
  validation_completed: "saving recipes",
  recipe_ready_for_review: "finalizing",
};

export const sweepStuckIngestionJobs = inngest.createFunction(
  {
    id: "ingestion-sweep-stuck-jobs",
    name: "Mark long-stuck ingestion jobs as failed",
  },
  { cron: "*/5 * * * *" }, // every 5 minutes
  async ({ step }) => {
    const cleared = await step.run("sweep", async () => {
      const supabase = createSupabaseAdmin();
      const cutoff = new Date(Date.now() - NO_PROGRESS_MIN * 60 * 1000).toISOString();

      // Find candidates first so we can fetch each one's last event and
      // build a contextual error message — much more useful for the user
      // than a generic timeout string.
      const { data: stuck, error: stuckErr } = await supabase
        .from("ingestion_jobs")
        .select("id, updated_at, source_kind")
        .eq("status", "processing")
        .lt("updated_at", cutoff);
      if (stuckErr) throw stuckErr;
      if (!stuck || stuck.length === 0) return 0;

      let updated = 0;
      for (const job of stuck) {
        // Latest event tells us roughly where the pipeline got stuck.
        const { data: lastEvent } = await supabase
          .from("ingestion_events")
          .select("kind, created_at")
          .eq("job_id", job.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const minutesIdle = Math.max(
          1,
          Math.round((Date.now() - new Date(job.updated_at).getTime()) / 60000),
        );
        const stepLabel = lastEvent?.kind
          ? (STEP_LABELS[lastEvent.kind] ?? lastEvent.kind)
          : "starting up";

        const error =
          `Stuck during ${stepLabel} for ${minutesIdle} min and gave up. ` +
          `The original ${job.source_kind} may have been too large for one pass — ` +
          `try a smaller PDF or split it into pages, then re-import.`;

        const { error: updateErr } = await supabase
          .from("ingestion_jobs")
          .update({ status: "failed", error })
          .eq("id", job.id);
        if (updateErr) {
          logger.warn(
            { jobId: job.id, err: updateErr.message },
            "sweep update failed; skipping",
          );
          continue;
        }
        // Drop a 'failed' event so the UI / activity feed shows the timeout
        // in the same stream as other lifecycle events.
        await supabase.from("ingestion_events").insert({
          job_id: job.id,
          kind: "failed",
          payload: {
            reason: "sweep_timeout",
            minutes_idle: minutesIdle,
            last_step: lastEvent?.kind ?? null,
          },
        });
        updated++;
      }
      return updated;
    });

    if (cleared > 0) {
      logger.warn({ cleared }, "swept stuck ingestion jobs");
    }
    return { cleared };
  },
);
