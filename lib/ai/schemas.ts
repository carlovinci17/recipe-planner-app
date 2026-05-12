import { z } from "zod";

// =====================================================================
// Recipe extraction
// =====================================================================
// Schema is intentionally permissive on input units / quantities — the
// extraction model often returns natural-language fragments that we then
// normalize. Stricter validation happens during the normalization step.

export const ExtractedIngredientSchema = z.object({
  raw_text: z.string().min(1),
  section: z.string().nullable().default(null),
  quantity: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),
  ingredient: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  optional: z.boolean().default(false),
});

export const ExtractedInstructionSchema = z.object({
  text: z.string().min(1),
  section: z.string().nullable().default(null),
  duration_min: z.number().int().nullable().default(null),
});

export const ExtractedNutritionSchema = z
  .object({
    calories: z.number().nullable().default(null),
    protein_g: z.number().nullable().default(null),
    carbs_g: z.number().nullable().default(null),
    fat_g: z.number().nullable().default(null),
    fiber_g: z.number().nullable().default(null),
    sugar_g: z.number().nullable().default(null),
    sodium_mg: z.number().nullable().default(null),
  })
  .partial();

export const ExtractedRecipeSchema = z.object({
  is_recipe: z.boolean(),
  confidence: z.number().min(0).max(1),
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  servings: z.number().int().nullable().default(null),
  prep_time_min: z.number().int().nullable().default(null),
  cook_time_min: z.number().int().nullable().default(null),
  ingredients: z.array(ExtractedIngredientSchema).default([]),
  instructions: z.array(ExtractedInstructionSchema).default([]),
  nutrition: ExtractedNutritionSchema.default({}),
  source_notes: z.string().nullable().default(null),
  /**
   * 1-indexed page number this recipe primarily appears on. The pipeline
   * uses this to attribute each sibling recipe in a multi-page document
   * to its own page for the cover image (rather than everyone sharing
   * page 1). null when unknown or non-applicable (single-image / URL).
   */
  source_page_index: z.number().int().min(1).nullable().default(null),
  /**
   * Focal point of the food photo on the source page, expressed as
   * percentages (0–100). 0,0 = top-left; 100,100 = bottom-right; 50,50
   * = center. Used by the renderer (CSS object-position) so the food
   * stays in view at any aspect ratio without re-cropping the image.
   * null when the page has no clear photo (model couldn't decide).
   */
  cover_focal_x: z.number().int().min(0).max(100).nullable().default(null),
  cover_focal_y: z.number().int().min(0).max(100).nullable().default(null),
});

export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;
export type ExtractedIngredient = z.infer<typeof ExtractedIngredientSchema>;
export type ExtractedInstruction = z.infer<typeof ExtractedInstructionSchema>;

/**
 * Skim phase — fast, cheap pass that only identifies WHICH recipes are in a
 * document. Runs on Haiku with low effort; output is tiny per recipe (~50
 * tokens) so even 30-recipe cookbooks fit in a single call.
 *
 * Used by the two-phase import flow: skim → ask user which recipes to keep
 * → deep-extract only the chosen ones. The user picks before paying for
 * the expensive vision OCR on recipes they don't want.
 */
export const SkimmedRecipeSchema = z.object({
  title: z.string().min(1),
  /** One-sentence description so the picker UI can show context. */
  summary: z.string().min(1).max(240),
  /** 1-indexed page number where the recipe primarily appears. */
  source_page_index: z.number().int().min(1).nullable().default(null),
});

export const RecipeSkimResultSchema = z.object({
  recipes: z.array(SkimmedRecipeSchema).default([]),
});

export type SkimmedRecipe = z.infer<typeof SkimmedRecipeSchema>;
export type RecipeSkimResult = z.infer<typeof RecipeSkimResultSchema>;

/**
 * Top-level extraction result. A single document may contain ZERO recipes
 * (non-recipe document), ONE recipe (the common case — a single-recipe page,
 * blog post, or scan), or MANY recipes (a cookbook PDF page, a "10 best
 * cookies" listicle URL, or a recipe-card collection).
 *
 * The model emits one item per distinct recipe; the persistence layer
 * filters items below a confidence floor and inserts the rest as separate
 * `recipes` rows linked to the same ingestion job via `ingestion_job_id`.
 */
export const RecipeExtractionResultSchema = z.object({
  recipes: z.array(ExtractedRecipeSchema).default([]),
});

export type RecipeExtractionResult = z.infer<typeof RecipeExtractionResultSchema>;

// =====================================================================
// Tagging / normalization
// =====================================================================

export const RecipeTagsSchema = z.object({
  cuisines: z.array(z.string()).max(5).default([]),
  meal_types: z.array(z.string()).max(5).default([]),
  diet_types: z.array(z.string()).max(8).default([]),
  cooking_methods: z.array(z.string()).max(5).default([]),
  occasions: z.array(z.string()).max(5).default([]),
  difficulty: z.enum(["easy", "medium", "hard"]).nullable().default(null),
  tags: z.array(z.string()).max(15).default([]),
});

export type RecipeTags = z.infer<typeof RecipeTagsSchema>;

// =====================================================================
// Ingredient normalization (used by shopping-list aggregation)
// =====================================================================

// =====================================================================
// Meal planning (AI Chef)
// =====================================================================
// Used by the planner page's "Plan with AI" feature. Given a list of empty
// (date, slot) cells and a pool of candidate recipes, the model picks one
// recipe per cell that best matches the user's stated constraints. The
// returned recipeIds MUST come from the supplied pool — the action layer
// re-validates this defensively.

export const MealPlanAssignmentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  recipeId: z.string().uuid(),
  reason: z.string().min(1).max(160),
});

export const MealPlanSchema = z.object({
  assignments: z.array(MealPlanAssignmentSchema).default([]),
  /** Optional one-paragraph note from the model — surfaced under the preview. */
  notes: z.string().nullable().default(null),
});

export type MealPlanAssignment = z.infer<typeof MealPlanAssignmentSchema>;
export type MealPlan = z.infer<typeof MealPlanSchema>;

// =====================================================================
// Ingredient normalization (used by shopping-list aggregation)
// =====================================================================

export const NormalizedIngredientSchema = z.object({
  ingredient: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  category: z
    .enum([
      // New, more actionable buckets — see INGREDIENT_NORMALIZATION_SYSTEM
      // for the per-category rules the model should follow.
      "fruit",
      "veggies",
      "herbs",
      "protein",
      "meat",
      "seafood",
      "dairy",
      "grains",
      "pantry",
      "spices",
      "baking",
      "frozen",
      "beverage",
      "condiment",
      "other",
      // Legacy — kept so historical rows that wrote `produce` (before the
      // fruit/veggies split) still validate when re-read.
      "produce",
    ])
    .default("other"),
});

export type NormalizedIngredient = z.infer<typeof NormalizedIngredientSchema>;
