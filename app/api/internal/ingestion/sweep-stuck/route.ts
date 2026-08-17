import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { sweepStuckJobs } from "@/lib/ingestion/sweep-stuck";

export const runtime = "nodejs";

/**
 * Internal ingestion step (Module 6, 6.4): run the stuck-job sweep. Called by the
 * Durable Functions timer trigger (the cron replacement). Idempotent.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;
  const result = await sweepStuckJobs();
  return Response.json(result);
}
