import "server-only";
import { eq } from "drizzle-orm";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeList, normalizeSourceName } from "@/lib/recipes/normalize";
import { env } from "@/lib/env";
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
  if (env.DATABASE_URL) {
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
    if (!recipe) throw new Error(`Failed to insert recipe "${args.extracted.title}" — no row returned`);

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

  const supabase = createSupabaseAdmin();

  const { data: recipe, error } = await supabase
    .from("recipes")
    .insert({
      household_id: args.householdId,
      created_by: args.createdBy,
      title: args.extracted.title || "Untitled recipe",
      description: args.extracted.description,
      servings: args.extracted.servings,
      prep_time_min: args.extracted.prep_time_min,
      cook_time_min: args.extracted.cook_time_min,
      source_kind: args.sourceKind,
      source_url: args.sourceUrl ?? null,
      cover_image_path: args.coverImagePath ?? null,
      image_paths: args.imagePaths ?? [],
      nutrition: args.extracted.nutrition ?? {},
      ai_metadata: { source_notes: args.extracted.source_notes },
      ai_confidence: args.extracted.confidence,
      ai_model: args.aiModel,
      status: "needs_review",
      ingestion_job_id: args.ingestionJobId ?? null,
      external_source_id: args.externalSourceId ?? null,
      source_name: normalizeSourceName(args.sourceName),
      // AI-detected framing. Default to 50/50 (center crop, matching legacy
      // behavior) when the model didn't report a focal point — e.g. pages
      // with no clear photo, or single-image / URL imports.
      cover_focal_x: clampPct(args.extracted.cover_focal_x),
      cover_focal_y: clampPct(args.extracted.cover_focal_y),
    })
    .select("id")
    .single();

  if (error || !recipe) {
    // Tag the failure with the recipe's title + the exact Postgres error
    // (PostgREST surfaces helpful info like "column X does not exist in
    // the schema cache" when a migration hasn't been pushed). Without
    // the title, multi-recipe failures all look identical and the user
    // can't tell which import broke or what migration is missing.
    const detail = error
      ? `${error.message}${error.details ? ` (${error.details})` : ""}${error.hint ? ` — ${error.hint}` : ""}`
      : "no row returned";
    throw new Error(
      `Failed to insert recipe "${args.extracted.title}" — ${detail}`,
    );
  }

  if (args.extracted.ingredients.length > 0) {
    const { error: ingErr } = await supabase.from("recipe_ingredients").insert(
      args.extracted.ingredients.map((ing, idx) => ({
        recipe_id: recipe.id,
        position: idx,
        section: ing.section,
        raw_text: ing.raw_text,
        quantity: ing.quantity,
        unit: ing.unit,
        ingredient: ing.ingredient,
        notes: ing.notes,
        optional: ing.optional,
      })),
    );
    if (ingErr) {
      throw new Error(
        `Ingredient insert failed for "${args.extracted.title}" (${args.extracted.ingredients.length} items): ${ingErr.message}`,
      );
    }
  }

  if (args.extracted.instructions.length > 0) {
    const { error: stepErr } = await supabase.from("recipe_instructions").insert(
      args.extracted.instructions.map((step, idx) => ({
        recipe_id: recipe.id,
        position: idx,
        section: step.section,
        text: step.text,
        duration_min: step.duration_min,
      })),
    );
    if (stepErr) {
      throw new Error(
        `Instruction insert failed for "${args.extracted.title}" (${args.extracted.instructions.length} steps): ${stepErr.message}`,
      );
    }
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
  if (env.DATABASE_URL) {
    const { db } = await import("@/lib/db");
    const { recipes } = await import("@/lib/db/schema");
    await db
      .update(recipes)
      .set({
        cuisines: normalizeList(args.tags.cuisines),
        mealTypes: args.tags.meal_types,
        dietTypes: args.tags.diet_types,
        cookingMethods: args.tags.cooking_methods,
        occasions: args.tags.occasions,
        difficulty: args.tags.difficulty,
        tags: normalizeList(args.tags.tags),
      })
      .where(eq(recipes.id, args.recipeId));
    return;
  }
  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("recipes")
    .update({
      // Normalize the free-form tag/cuisine output (lowercase, dedupe, drop
      // time-only tags) so the recipe browser's filters stay clean.
      cuisines: normalizeList(args.tags.cuisines),
      meal_types: args.tags.meal_types,
      diet_types: args.tags.diet_types,
      cooking_methods: args.tags.cooking_methods,
      occasions: args.tags.occasions,
      difficulty: args.tags.difficulty,
      tags: normalizeList(args.tags.tags),
    })
    .eq("id", args.recipeId);
  if (error) throw new Error(`Tag update failed: ${error.message}`);
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
  if (env.DATABASE_URL) {
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
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("recipes")
    .select(
      `title, description,
       ingredients:recipe_ingredients(raw_text, ingredient),
       steps:recipe_instructions(text)`,
    )
    .eq("id", recipeId)
    .maybeSingle();
  if (!data) return null;
  const d = data as unknown as {
    title: string;
    description: string | null;
    ingredients: Array<{ raw_text: string; ingredient: string | null }>;
    steps: Array<{ text: string }>;
  };
  return {
    title: d.title,
    description: d.description,
    ingredients: d.ingredients.map((i) => i.ingredient ?? i.raw_text ?? ""),
    instructions: d.steps.map((s) => s.text),
  };
}
