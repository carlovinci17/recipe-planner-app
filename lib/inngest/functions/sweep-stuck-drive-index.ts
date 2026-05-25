import "server-only";
import { inngest } from "@/lib/inngest/client";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Safety net for drive_file_index rows stuck in 'indexing'.
 *
 * The index-drive-file Inngest function has a 10 min timeout, but if the
 * function is abandoned by the Inngest runtime before onFailure fires, the
 * row stays 'indexing' forever and blocks the UI. This sweep catches those.
 *
 * Runs every 15 min; marks rows idle for > 20 min as failed so Rebuild can
 * re-queue them.
 */
const STUCK_AFTER_MIN = 20;

export const sweepStuckDriveIndex = inngest.createFunction(
  {
    id: "drive-sweep-stuck-index",
    name: "Mark stuck Drive index rows as failed",
  },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const cleared = await step.run("sweep", async () => {
      const supabase = createSupabaseAdmin();
      const cutoff = new Date(Date.now() - STUCK_AFTER_MIN * 60 * 1000).toISOString();

      const { data: stuck, error } = await supabase
        .from("drive_file_index")
        .select("drive_file_id, file_name")
        .eq("index_status", "indexing")
        .lt("updated_at", cutoff);

      if (error) throw error;
      if (!stuck || stuck.length === 0) return 0;

      const ids = stuck.map((r) => r.drive_file_id);

      const { error: updateErr } = await supabase
        .from("drive_file_index")
        .update({
          index_status: "failed",
          error: `Indexing timed out after ${STUCK_AFTER_MIN} min — use Rebuild to retry`,
          updated_at: new Date().toISOString(),
        })
        .in("drive_file_id", ids);

      if (updateErr) throw updateErr;

      logger.warn(
        { cleared: stuck.length, files: stuck.map((r) => r.file_name) },
        "swept stuck drive index rows",
      );
      return stuck.length;
    });

    return { cleared };
  },
);
