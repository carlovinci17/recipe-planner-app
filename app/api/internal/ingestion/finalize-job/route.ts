import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Internal ingestion step (Module 6): mark the job needs_review, point it at the
 * primary recipe, and (if some recipes failed) emit a partial-summary event.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId, primaryRecipeId, succeeded, failed } = (await req.json()) as {
    jobId: string;
    primaryRecipeId: string;
    succeeded: number;
    failed: number;
  };
  const supabase = createSupabaseAdmin();

  await supabase
    .from("ingestion_jobs")
    .update({ recipe_id: primaryRecipeId, status: "needs_review" })
    .eq("id", jobId);

  if (failed > 0) {
    await supabase.from("ingestion_events").insert({
      job_id: jobId,
      kind: "validation_completed",
      payload: { partial: true, succeeded, failed },
    });
  }
  return Response.json({ ok: true });
}
