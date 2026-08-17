import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ingestionStorage } from "@/lib/ingestion/storage";
import { logger } from "@/lib/logger";
import type { ExtractedRecipe } from "@/lib/ai/schemas";

export const runtime = "nodejs";

/**
 * Internal ingestion step (Module 6): the recipe data is now in Postgres, so
 * delete the original source file and any page renders NOT used as a cover.
 * Best-effort — a failure here never fails the job.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId } = (await req.json()) as { jobId: string };
  const supabase = createSupabaseAdmin();

  const { data: job } = await supabase
    .from("ingestion_jobs")
    .select("storage_path, page_image_paths, normalized")
    .eq("id", jobId)
    .single();
  if (!job) return Response.json({ ok: true, deleted: 0 });

  const pageImagePaths = job.page_image_paths ?? [];
  const normalized = (job.normalized as ExtractedRecipe[] | null) ?? [];

  const toDelete: string[] = [];
  if (job.storage_path) toDelete.push(job.storage_path);

  const usedAsCovers = new Set(
    normalized.map((r) => {
      const pi = r.source_page_index;
      if (pi && pi >= 1 && pi <= pageImagePaths.length) return pageImagePaths[pi - 1]!;
      return pageImagePaths[0]!;
    }),
  );
  for (const p of pageImagePaths) if (!usedAsCovers.has(p)) toDelete.push(p);

  if (toDelete.length === 0) return Response.json({ ok: true, deleted: 0 });

  try {
    await ingestionStorage.remove({ bucket: ingestionStorage.uploadsBucket, paths: toDelete });
    return Response.json({ ok: true, deleted: toDelete.length });
  } catch (err) {
    logger.warn({ jobId, err: (err as Error).message }, "source file cleanup failed (non-fatal)");
    return Response.json({ ok: true, deleted: 0, warning: (err as Error).message });
  }
}
