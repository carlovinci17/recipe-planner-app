import "server-only";
import { extractRecipeFromText } from "@/lib/ai/recipe-extraction";
import { normalizeExtractedRecipe } from "@/lib/ingestion/normalize";
import { persistDraftRecipe } from "@/lib/ingestion/persist-recipe";
import { ingestionStore } from "@/lib/ingestion/store";
import { ingestionStorage } from "@/lib/ingestion/storage";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getSourceName } from "@/lib/recipes/source-name";
import { fetchPageData } from "@/lib/inngest/functions/process-url";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Json } from "@/types/database.types";

/**
 * The URL-import flow as a plain, engine-agnostic function (Module 11.1 / Slice 5).
 * A Neon-aware port of the Inngest `processUrl` handler's body — fetch the page,
 * text-extract, persist the recipe(s), finalize the job, and best-effort attach
 * the channel name + hero image. Tagging is NOT done here: the Durable URL
 * orchestrator fans out `tagRecipe` afterwards (mirroring the file pipeline).
 * Returns the persisted recipe ids so the orchestrator can tag them.
 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

async function updateRecipes(
  ids: string[],
  patch: { sourceMetadata?: Json; imagePaths?: string[] },
): Promise<void> {
  if (ids.length === 0) return;
  if (env.DATABASE_URL) {
    const { db } = await import("@/lib/db");
    const { inArray } = await import("drizzle-orm");
    const { recipes } = await import("@/lib/db/schema");
    await db.update(recipes).set(patch).where(inArray(recipes.id, ids));
    return;
  }
  const supabase = createSupabaseAdmin();
  const snake: { source_metadata?: Json; image_paths?: string[] } = {};
  if (patch.sourceMetadata !== undefined) snake.source_metadata = patch.sourceMetadata;
  if (patch.imagePaths !== undefined) snake.image_paths = patch.imagePaths;
  await supabase.from("recipes").update(snake).in("id", ids);
}

/** Best-effort hero-image download → storage (via the seam). Never throws. */
async function attachHeroImage(imageUrl: string, householdId: string, recipeId: string): Promise<void> {
  try {
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      },
      redirect: "follow",
    });
    if (!res.ok) return;
    const contentType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
    if (!contentType.startsWith("image/")) return;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) return;
    const ext = EXT_BY_TYPE[contentType] ?? "jpg";
    const path = `${householdId}/${recipeId}/cover-source.${ext}`;
    await ingestionStorage.uploadTo({ bucket: ingestionStorage.imagesBucket, path, buffer: buf, contentType });
    await updateRecipes([recipeId], { imagePaths: [path] });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "hero image fetch failed (non-fatal)");
  }
}

export async function runUrlIngestion(args: {
  jobId: string;
  householdId: string;
  url: string;
}): Promise<{ recipeIds: string[]; primaryRecipeId: string | null }> {
  const { jobId, householdId, url } = args;

  const job = await ingestionStore.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  await ingestionStore.updateJob(jobId, { status: "processing" });
  await ingestionStore.insertEvent(jobId, "ai_processing_started", {});

  const page = await fetchPageData(url);
  const extraction = await extractRecipeFromText({ text: page.text, url });
  const allDetected = extraction.data.recipes ?? [];
  const kept = allDetected.filter((r) => r.is_recipe && r.confidence >= 0.3);

  if (kept.length === 0) {
    await ingestionStore.updateJob(jobId, {
      status: "failed",
      error:
        allDetected.length === 0
          ? "URL did not appear to contain a recipe"
          : "Detected content didn't reach the confidence threshold",
      raw_extraction: extraction.data as Json,
    });
    return { recipeIds: [], primaryRecipeId: null };
  }

  await ingestionStore.insertEvent(jobId, "extraction_completed", {
    recipes_found: allDetected.length,
    recipes_kept: kept.length,
  });

  const normalizedAll = kept.map((r) => normalizeExtractedRecipe(r));
  const persisted: string[] = [];
  const failures: Array<{ title: string; error: string }> = [];

  for (let idx = 0; idx < normalizedAll.length; idx++) {
    const recipe = normalizedAll[idx]!;
    try {
      const recipeId = await persistDraftRecipe({
        householdId,
        createdBy: job.created_by,
        sourceKind: "url",
        sourceUrl: url,
        aiModel: extraction.usage.model,
        extracted: recipe,
        ingestionJobId: jobId,
        sourceName: page.channelName ?? getSourceName(url),
      });
      await ingestionStore.insertEvent(jobId, "recipe_ready_for_review", {
        recipeId,
        index: idx,
        total: normalizedAll.length,
      });
      persisted.push(recipeId);
    } catch (err) {
      const message = (err as Error).message;
      logger.warn({ jobId, idx, title: recipe.title, err: message }, "recipe persistence failed; continuing");
      await ingestionStore.insertEvent(jobId, "failed", {
        reason: "persist_recipe",
        index: idx,
        total: normalizedAll.length,
        title: recipe.title,
        error: message,
      });
      failures.push({ title: recipe.title, error: message });
    }
  }

  if (persisted.length === 0) {
    const uniqueReasons = Array.from(new Set(failures.map((f) => f.error))).slice(0, 3);
    const errorMsg =
      `All ${failures.length} recipe ${failures.length === 1 ? "insert" : "inserts"} failed. ` +
      uniqueReasons.map((r) => `\n  • ${r}`).join("");
    await ingestionStore.updateJob(jobId, { status: "failed", error: errorMsg });
    await ingestionStore.insertEvent(jobId, "failed", {
      reason: "all_persists_failed",
      failures: failures.map((f) => ({ title: f.title, error: f.error })),
    });
    return { recipeIds: [], primaryRecipeId: null };
  }

  if (failures.length > 0) {
    await ingestionStore.insertEvent(jobId, "validation_completed", {
      partial: true,
      succeeded: persisted.length,
      failed: failures.length,
      failed_titles: failures.map((f) => f.title).slice(0, 20),
      failure_reasons: Array.from(new Set(failures.map((f) => f.error))).slice(0, 5),
    });
  }

  const primaryRecipeId = persisted[0]!;
  await ingestionStore.updateJob(jobId, {
    recipe_id: primaryRecipeId,
    status: "needs_review",
    raw_extraction: extraction.data as Json,
    normalized: normalizedAll as unknown as Json,
    ai_model: extraction.usage.model,
    prompt_tokens: extraction.usage.promptTokens,
    completion_tokens: extraction.usage.completionTokens,
    cost_cents: extraction.usage.costCents ?? null,
  });

  if (page.channelName) {
    await updateRecipes(persisted, { sourceMetadata: { channel_name: page.channelName } });
  }
  if (page.imageUrl) {
    await attachHeroImage(page.imageUrl, householdId, primaryRecipeId);
  }

  return { recipeIds: persisted, primaryRecipeId };
}
