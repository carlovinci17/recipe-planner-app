import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Mark an ingestion job as terminally failed and emit a `failed` event row.
 * Called from Inngest function `onFailure` hooks when retries are exhausted —
 * without this, jobs throwing mid-pipeline (e.g. fetch failures, pdfjs errors)
 * stay stuck in `status='processing'` forever.
 *
 * Idempotent: safe to call multiple times. No-ops if jobId is empty.
 */
export async function markIngestionJobFailed(
  jobId: string | undefined,
  errorMessage: string,
): Promise<void> {
  if (!jobId) return;
  const supabase = createSupabaseAdmin();
  const trimmed = errorMessage.length > 1000 ? `${errorMessage.slice(0, 1000)}…` : errorMessage;

  try {
    await supabase
      .from("ingestion_jobs")
      .update({ status: "failed", error: trimmed })
      .eq("id", jobId)
      .neq("status", "needs_review")
      .neq("status", "published");

    await supabase.from("ingestion_events").insert({
      job_id: jobId,
      kind: "failed",
      payload: { error: trimmed, source: "onFailure" },
    });

    logger.warn({ jobId, error: trimmed }, "ingestion job marked failed via onFailure");
  } catch (err) {
    logger.error({ err, jobId }, "failed to mark ingestion job as failed");
  }
}

/**
 * Inngest's `onFailure` event wraps the original event under `event.data.event`
 * and the error under `event.data.error`. We only need the original event's
 * data.jobId — pull it out defensively in case the event lacks one.
 */
export function extractJobIdFromFailureEvent(failureEvent: unknown): string | undefined {
  const e = failureEvent as
    | {
        data?: {
          event?: { data?: { jobId?: string } };
        };
      }
    | undefined;
  return e?.data?.event?.data?.jobId;
}
