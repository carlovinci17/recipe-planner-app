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

/** Dedupe across chunks; when a recipe appears twice, keep the more complete version. */
export function dedupeRecipes(recipes: ExtractedRecipe[]): ExtractedRecipe[] {
  const byTitle = new Map<string, ExtractedRecipe>();
  for (const r of recipes) {
    const key = normalizeTitle(r.title);
    if (!key) continue;
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, r);
      continue;
    }
    const existingScore = existing.ingredients.length + existing.instructions.length;
    const candidateScore = r.ingredients.length + r.instructions.length;
    if (candidateScore > existingScore) byTitle.set(key, r);
  }
  return Array.from(byTitle.values());
}
