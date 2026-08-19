import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ingestionStore } from "@/lib/ingestion/store";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Safety-net sweep: mark ingestion_jobs stuck in `processing` for > NO_PROGRESS_MIN
 * as failed, with a contextual reason. Idempotent, so it's safe to run from BOTH
 * the Inngest cron and the Durable Functions timer during coexistence.
 * (Shared by lib/inngest/functions/sweep-stuck-jobs.ts and the internal endpoint.)
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

export async function sweepStuckJobs(): Promise<{ cleared: number }> {
  const cutoff = new Date(Date.now() - NO_PROGRESS_MIN * 60 * 1000).toISOString();

  if (env.DATABASE_URL) {
    const { db } = await import("@/lib/db");
    const { and, desc, eq, lt } = await import("drizzle-orm");
    const { ingestionEvents, ingestionJobs } = await import("@/lib/db/schema");
    const stuck = await db
      .select({
        id: ingestionJobs.id,
        updatedAt: ingestionJobs.updatedAt,
        sourceKind: ingestionJobs.sourceKind,
      })
      .from(ingestionJobs)
      .where(and(eq(ingestionJobs.status, "processing"), lt(ingestionJobs.updatedAt, cutoff)));
    if (stuck.length === 0) return { cleared: 0 };

    let updated = 0;
    for (const job of stuck) {
      const [lastEvent] = await db
        .select({ kind: ingestionEvents.kind })
        .from(ingestionEvents)
        .where(eq(ingestionEvents.jobId, job.id))
        .orderBy(desc(ingestionEvents.createdAt))
        .limit(1);
      const minutesIdle = Math.max(1, Math.round((Date.now() - new Date(job.updatedAt).getTime()) / 60000));
      const stepLabel = lastEvent?.kind ? (STEP_LABELS[lastEvent.kind] ?? lastEvent.kind) : "starting up";
      const error =
        `Stuck during ${stepLabel} for ${minutesIdle} min and gave up. ` +
        `The original ${job.sourceKind} may have been too large for one pass — ` +
        `try a smaller PDF or split it into pages, then re-import.`;
      await ingestionStore.updateJob(job.id, { status: "failed", error });
      await ingestionStore.insertEvent(job.id, "failed", {
        reason: "sweep_timeout",
        minutes_idle: minutesIdle,
        last_step: lastEvent?.kind ?? null,
      });
      updated++;
    }
    return { cleared: updated };
  }

  const supabase = createSupabaseAdmin();

  const { data: stuck, error: stuckErr } = await supabase
    .from("ingestion_jobs")
    .select("id, updated_at, source_kind")
    .eq("status", "processing")
    .lt("updated_at", cutoff);
  if (stuckErr) throw stuckErr;
  if (!stuck || stuck.length === 0) return { cleared: 0 };

  let updated = 0;
  for (const job of stuck) {
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
    const stepLabel = lastEvent?.kind ? (STEP_LABELS[lastEvent.kind] ?? lastEvent.kind) : "starting up";
    const error =
      `Stuck during ${stepLabel} for ${minutesIdle} min and gave up. ` +
      `The original ${job.source_kind} may have been too large for one pass — ` +
      `try a smaller PDF or split it into pages, then re-import.`;

    const { error: updateErr } = await supabase
      .from("ingestion_jobs")
      .update({ status: "failed", error })
      .eq("id", job.id);
    if (updateErr) {
      logger.warn({ jobId: job.id, err: updateErr.message }, "sweep update failed; skipping");
      continue;
    }
    await supabase.from("ingestion_events").insert({
      job_id: job.id,
      kind: "failed",
      payload: { reason: "sweep_timeout", minutes_idle: minutesIdle, last_step: lastEvent?.kind ?? null },
    });
    updated++;
  }
  return { cleared: updated };
}
