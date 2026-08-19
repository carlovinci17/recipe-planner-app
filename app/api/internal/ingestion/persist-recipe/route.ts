import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { ingestionStore } from "@/lib/ingestion/store";
import { persistDraftRecipe } from "@/lib/ingestion/persist-recipe";
import { logger } from "@/lib/logger";
import type { ExtractedRecipe } from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Internal ingestion step (Module 6): persist ONE normalized recipe (by index
 * into the job's `normalized` array). The orchestrator fans these out. Errors
 * are caught and returned as a tagged result — never thrown — so one bad recipe
 * doesn't fail the whole import (mirrors the Inngest "catch inside step.run").
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId, index } = (await req.json()) as { jobId: string; index: number };

  const job = await ingestionStore.getJob(jobId);
  if (!job) return Response.json({ ok: false, error: `Job ${jobId} not found` });

  const normalized = (job.normalized as ExtractedRecipe[] | null) ?? [];
  const recipe = normalized[index];
  if (!recipe) return Response.json({ ok: false, error: `recipe index ${index} out of range` });

  const pageImagePaths = job.page_image_paths ?? [];
  // Batch source override the user typed in the skim dialog wins over the job's URL.
  const override = (job.skim_results as { source_override?: { name?: string | null; url?: string | null } } | null)
    ?.source_override;
  try {
    const coverImagePath = (() => {
      const pi = recipe.source_page_index;
      if (pi && pi >= 1 && pi <= pageImagePaths.length) return pageImagePaths[pi - 1] ?? null;
      return pageImagePaths[0] ?? null;
    })();

    const id = await persistDraftRecipe({
      householdId: job.household_id,
      createdBy: job.created_by,
      sourceKind: job.source_kind,
      sourceUrl: override?.url ?? job.source_url,
      sourceName: override?.name ?? null,
      coverImagePath,
      imagePaths: [],
      aiModel: job.ai_model ?? "",
      extracted: recipe,
      ingestionJobId: jobId,
      externalSourceId: job.external_file_id,
    });
    await ingestionStore.insertEvent(jobId, "recipe_ready_for_review", {
      recipeId: id,
      index,
      total: normalized.length,
    });
    return Response.json({ ok: true, id, title: recipe.title });
  } catch (err) {
    const message = (err as Error).message;
    logger.warn({ jobId, index, err: message }, "recipe persistence failed; continuing");
    await ingestionStore.insertEvent(jobId, "failed", {
      reason: "persist_recipe",
      index,
      title: recipe.title,
      error: message,
    });
    return Response.json({ ok: false, error: message, title: recipe.title });
  }
}
