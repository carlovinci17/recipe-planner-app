import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { ingestionStore } from "@/lib/ingestion/store";

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

  const { jobId, selectedIndices, sourceName, sourceUrl } = (await req.json()) as {
    jobId: string;
    selectedIndices: number[];
    sourceName?: string | null;
    sourceUrl?: string | null;
  };
  const job = await ingestionStore.getJob(jobId);
  const skim = ((job?.skim_results as { recipes?: SkimRecipe[] } | null)?.recipes ?? []) as SkimRecipe[];
  const pageImagePaths = job?.page_image_paths ?? [];
  // Real book page behind each image, when the user narrowed the PDF up front.
  // Null/mismatched means no selection: image i is simply page i + 1.
  const stored = job?.page_numbers ?? null;
  const bookPages =
    stored && stored.length === pageImagePaths.length
      ? stored
      : pageImagePaths.map((_, i) => i + 1);

  const selected = selectedIndices ?? [];
  if (selected.length === 0) {
    await ingestionStore.updateJob(jobId, {
      status: "failed",
      error: "Cancelled at the recipe selection step.",
    });
    return Response.json({ cancelled: true });
  }

  // Narrow to pages containing the selected recipes (± 1 page), to catch a
  // recipe that runs across a page turn. Fall back to all.
  //
  // `source_page_index` counts the images the skim model was shown, so it is
  // already an index into pageImagePaths. The ± 1 neighbour, though, is only
  // meaningful when the pages really do adjoin in the book: with a selection
  // like "5-8, 13-15", the image after page 8 is page 13, and pulling that in
  // would burn tokens on a page the user never asked about.
  const wantedPageIdxSet = new Set<number>();
  for (const idx of selected) {
    const p = skim[idx]?.source_page_index;
    if (!p || p < 1 || p > pageImagePaths.length) continue;
    const here = p - 1;
    wantedPageIdxSet.add(here);
    for (const offset of [-1, 1]) {
      const target = here + offset;
      if (target < 0 || target >= pageImagePaths.length) continue;
      // Adjacent in the book, not merely adjacent in the array.
      if (Math.abs(bookPages[target]! - bookPages[here]!) === 1) {
        wantedPageIdxSet.add(target);
      }
    }
  }
  const wantedPageIdx = Array.from(wantedPageIdxSet).sort((a, b) => a - b);
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
