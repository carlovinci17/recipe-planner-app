import "server-only";
import { and, arrayContains, asc, desc, eq, gte, inArray, isNull, sql as dsql } from "drizzle-orm";
import { recipeIngredients, recipeInstructions, recipes } from "@/lib/db/schema";
import type { Tx } from "@/lib/db";
import { ingestionStorage } from "@/lib/ingestion/storage";
import { runInUserTx } from "./user-tx";
import type { Tables, UpdateTables } from "@/types/database.types";

/** Read a recipe's `image_paths` inside an RLS-scoped tx (Neon path). */
async function readImagePaths(tx: Tx, recipeId: string): Promise<string[]> {
  const rows = (await tx.execute(
    dsql`select image_paths from public.recipes where id = ${recipeId}`,
  )) as unknown as Array<{ image_paths: string[] | null }>;
  if (rows.length === 0) throw new Error("Recipe not found");
  return rows[0]?.image_paths ?? [];
}

export type RecipeListItem = Pick<
  Tables<"recipes">,
  | "id"
  | "title"
  | "description"
  | "cover_image_path"
  | "image_paths"
  | "created_by"
  | "prep_time_min"
  | "cook_time_min"
  | "servings"
  | "rating"
  | "is_favorite"
  | "tags"
  | "meal_types"
  | "diet_types"
  | "cuisines"
  | "source_url"
  | "status"
  | "created_at"
  | "household_id"
  | "nutrition"
  | "cover_focal_x"
  | "cover_focal_y"
  | "source_name"
  | "source_metadata"
>;

export type RecipeFilters = {
  query?: string;
  mealTypes?: string[];
  dietTypes?: string[];
  cuisines?: string[];
  favoriteOnly?: boolean;
  minRating?: number;
  status?: Tables<"recipes">["status"];
};

export type RecipeDetail = {
  recipe: Tables<"recipes">;
  ingredients: Tables<"recipe_ingredients">[];
  instructions: Tables<"recipe_instructions">[];
};

export const recipeService = {
  /**
   * Create an empty draft recipe (the manual "New recipe" flow) and return its id.
   * Inserts `status='needs_review'` so it lands in the review editor.
   */
  async createDraft(args: { householdId: string }): Promise<string> {
    return runInUserTx(async (tx, userId) => {
      const inserted = await tx
        .insert(recipes)
        .values({
          householdId: args.householdId,
          createdBy: userId,
          title: "Untitled recipe",
          sourceKind: "manual",
          status: "needs_review",
        })
        .returning({ id: recipes.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("Failed to create recipe");
      return id;
    });
  },

  /**
   * List recipes for a household. Behind a stable signature this dispatches to
   * Drizzle when DATABASE_URL is configured (local/test — ADR-002) or the
   * Supabase client otherwise (prod, until Module 9). Both satisfy the same
   * characterization tests.
   */
  async list(args: {
    householdId: string;
    filters?: RecipeFilters;
    limit?: number;
  }): Promise<RecipeListItem[]> {
    return listRecipes(args);
  },

  async getById(recipeId: string): Promise<RecipeDetail> {
    return getRecipeById(recipeId);
  },

  async setFavorite(recipeId: string, isFavorite: boolean) {
    await runInUserTx((tx) =>
      tx.update(recipes).set({ isFavorite }).where(eq(recipes.id, recipeId)),
    );
  },

  async setRating(recipeId: string, rating: number | null) {
    await runInUserTx((tx) => tx.update(recipes).set({ rating }).where(eq(recipes.id, recipeId)));
  },

  async publish(recipeId: string) {
    await runInUserTx((tx) =>
      tx.update(recipes).set({ status: "published" }).where(eq(recipes.id, recipeId)),
    );
  },

  async archive(recipeId: string) {
    await runInUserTx((tx) =>
      tx
        .update(recipes)
        .set({ archivedAt: new Date().toISOString() })
        .where(eq(recipes.id, recipeId)),
    );
  },

  /**
   * Hard delete. RLS enforces creator/owner gating. The FK on
   * `planner_entries.recipe_id` is `on delete cascade`, so any planner
   * entries referencing this recipe are also removed. The UI prompts the
   * user to confirm this before calling — see `countPlannerEntries`.
   */
  async delete(recipeId: string) {
    await runInUserTx((tx) => tx.delete(recipes).where(eq(recipes.id, recipeId)));
  },

  /**
   * Hard-delete many recipes in one round-trip. Scoped to a household so an
   * accidental empty filter can't escape into another household's data.
   * RLS still enforces creator/owner gating per row, plus the calling action
   * adds an explicit owner-only check above this. Cascades remove planner
   * entries and recipe_ratings.
   */
  async bulkDelete(args: { householdId: string; recipeIds: string[] }): Promise<number> {
    if (args.recipeIds.length === 0) return 0;
    return runInUserTx(async (tx) => {
      const deleted = await tx
        .delete(recipes)
        .where(and(eq(recipes.householdId, args.householdId), inArray(recipes.id, args.recipeIds)))
        .returning({ id: recipes.id });
      return deleted.length;
    });
  },

  /**
   * Bulk-publish recipes currently in `needs_review` → `published`. Scoped by
   * the `status = 'needs_review'` guard so already-published/failed rows are
   * never reverted. Returns the ids actually flipped (RLS + the status guard
   * can make this shorter than `recipeIds`). Dual-dispatch: Neon vs Supabase.
   */
  async bulkPublish(args: { recipeIds: string[] }): Promise<string[]> {
    if (args.recipeIds.length === 0) return [];
    return runInUserTx(async (tx) => {
      const rows = await tx
        .update(recipes)
        .set({ status: "published" })
        .where(and(inArray(recipes.id, args.recipeIds), eq(recipes.status, "needs_review")))
        .returning({ id: recipes.id });
      return rows.map((r) => r.id);
    });
  },

  /** How many planner entries reference this recipe? Used to gate the delete UI. */
  async countPlannerEntries(recipeId: string): Promise<number> {
    return runInUserTx(async (tx) => {
      const rows = (await tx.execute(
        dsql`select count(*)::int as n from public.planner_entries where recipe_id = ${recipeId}`,
      )) as unknown as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    });
  },

  /**
   * Published recipes in the same household sharing this title (case-insensitive
   * exact match) — the duplicate warning on the review screen. Excludes the
   * recipe being reviewed.
   */
  async findPublishedDuplicates(args: {
    householdId: string;
    title: string;
    excludeRecipeId: string;
    limit?: number;
  }): Promise<Array<{ id: string; title: string }>> {
    const limit = args.limit ?? 3;
    return runInUserTx(async (tx) => {
      const rows = (await tx.execute(
        dsql`select id, title from public.recipes
             where household_id = ${args.householdId}
               and status = 'published'
               and id <> ${args.excludeRecipeId}
               and lower(title) = lower(${args.title})
             limit ${limit}`,
      )) as unknown as Array<{ id: string; title: string }>;
      return rows;
    });
  },

  async update(recipeId: string, patch: UpdateTables<"recipes">) {
    // patch keys are snake_case (DB columns); Drizzle `set` wants the schema's
    // camelCase props. Map keys, then cast (postgres coerces number↔numeric).
    const set = Object.fromEntries(
      Object.entries(patch).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase()),
        v,
      ]),
    ) as Partial<typeof recipes.$inferInsert>;
    await runInUserTx((tx) => tx.update(recipes).set(set).where(eq(recipes.id, recipeId)));
  },

  /**
   * Generate a signed upload URL for a new recipe image. The browser PUTs the
   * file directly to Supabase Storage, then calls `attachImage` with the path.
   * Path layout: <household_id>/<recipe_id>/cover-<ts>.<ext>
   */
  async createImageUploadUrl(args: {
    recipeId: string;
    householdId: string;
    fileName: string;
    contentType: string;
  }) {
    const safeName = args.fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const ts = Date.now();
    const path = `${args.householdId}/${args.recipeId}/cover-${ts}-${safeName}`;
    // Azure Blob is keyless, so there is no browser-signed upload URL: the
    // browser POSTs the file to /api/storage/upload and we only hand back the
    // target path. `uploadUrl`/`token` stay in the shape for the callers that
    // still destructure them.
    return { uploadUrl: "", token: "", path, bucket: "recipe-images" as const };
  },

  /**
   * Append a newly-uploaded image (in `recipe-images` bucket) to the recipe.
   * `image_paths[0]` is treated as the active user cover; reorder via
   * `setCoverImage` to promote a different image.
   */
  async attachImage(args: { recipeId: string; path: string }) {
    await runInUserTx(async (tx) => {
      const existing = await readImagePaths(tx, args.recipeId);
      const next = Array.from(new Set([...existing, args.path]));
      await tx.update(recipes).set({ imagePaths: next }).where(eq(recipes.id, args.recipeId));
    });
  },

  /** Promote an existing image to position 0 (the visible cover). */
  async setCoverImage(args: { recipeId: string; path: string }) {
    await runInUserTx(async (tx) => {
      const existing = await readImagePaths(tx, args.recipeId);
      const next = [args.path, ...existing.filter((p) => p !== args.path)];
      await tx.update(recipes).set({ imagePaths: next }).where(eq(recipes.id, args.recipeId));
    });
  },

  async removeImage(args: { recipeId: string; path: string }) {
    await runInUserTx(async (tx) => {
      const existing = await readImagePaths(tx, args.recipeId);
      const next = existing.filter((p) => p !== args.path);
      await tx.update(recipes).set({ imagePaths: next }).where(eq(recipes.id, args.recipeId));
    });
    // Storage delete goes through the seam, which lands on Azure Blob.
    await ingestionStorage.remove({ bucket: "recipe-images", paths: [args.path] });
  },

  async replaceIngredients(
    recipeId: string,
    ingredients: Array<Partial<Tables<"recipe_ingredients">> & { raw_text: string }>,
  ) {
    await runInUserTx(async (tx) => {
      await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
      if (ingredients.length === 0) return;
      await tx.insert(recipeIngredients).values(
        ingredients.map((ing, idx) => ({
          recipeId,
          position: idx,
          section: ing.section ?? null,
          rawText: ing.raw_text,
          quantity: ing.quantity ?? null,
          unit: ing.unit ?? null,
          ingredient: ing.ingredient ?? null,
          notes: ing.notes ?? null,
          optional: ing.optional ?? false,
        })) as (typeof recipeIngredients.$inferInsert)[],
      );
    });
  },

  async replaceInstructions(
    recipeId: string,
    instructions: Array<Partial<Tables<"recipe_instructions">> & { text: string }>,
  ) {
    await runInUserTx(async (tx) => {
      await tx.delete(recipeInstructions).where(eq(recipeInstructions.recipeId, recipeId));
      if (instructions.length === 0) return;
      await tx.insert(recipeInstructions).values(
        instructions.map((step, idx) => ({
          recipeId,
          position: idx,
          section: step.section ?? null,
          text: step.text,
          durationMin: step.duration_min ?? null,
        })) as (typeof recipeInstructions.$inferInsert)[],
      );
    });
  },
};

async function listRecipes(args: {
  householdId: string;
  filters?: RecipeFilters;
  limit?: number;
}): Promise<RecipeListItem[]> {
  const f = args.filters ?? {};
  return runInUserTx(async (tx) => {
    const conds = [eq(recipes.householdId, args.householdId), isNull(recipes.archivedAt)];
    if (f.status) conds.push(eq(recipes.status, f.status));
    else conds.push(inArray(recipes.status, ["published", "needs_review"]));
    if (f.favoriteOnly) conds.push(eq(recipes.isFavorite, true));
    if (f.minRating) conds.push(gte(recipes.rating, f.minRating));
    // `arrayContains`, not a hand-written `@> ${array}::text[]`. The template
    // form bound the JS array as ONE scalar parameter, so Postgres saw
    // 'dinner' where it wanted '{dinner}' and raised
    // `malformed array literal`. Not reachable from the UI — the recipe
    // browser filters client-side — which is exactly why it went unnoticed.
    if (f.mealTypes?.length) conds.push(arrayContains(recipes.mealTypes, f.mealTypes));
    if (f.dietTypes?.length) conds.push(arrayContains(recipes.dietTypes, f.dietTypes));
    if (f.cuisines?.length) conds.push(arrayContains(recipes.cuisines, f.cuisines));
    if (f.query) {
      conds.push(dsql`${recipes.searchTsv} @@ websearch_to_tsquery('english', ${f.query})`);
    }

    const rows = await tx
      .select({
        id: recipes.id,
        title: recipes.title,
        description: recipes.description,
        cover_image_path: recipes.coverImagePath,
        image_paths: recipes.imagePaths,
        created_by: recipes.createdBy,
        prep_time_min: recipes.prepTimeMin,
        cook_time_min: recipes.cookTimeMin,
        servings: recipes.servings,
        rating: recipes.rating,
        is_favorite: recipes.isFavorite,
        tags: recipes.tags,
        meal_types: recipes.mealTypes,
        diet_types: recipes.dietTypes,
        cuisines: recipes.cuisines,
        source_url: recipes.sourceUrl,
        status: recipes.status,
        created_at: recipes.createdAt,
        household_id: recipes.householdId,
        nutrition: recipes.nutrition,
        cover_focal_x: recipes.coverFocalX,
        cover_focal_y: recipes.coverFocalY,
        source_name: recipes.sourceName,
        source_metadata: recipes.sourceMetadata,
      })
      .from(recipes)
      .where(and(...conds))
      .orderBy(desc(recipes.createdAt))
      .limit(args.limit ?? 60);

    return rows as unknown as RecipeListItem[];
  });
}

async function getRecipeById(recipeId: string): Promise<RecipeDetail> {
  return runInUserTx(async (tx) => {
    // Columns aliased back to snake_case to preserve the exact Tables<> shape.
    const [recipe] = await tx
      .select({
        id: recipes.id,
        household_id: recipes.householdId,
        created_by: recipes.createdBy,
        title: recipes.title,
        description: recipes.description,
        servings: recipes.servings,
        prep_time_min: recipes.prepTimeMin,
        cook_time_min: recipes.cookTimeMin,
        total_time_min: recipes.totalTimeMin,
        notes: recipes.notes,
        source_kind: recipes.sourceKind,
        source_url: recipes.sourceUrl,
        source_metadata: recipes.sourceMetadata,
        cover_image_path: recipes.coverImagePath,
        image_paths: recipes.imagePaths,
        nutrition: recipes.nutrition,
        ai_metadata: recipes.aiMetadata,
        ai_confidence: recipes.aiConfidence,
        ai_model: recipes.aiModel,
        cuisines: recipes.cuisines,
        meal_types: recipes.mealTypes,
        diet_types: recipes.dietTypes,
        cooking_methods: recipes.cookingMethods,
        difficulty: recipes.difficulty,
        occasions: recipes.occasions,
        tags: recipes.tags,
        rating: recipes.rating,
        is_favorite: recipes.isFavorite,
        status: recipes.status,
        archived_at: recipes.archivedAt,
        embedding: recipes.embedding,
        search_tsv: recipes.searchTsv,
        created_at: recipes.createdAt,
        updated_at: recipes.updatedAt,
        ingestion_job_id: recipes.ingestionJobId,
        external_source_id: recipes.externalSourceId,
        cover_focal_x: recipes.coverFocalX,
        cover_focal_y: recipes.coverFocalY,
        source_name: recipes.sourceName,
      })
      .from(recipes)
      .where(eq(recipes.id, recipeId))
      .limit(1);
    if (!recipe) throw new Error("Recipe not found"); // mirrors PostgREST .single()

    const [ingredients, instructions] = await Promise.all([
      tx
        .select({
          id: recipeIngredients.id,
          recipe_id: recipeIngredients.recipeId,
          position: recipeIngredients.position,
          section: recipeIngredients.section,
          raw_text: recipeIngredients.rawText,
          quantity: recipeIngredients.quantity,
          unit: recipeIngredients.unit,
          ingredient: recipeIngredients.ingredient,
          notes: recipeIngredients.notes,
          optional: recipeIngredients.optional,
          created_at: recipeIngredients.createdAt,
        })
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, recipeId))
        .orderBy(asc(recipeIngredients.position)),
      tx
        .select({
          id: recipeInstructions.id,
          recipe_id: recipeInstructions.recipeId,
          position: recipeInstructions.position,
          section: recipeInstructions.section,
          text: recipeInstructions.text,
          duration_min: recipeInstructions.durationMin,
          created_at: recipeInstructions.createdAt,
        })
        .from(recipeInstructions)
        .where(eq(recipeInstructions.recipeId, recipeId))
        .orderBy(asc(recipeInstructions.position)),
    ]);

    return {
      recipe: recipe as unknown as Tables<"recipes">,
      ingredients: ingredients as unknown as Tables<"recipe_ingredients">[],
      instructions: instructions as unknown as Tables<"recipe_instructions">[],
    };
  });
}
