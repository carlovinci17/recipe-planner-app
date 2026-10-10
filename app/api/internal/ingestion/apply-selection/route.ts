import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { ingestionStore } from "@/lib/ingestion/store";
import { resolveBookPages, selectPagesForExtraction } from "@/lib/ingestion/page-mapping";

export const runtime = "nodejs";

type SkimRecipe = { title?: string; source_page_index?: number | null };

/**
 * Internal ingestion step (Module 6, 6.3): apply the user's skim selection. Given
 * the picked indices, narrow the pages we'll deep-extract (± 1 page each side for
 * cross-boundary recipes), and stash the selected titles + batch source override
 * on the job so finalize/persist can use them. Empty selection = cancelled.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId, selectedIndices, sourceName, sourceUrl, emptyReason } = (await req.json()) as {
    jobId: string;
    selectedIndices: number[];
    sourceName?: string | null;
    sourceUrl?: string | null;
    /** Automatic (Drive) imports: why nothing was selected. */
    emptyReason?: "all_in_library" | "no_recipes";
  };
  const job = await ingestionStore.getJob(jobId);
  const skim = ((job?.skim_results as { recipes?: SkimRecipe[] } | null)?.recipes ?? []) as SkimRecipe[];
  const pageImagePaths = job?.page_image_paths ?? [];
  // Real book page behind each image, when the user narrowed the PDF up front.
  const bookPages = resolveBookPages(pageImagePaths.length, job?.page_numbers);

  const selected = selectedIndices ?? [];
  if (selected.length === 0) {
    await ingestionStore.updateJob(jobId, {
      status: "failed",
      error:
        emptyReason === "all_in_library"
          ? "Skipped — every recipe in this file is already in your library."
          : emptyReason === "no_recipes"
            ? "Skipped — no recipes found in this file."
            : "Cancelled at the recipe selection step.",
    });
    return Response.json({ cancelled: true });
  }

  // Narrow to pages containing the selected recipes, plus any page genuinely
  // next to one in the book, to catch a recipe that runs across a page turn.
  // Falls back to every page when nothing resolved. See lib/ingestion/page-mapping.
  const wantedPageIdx = selectPagesForExtraction({
    selectedIndices: selected,
    skim,
    imageCount: pageImagePaths.length,
    bookPages,
  });
  const pagesToExtract =
    wantedPageIdx.length > 0 ? wantedPageIdx.map((i) => pageImagePaths[i]!) : pageImagePaths;

  const selectedTitles = selected
    .map((i) => skim[i]?.title)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  const name = sourceName && sourceName.trim().length > 0 ? sourceName.trim() : null;
  const url = sourceUrl && sourceUrl.trim().length > 0 ? sourceUrl.trim() : null;

  await ingestionStore.updateJob(jobId, {
    skim_results: { recipes: skim, selected_titles: selectedTitles, source_override: { name, url } },
    updated_at: new Date().toISOString(),
  });

  return Response.json({ cancelled: false, pagesToExtract });
}
