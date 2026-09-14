/**
 * Mapping between the pages a vision model *saw* and the pages of the book.
 *
 * When the user narrows a PDF up front ("2, 5-8, 13-15"), `prepare` rasterizes
 * only those pages. Everything downstream then works on a short document — but
 * that creates one trap and one wrinkle:
 *
 *   - The trap: the model's `source_page_index` counts the images it was shown.
 *     Show it pages 13-15 and it calls page 14 "image 2". Anything displaying
 *     that number to a human has to translate it back, or the picker claims a
 *     recipe is on page 2 of a cookbook when it's on page 14.
 *   - The wrinkle: "the page either side" — used to catch a recipe running
 *     across a page turn — is only meaningful when the pages really do adjoin
 *     in the book. With "5-8, 13-15" the image after page 8 is page 13.
 *
 * `ingestion_jobs.page_numbers` records the real page behind each image. It is
 * null for every job that rasterized the whole document, where image i is
 * simply page i + 1 — so every function here treats null as exactly that.
 *
 * Shared by a route handler and a client component, so no `server-only` and no
 * Node built-ins.
 */

/**
 * The real book page behind each rasterized image.
 *
 * Falls back to 1, 2, 3… whenever the stored array is missing or doesn't line
 * up with the images — a mismatch means the two were written at different
 * times, and guessing from a stale array would be worse than not translating.
 */
export function resolveBookPages(
  imageCount: number,
  stored: number[] | null | undefined,
): number[] {
  if (stored && stored.length === imageCount) return stored;
  return Array.from({ length: imageCount }, (_, i) => i + 1);
}

/**
 * Translate a model-reported `source_page_index` (1-based, counting images)
 * into the page number a human would recognise. Null in, null out — the model
 * reports null for single images and other non-paginated sources.
 */
export function bookPageForImage(
  sourcePageIndex: number | null | undefined,
  bookPages: number[] | null | undefined,
): number | null {
  if (!sourcePageIndex || sourcePageIndex < 1) return null;
  return bookPages?.[sourcePageIndex - 1] ?? sourcePageIndex;
}

/**
 * Which images to deep-extract, given the recipes the user ticked.
 *
 * Returns sorted image indices, each recipe's own page plus any page that is
 * genuinely next to it in the book. An empty result means "nothing resolved" —
 * the caller falls back to every page rather than extracting none.
 */
export function selectPagesForExtraction(args: {
  /** Indices into `skim`, as ticked in the picker. */
  selectedIndices: number[];
  skim: Array<{ source_page_index?: number | null }>;
  /** How many images the job rasterized. */
  imageCount: number;
  /** Real book page per image, from `resolveBookPages`. */
  bookPages: number[];
}): number[] {
  const { selectedIndices, skim, imageCount, bookPages } = args;
  const wanted = new Set<number>();

  for (const idx of selectedIndices) {
    const p = skim[idx]?.source_page_index;
    if (!p || p < 1 || p > imageCount) continue;
    const here = p - 1;
    wanted.add(here);

    for (const offset of [-1, 1]) {
      const target = here + offset;
      if (target < 0 || target >= imageCount) continue;
      const a = bookPages[target];
      const b = bookPages[here];
      // Adjacent in the book, not merely adjacent in the array.
      if (a !== undefined && b !== undefined && Math.abs(a - b) === 1) {
        wanted.add(target);
      }
    }
  }

  return Array.from(wanted).sort((a, b) => a - b);
}
