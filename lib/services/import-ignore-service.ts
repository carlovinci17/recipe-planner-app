import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { driveFiles, importIgnoredRecipes } from "@/lib/db/schema";
import { normalizeTitle } from "@/lib/ingestion/pipeline-helpers";
import { runInUserTx } from "./user-tx";

export type IgnoredRecipe = {
  id: string;
  title: string;
  sourceLabel: string | null;
  createdAt: string;
};

/**
 * "Don't import again" — recipe titles a household has turned down for good.
 * The skim step reads the keys (owner connection, see the skim route) and marks
 * matches `ignored`; everything here runs as the user, under RLS.
 */
export const importIgnoreService = {
  async list(householdId: string): Promise<IgnoredRecipe[]> {
    return runInUserTx((tx) =>
      tx
        .select({
          id: importIgnoredRecipes.id,
          title: importIgnoredRecipes.title,
          sourceLabel: importIgnoredRecipes.sourceLabel,
          createdAt: importIgnoredRecipes.createdAt,
        })
        .from(importIgnoredRecipes)
        .where(eq(importIgnoredRecipes.householdId, householdId))
        .orderBy(desc(importIgnoredRecipes.createdAt)),
    );
  },

  /**
   * Remember `titles` as "Don't import again". A title already on the list is
   * left as it is. `jobId` and `storagePath` only label where they came from.
   */
  async add(args: {
    householdId: string;
    titles: string[];
    jobId: string;
    storagePath: string | null;
  }): Promise<void> {
    const titles = args.titles.filter((t) => normalizeTitle(t).length > 0);
    if (titles.length === 0) return;
    await runInUserTx(async (tx, userId) => {
      const [file] = await tx
        .select({ name: driveFiles.name })
        .from(driveFiles)
        .where(and(eq(driveFiles.jobId, args.jobId), eq(driveFiles.householdId, args.householdId)));
      const sourceLabel = file?.name ?? labelFromStoragePath(args.storagePath);
      await tx
        .insert(importIgnoredRecipes)
        .values(
          titles.map((title) => ({
            householdId: args.householdId,
            createdBy: userId,
            title,
            titleKey: normalizeTitle(title),
            sourceLabel,
          })),
        )
        .onConflictDoNothing({
          target: [importIgnoredRecipes.householdId, importIgnoredRecipes.titleKey],
        });
    });
  },

  /** Undo: the recipe can be offered for import again. */
  async remove(args: { householdId: string; id: string }): Promise<void> {
    await runInUserTx((tx) =>
      tx
        .delete(importIgnoredRecipes)
        .where(
          and(
            eq(importIgnoredRecipes.id, args.id),
            eq(importIgnoredRecipes.householdId, args.householdId),
          ),
        ),
    );
  },
};

/** "<household>/<job>/source-My_Book.pdf" → "My Book.pdf". */
function labelFromStoragePath(path: string | null): string | null {
  const file = path?.split("/").pop();
  if (!file) return null;
  return file.replace(/^source-/, "").replace(/_/g, " ");
}
