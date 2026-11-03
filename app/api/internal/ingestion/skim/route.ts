import { after, type NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { startNextDriveFiles } from "@/lib/ingestion/drive-sync";
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

/** Titles the household chose "Don't import again" for (owner connection, scoped). */
async function ignoredTitleKeys(householdId: string): Promise<Set<string>> {
  const { db } = await import("@/lib/db");
  const { importIgnoredRecipes } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({ key: importIgnoredRecipes.titleKey })
    .from(importIgnoredRecipes)
    .where(eq(importIgnoredRecipes.householdId, householdId));
  return new Set(rows.map((r) => r.key));
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
  const [existing, ignored] = job
    ? await Promise.all([householdTitleKeys(job.household_id), ignoredTitleKeys(job.household_id)])
    : [new Set<string>(), new Set<string>()];
  // Mark recipes the household already has (the picker defaults them to Skip, so
  // re-importing a cookbook never duplicates) and ones it said "Don't import
  // again" to (the picker hides them). A Drive file with nothing else is skipped.
  const skim = result.data.recipes.map((r) => {
    const key = normalizeTitle(r.title);
    return { ...r, in_library: existing.has(key), ignored: ignored.has(key) };
  });
  const newIndices = skim.flatMap((r, i) => (r.in_library || r.ignored ? [] : [i]));

  await ingestionStore.updateJob(jobId, {
    skim_results: { recipes: skim },
    updated_at: new Date().toISOString(),
  });
  await ingestionStore.insertEvent(jobId, "extraction_completed", {
    phase: "skim",
    recipes_found: skim.length,
    already_in_library: skim.filter((r) => r.in_library).length,
    not_imported_again: skim.filter((r) => r.ignored).length,
  });

  // A job waiting on the recipe picker doesn't hold a Drive slot (see inFlightCount).
  after(startNextDriveFiles); // this job's Drive slot is free — start the next file
  return Response.json({ count: skim.length, newIndices });
}
