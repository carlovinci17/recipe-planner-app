import "server-only";
import { eq } from "drizzle-orm";
import { ensureMealTypes, normalizeList, normalizeSourceName } from "@/lib/recipes/normalize";
import type { ExtractedRecipe } from "@/lib/ai/schemas";
import type { RecipeSourceKind } from "@/types/database.types";

function clampPct(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 50;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v);
}

/**
 * Insert a draft recipe (status='needs_review') from an ExtractedRecipe.
 * Caller is expected to be in a trusted background context (Inngest function).
 *
 * `ingestionJobId` back-links the recipe to the import that created it.
 * One ingestion job can produce multiple recipes (cookbook PDFs, listicle
 * URLs); this FK is what the UI uses to group siblings under a single row.
 */
export async function persistDraftRecipe(args: {
  householdId: string;
  createdBy: string;
  sourceKind: RecipeSourceKind;
  sourceUrl?: string | null;
  coverImagePath?: string | null;
  imagePaths?: string[];
  aiModel: string;
  extracted: ExtractedRecipe;
  ingestionJobId?: string | null;
  /**
   * Stable id from the originating external system (e.g. Google Drive file id)
   * for canonical dedup. Outlasts the ingestion_jobs row, so future scans can
   * skip files whose recipe still exists even if the import history was wiped.
   */
  externalSourceId?: string | null;
  /**
   * Human-friendly source label (e.g. "Health with Bec", "RecipeTin Eats").
   * Auto-populated by the URL pipeline; users can edit on the review form.
   */
  sourceName?: string | null;
}): Promise<string> {
  // Neon (admin, RLS-bypassing superuser connection) — background context.
  const { db } = await import("@/lib/db");
  const { recipeIngredients, recipeInstructions, recipes } = await import("@/lib/db/schema");
  const [recipe] = await db
    .insert(recipes)
    .values({
      householdId: args.householdId,
      createdBy: args.createdBy,
      title: args.extracted.title || "Untitled recipe",
      description: args.extracted.description,
      servings: args.extracted.servings,
      prepTimeMin: args.extracted.prep_time_min,
      cookTimeMin: args.extracted.cook_time_min,
      sourceKind: args.sourceKind,
      sourceUrl: args.sourceUrl ?? null,
      coverImagePath: args.coverImagePath ?? null,
      imagePaths: args.imagePaths ?? [],
      nutrition: args.extracted.nutrition ?? {},
      aiMetadata: { source_notes: args.extracted.source_notes },
      aiConfidence: args.extracted.confidence,
      aiModel: args.aiModel,
      status: "needs_review",
      ingestionJobId: args.ingestionJobId ?? null,
      externalSourceId: args.externalSourceId ?? null,
      sourceName: normalizeSourceName(args.sourceName),
      coverFocalX: clampPct(args.extracted.cover_focal_x),
      coverFocalY: clampPct(args.extracted.cover_focal_y),
    })
    .returning({ id: recipes.id });
  if (!recipe)
    throw new Error(`Failed to insert recipe "${args.extracted.title}" — no row returned`);

  if (args.extracted.ingredients.length > 0) {
    await db.insert(recipeIngredients).values(
      args.extracted.ingredients.map((ing, idx) => ({
        recipeId: recipe.id,
        position: idx,
        section: ing.section,
        rawText: ing.raw_text,
        quantity: ing.quantity,
        unit: ing.unit,
        ingredient: ing.ingredient,
        notes: ing.notes,
        optional: ing.optional,
      })),
    );
  }
  if (args.extracted.instructions.length > 0) {
    await db.insert(recipeInstructions).values(
      args.extracted.instructions.map((step, idx) => ({
        recipeId: recipe.id,
        position: idx,
        section: step.section,
        text: step.text,
        durationMin: step.duration_min,
      })),
    );
  }
  return recipe.id;
}

export async function applyRecipeTags(args: {
  recipeId: string;
  tags: {
    cuisines: string[];
    meal_types: string[];
    diet_types: string[];
    cooking_methods: string[];
    occasions: string[];
    difficulty: string | null;
    tags: string[];
  };
}): Promise<void> {
  const { db } = await import("@/lib/db");
  const { recipes } = await import("@/lib/db/schema");
  await db
    .update(recipes)
    .set({
      cuisines: normalizeList(args.tags.cuisines),
      mealTypes: ensureMealTypes(args.tags.meal_types, args.tags.tags),
      dietTypes: args.tags.diet_types,
      cookingMethods: args.tags.cooking_methods,
      occasions: args.tags.occasions,
      difficulty: args.tags.difficulty,
      tags: normalizeList(args.tags.tags),
    })
    .where(eq(recipes.id, args.recipeId));
}

/**
 * Read a recipe flattened for the AI tagger (title + description + ingredient
 * strings + instruction strings). Dual-dispatch (Neon vs Supabase); used by the
 * tag-recipe internal endpoint (Module 11.1).
 */
export async function getRecipeForTagging(recipeId: string): Promise<{
  title: string;
  description: string | null;
  ingredients: string[];
  instructions: string[];
} | null> {
  const { db } = await import("@/lib/db");
  const { recipeIngredients, recipeInstructions, recipes } = await import("@/lib/db/schema");
  const [r] = await db
    .select({ title: recipes.title, description: recipes.description })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1);
  if (!r) return null;
  const ings = await db
    .select({ ingredient: recipeIngredients.ingredient, rawText: recipeIngredients.rawText })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(recipeIngredients.position);
  const steps = await db
    .select({ text: recipeInstructions.text })
    .from(recipeInstructions)
    .where(eq(recipeInstructions.recipeId, recipeId))
    .orderBy(recipeInstructions.position);
  return {
    title: r.title,
    description: r.description,
    ingredients: ings.map((i) => i.ingredient ?? i.rawText ?? ""),
    instructions: steps.map((s) => s.text),
  };
}
