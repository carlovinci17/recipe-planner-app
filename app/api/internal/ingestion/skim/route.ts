import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { ingestionStore } from "@/lib/ingestion/store";
import { ingestionStorage } from "@/lib/ingestion/storage";
import { skimRecipesFromImages } from "@/lib/ai/recipe-extraction";
import { normalizeTitle } from "@/lib/ingestion/pipeline-helpers";

/** Normalised titles of every recipe the household has (owner connection, scoped). */
async function householdTitleKeys(householdId: string): Promise<Set<string>> {
  const { db } = await import("@/lib/db");
  const { recipes } = await import("@/lib/db/schema");
  const { and, eq, ne } = await import("drizzle-orm");
  const rows = await db
    .select({ title: recipes.title })
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), ne(recipes.status, "failed")));
  return new Set(rows.map((r) => normalizeTitle(r.title)));
}

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Internal ingestion step (Module 6, 6.3): fast skim pass — extract just recipe
 * titles/pages so the user can pick which to deep-extract. Saves skim_results to
 * the job; the UI reads them to show the picker while the orchestration is parked
 * on waitForExternalEvent.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId, pages } = (await req.json()) as { jobId: string; pages: string[] };

  const urls = await ingestionStorage.signedUrls({
    bucket: ingestionStorage.uploadsBucket,
    paths: pages,
  });
  const result = await skimRecipesFromImages({ imageUrls: urls });
  const job = await ingestionStore.getJob(jobId);
  const existing = job ? await householdTitleKeys(job.household_id) : new Set<string>();
  // Mark recipes the household already has, so the picker unticks them and an
  // automatic (Drive) import skips them — re-importing a cookbook never duplicates.
  const skim = result.data.recipes.map((r) => ({
    ...r,
    in_library: existing.has(normalizeTitle(r.title)),
  }));
  const newIndices = skim.flatMap((r, i) => (r.in_library ? [] : [i]));

  await ingestionStore.updateJob(jobId, {
    skim_results: { recipes: skim },
    updated_at: new Date().toISOString(),
  });
  await ingestionStore.insertEvent(jobId, "extraction_completed", {
    phase: "skim",
    recipes_found: skim.length,
    already_in_library: skim.length - newIndices.length,
  });

  return Response.json({ count: skim.length, newIndices });
}
