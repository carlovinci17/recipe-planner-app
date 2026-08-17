import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ingestionStorage } from "@/lib/ingestion/storage";
import { extractRecipeFromImages } from "@/lib/ai/recipe-extraction";
import { env } from "@/lib/env";
import type { ExtractedRecipe } from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Internal ingestion step (Module 6): vision-extract ONE chunk of pages. The
 * orchestrator drives the loop (one activity per chunk = per-chunk checkpointing,
 * so a failure never re-burns earlier chunks' tokens). Detected recipes are
 * appended to `raw_extraction` on the job, so only a tiny usage object crosses
 * the orchestration boundary.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId, pages, chunkIndex, totalChunks, bulkMode, useOpus } = (await req.json()) as {
    jobId: string;
    pages: string[];
    chunkIndex: number;
    totalChunks: number;
    bulkMode?: boolean;
    useOpus?: boolean;
  };

  const supabase = createSupabaseAdmin();

  const urls = await ingestionStorage.signedUrls({
    bucket: ingestionStorage.uploadsBucket,
    paths: pages,
    expiresIn: 1800,
  });
  const result = await extractRecipeFromImages({
    imageUrls: urls,
    hint:
      totalChunks > 1
        ? `These are pages ${pages[0]} – ${pages[pages.length - 1]} (chunk ${chunkIndex + 1} of ${totalChunks}) from a multi-page document. Some recipes may span chunk boundaries; extract what's visible here.`
        : undefined,
    model: bulkMode && !useOpus ? env.ANTHROPIC_MODEL_BULK : undefined,
  });
  const recipes = result.data.recipes ?? [];

  // Append this chunk's raw recipes to the job (sequential chunks → no race).
  const { data: job } = await supabase
    .from("ingestion_jobs")
    .select("raw_extraction")
    .eq("id", jobId)
    .single();
  const existing = ((job?.raw_extraction as { recipes?: ExtractedRecipe[] } | null)?.recipes ??
    []) as ExtractedRecipe[];
  await supabase
    .from("ingestion_jobs")
    .update({ raw_extraction: { recipes: [...existing, ...recipes] }, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  await supabase.from("ingestion_events").insert({
    job_id: jobId,
    kind: "ai_processing_started",
    payload: { chunk: chunkIndex + 1, total_chunks: totalChunks, recipes_this_chunk: recipes.length },
  });

  return Response.json({
    usage: {
      model: result.usage.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      costCents: result.usage.costCents ?? 0,
    },
  });
}
