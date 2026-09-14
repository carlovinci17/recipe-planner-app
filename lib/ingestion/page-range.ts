/**
 * Page-range expressions for PDF import — "2, 5-8, 13-15, 50-55".
 *
 * The user types the same thing they'd type in a print dialog; we turn it into
 * a sorted, de-duplicated list of 1-based page numbers. `prepare` then
 * rasterizes exactly those pages, so the rest of the pipeline sees a short
 * document rather than a 300-page cookbook it has to throw away.
 *
 * Shared by the browser (live feedback as you type) and the server (the real
 * gate), so it must stay free of both React and Node built-ins.
 */

/** Hard ceiling on how many pages one interactive import may rasterize. */
export const MAX_SELECTED_PAGES = 100;

export type PageRangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

/**
 * Parse a page-range expression into sorted, unique, 1-based page numbers.
 *
 * Accepts comma- or space-separated singles and ranges, with en/em dashes
 * tolerated because that's what a paste from a book's index tends to contain.
 * A descending range ("8-5") is read as the range the user meant rather than
 * rejected — the alternative is an error message for an unambiguous typo.
 *
 * An empty or whitespace-only input is NOT an error: it means "the whole
 * document", and the caller decides what that implies.
 */
export function parsePageRange(input: string): PageRangeResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: true, pages: [] };

  const pages = new Set<number>();
  // Split on commas and/or whitespace so "2,5-8" and "2 5-8" both work.
  const parts = trimmed.split(/[\s,]+/).filter((p) => p.length > 0);

  for (const part of parts) {
    // Normalise en dash / em dash / minus to a plain hyphen before matching.
    const normalised = part.replace(/[‒–—−]/g, "-");

    const single = /^(\d+)$/.exec(normalised);
    if (single) {
      const n = Number(single[1]);
      if (n < 1) return { ok: false, error: `Page numbers start at 1 — "${part}" isn't valid.` };
      pages.add(n);
      continue;
    }

    const range = /^(\d+)-(\d+)$/.exec(normalised);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a < 1 || b < 1) {
        return { ok: false, error: `Page numbers start at 1 — "${part}" isn't valid.` };
      }
      const from = Math.min(a, b);
      const to = Math.max(a, b);
      // Guard before the loop: "1-999999" should be a message, not a hang.
      if (to - from + 1 > MAX_SELECTED_PAGES) {
        return {
          ok: false,
          error: `"${part}" covers ${to - from + 1} pages — the limit is ${MAX_SELECTED_PAGES} per import.`,
        };
      }
      for (let n = from; n <= to; n++) pages.add(n);
      continue;
    }

    return { ok: false, error: `Couldn't read "${part}". Use a page like 7, or a range like 5-8.` };
  }

  if (pages.size > MAX_SELECTED_PAGES) {
    return {
      ok: false,
      error: `That's ${pages.size} pages — the limit is ${MAX_SELECTED_PAGES} per import. Split it into a few smaller imports.`,
    };
  }

  return { ok: true, pages: Array.from(pages).sort((a, b) => a - b) };
}

/**
 * Render a page list back as a compact expression — [2,5,6,7,8] → "2, 5-8".
 * Used to echo the parsed selection back to the user, which is how they catch
 * a typo like "5-88" before spending tokens on it.
 */
export function formatPageRange(pages: number[]): string {
  if (pages.length === 0) return "";
  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b);
  const out: string[] = [];
  let runStart = sorted[0]!;
  let prev = runStart;

  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur !== undefined && cur === prev + 1) {
      prev = cur;
      continue;
    }
    out.push(runStart === prev ? String(runStart) : `${runStart}-${prev}`);
    if (cur === undefined) break;
    runStart = cur;
    prev = cur;
  }
  return out.join(", ");
}
