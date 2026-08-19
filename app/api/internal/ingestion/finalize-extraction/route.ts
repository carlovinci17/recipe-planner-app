import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { ingestionStore } from "@/lib/ingestion/store";
import { dedupeRecipes, normalizeTitle } from "@/lib/ingestion/pipeline-helpers";
import { normalizeExtractedRecipe } from "@/lib/ingestion/normalize";
import type { ExtractedRecipe } from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Internal ingestion step (Module 6): after all chunks are extracted, dedupe
 * across chunk overlaps, drop low-confidence / non-recipe results, normalize the
 * survivors, and save them to the job as `normalized`. Returns just the count so
 * the orchestrator can fan out `persistRecipe` calls by index.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId, bulkMode, usage } = (await req.json()) as {
    jobId: string;
    bulkMode?: boolean;
    usage?: { model: string; promptTokens: number; completionTokens: number; costCents: number };
  };

  const job = await ingestionStore.getJob(jobId);
  const rawRecipes = ((job?.raw_extraction as { recipes?: ExtractedRecipe[] } | null)?.recipes ??
    []) as ExtractedRecipe[];

  const deduped = dedupeRecipes(rawRecipes);
  const confidenceThreshold = bulkMode ? 0.1 : 0.3;
  let kept = deduped.filter((r) => r.is_recipe && r.confidence >= confidenceThreshold);

  // If the user went through the skim picker, drop recipes whose titles they
  // didn't select (the deep extract can surface neighbours from a buffered page range).
  const selectedTitles = (job?.skim_results as { selected_titles?: string[] } | null)?.selected_titles;
  if (selectedTitles && selectedTitles.length > 0) {
    const wanted = new Set(selectedTitles.map(normalizeTitle));
    kept = kept.filter((r) => wanted.has(normalizeTitle(r.title)));
  }

  const usagePatch = {
    ai_model: usage?.model ?? null,
    prompt_tokens: usage?.promptTokens ?? null,
    completion_tokens: usage?.completionTokens ?? null,
    cost_cents: usage?.costCents || null,
  };

  if (kept.length === 0) {
    const reason = deduped.length === 0 ? "no_recipes" : "below_threshold";
    // Bulk mode completes gracefully; interactive fails.
    await ingestionStore.updateJob(jobId, {
      status: bulkMode ? "needs_review" : "failed",
      error:
        reason === "no_recipes"
          ? "Source did not appear to contain any recipes"
          : "Detected content didn't reach the confidence threshold",
      raw_extraction: { recipes: deduped },
      ...usagePatch,
    });
    await ingestionStore.insertEvent(jobId, "failed", { reason });
    return Response.json({ count: 0, reason });
  }

  const normalized = kept.map((r) => normalizeExtractedRecipe(r));
  await ingestionStore.updateJob(jobId, { raw_extraction: { recipes: deduped }, normalized, ...usagePatch });
  await ingestionStore.insertEvent(jobId, "extraction_completed", {
    recipes_found: deduped.length,
    recipes_kept: kept.length,
  });

  return Response.json({ count: normalized.length });
}
