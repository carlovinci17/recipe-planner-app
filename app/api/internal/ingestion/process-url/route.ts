import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { runUrlIngestion } from "@/lib/ingestion/process-url-core";
import { ingestionStore } from "@/lib/ingestion/store";

// URL fetch + text extraction + persist. Node runtime; a URL import is a few
// network + AI calls, well under a minute.
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Internal ingestion step (Module 11.1 / Slice 5): run the whole URL-import flow
 * for one job and return the persisted recipe ids. The Durable URL orchestrator
 * calls this, then fans out `tagRecipe` for each returned id.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId, householdId, url } = (await req.json()) as {
    jobId: string;
    householdId: string;
    url: string;
  };
  try {
    const result = await runUrlIngestion({ jobId, householdId, url });
    return Response.json(result);
  } catch (err) {
    // Mirror the Inngest onFailure: a hard error (bad URL, fetch/extract throw)
    // marks the job failed rather than leaving it stuck in 'processing'.
    const message = (err as Error).message;
    await ingestionStore.updateJob(jobId, { status: "failed", error: message });
    await ingestionStore.insertEvent(jobId, "failed", { reason: "url_pipeline", error: message });
    return Response.json({ recipeIds: [], primaryRecipeId: null, error: message });
  }
}
