import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { ingestionStore } from "@/lib/ingestion/store";
import { ingestionStorage } from "@/lib/ingestion/storage";
import { skimRecipesFromImages } from "@/lib/ai/recipe-extraction";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Internal ingestion step (Module 6, 6.3): fast skim pass — extract just recipe
 * titles/pages so the user can pick which to deep-extract. Saves skim_results to
 * the job; the UI reads them to show the picker while the orchestration is parked
 * on waitForExternalEvent.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId, pages } = (await req.json()) as { jobId: string; pages: string[] };

  const urls = await ingestionStorage.signedUrls({
    bucket: ingestionStorage.uploadsBucket,
    paths: pages,
    expiresIn: 1800,
  });
  const result = await skimRecipesFromImages({ imageUrls: urls });
  const skim = result.data.recipes;

  await ingestionStore.updateJob(jobId, {
    skim_results: { recipes: skim },
    updated_at: new Date().toISOString(),
  });
  await ingestionStore.insertEvent(jobId, "extraction_completed", {
    phase: "skim",
    recipes_found: skim.length,
  });

  return Response.json({ count: skim.length });
}
