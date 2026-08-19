import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { ingestionStore } from "@/lib/ingestion/store";

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
  await ingestionStore.updateJob(jobId, { status: "failed", error });
  await ingestionStore.insertEvent(jobId, "failed", { reason });
  return Response.json({ ok: true });
}
