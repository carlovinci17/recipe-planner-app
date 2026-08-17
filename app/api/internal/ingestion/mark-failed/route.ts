import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Internal ingestion step (Module 6): mark a job failed with a reason. Used by
 * the orchestrator's failure branches (no pages, all persists failed).
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId, error, reason } = (await req.json()) as {
    jobId: string;
    error: string;
    reason: string;
  };
  const supabase = createSupabaseAdmin();

  await supabase.from("ingestion_jobs").update({ status: "failed", error }).eq("id", jobId);
  await supabase.from("ingestion_events").insert({ job_id: jobId, kind: "failed", payload: { reason } });
  return Response.json({ ok: true });
}
