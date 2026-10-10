import "server-only";
import type { ExtractedRecipe } from "@/lib/ai/schemas";

/**
 * Pure, deterministic ingestion helpers shared by the Inngest pipeline
 * (`process-upload.ts`) and the Durable Functions internal endpoints (Module 6).
 */

// Vision-call sizing: split long docs into 5-page chunks (1-page overlap so
// cross-boundary recipes survive) to keep each call bounded ~1–5 min.
export const VISION_CHUNK_PAGES = 5;
export const VISION_CHUNK_OVERLAP = 1;

export function chunkPages(pages: string[]): string[][] {
  if (pages.length <= VISION_CHUNK_PAGES) return [pages];
  const stride = VISION_CHUNK_PAGES - VISION_CHUNK_OVERLAP;
  const chunks: string[][] = [];
  for (let i = 0; i < pages.length; i += stride) {
    chunks.push(pages.slice(i, Math.min(i + VISION_CHUNK_PAGES, pages.length)));
    if (i + VISION_CHUNK_PAGES >= pages.length) break;
  }
  return chunks;
}

/** Normalize a recipe title for dedupe (overlapping chunks surface the same recipe twice). */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const lineKey = (s: string) => normalizeTitle(s);

/** Union two ordered lists, keeping `a`'s order and appending what only `b` has. */
function unionBy<T>(a: T[], b: T[], key: (x: T) => string): T[] {
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((x) => !seen.has(key(x)))];
}

/**
 * Dedupe across chunks. Overlapping chunks surface the same recipe twice, and a
 * recipe that crosses a chunk edge arrives as two HALVES — the meat on one page,
 * the sauce on the next. Keeping only the "more complete" copy dropped the other
 * half's ingredients, so the copies are MERGED instead: ingredients and steps
 * are unioned in document order (earlier chunk first, as the recipes array is in
 * chunk order), and scalar fields come from the fuller copy, falling back to the
 * other where it is empty.
 */
export function dedupeRecipes(recipes: ExtractedRecipe[]): ExtractedRecipe[] {
  const byTitle = new Map<string, ExtractedRecipe>();
  for (const r of recipes) {
    const key = normalizeTitle(r.title);
    if (!key) continue;
    const existing = byTitle.get(key);
    byTitle.set(key, existing ? mergeRecipeCopies(existing, r) : r);
  }
  return Array.from(byTitle.values());
}

function mergeRecipeCopies(first: ExtractedRecipe, second: ExtractedRecipe): ExtractedRecipe {
  const score = (r: ExtractedRecipe) => r.ingredients.length + r.instructions.length;
  const [base, other] = score(second) > score(first) ? [second, first] : [first, second];
  const notes = [first.source_notes, second.source_notes].filter(
    (n, i, all): n is string => !!n && all.indexOf(n) === i,
  );
  return {
    ...base,
    description: base.description ?? other.description,
    servings: base.servings ?? other.servings,
    prep_time_min: base.prep_time_min ?? other.prep_time_min,
    cook_time_min: base.cook_time_min ?? other.cook_time_min,
    nutrition: Object.values(base.nutrition).some((v) => v !== null && v !== undefined)
      ? base.nutrition
      : other.nutrition,
    source_notes: notes.length ? notes.join("\n\n") : null,
    source_page_index: first.source_page_index ?? second.source_page_index,
    ingredients: unionBy(first.ingredients, second.ingredients, (i) => lineKey(i.raw_text)),
    instructions: unionBy(first.instructions, second.instructions, (i) => lineKey(i.text)),
  };
}
