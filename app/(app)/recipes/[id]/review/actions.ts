"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recipeService } from "@/lib/services/recipe-service";
import { getRecipePermissions } from "@/lib/services/permissions";
import { improveRecipe } from "@/lib/ai/recipe-extraction";
import { ingestionService } from "@/lib/services/ingestion-service";
import { logger } from "@/lib/logger";

const ReviewPayload = z.object({
  recipeId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().nullable(),
  servings: z.number().int().nullable(),
  prepTimeMin: z.number().int().nullable(),
  cookTimeMin: z.number().int().nullable(),
  sourceName: z.string().max(100).nullable(),
  sourceUrl: z.string().url().max(2000).nullable(),
  tags: z.array(z.string().min(1).max(50)).max(30).default([]),
  // Taxonomy — previously only ever set by the AI tagger during import, so the
  // form had no way to persist them. Needed now that "Improve with AI" and the
  // meal-type editor let a hand-typed recipe set them.
  mealTypes: z.array(z.string().min(1).max(30)).max(5).default([]),
  cuisines: z.array(z.string().min(1).max(40)).max(5).default([]),
  dietTypes: z.array(z.string().min(1).max(40)).max(8).default([]),
  cookingMethods: z.array(z.string().min(1).max(40)).max(5).default([]),
  occasions: z.array(z.string().min(1).max(40)).max(5).default([]),
  difficulty: z.enum(["easy", "medium", "hard"]).nullable().default(null),
  nutrition: z
    .object({
      calories: z.number().nonnegative().nullable(),
      protein_g: z.number().nonnegative().nullable(),
      carbs_g: z.number().nonnegative().nullable(),
      fat_g: z.number().nonnegative().nullable(),
      fiber_g: z.number().nonnegative().nullable(),
      sugar_g: z.number().nonnegative().nullable(),
      sodium_mg: z.number().nonnegative().nullable(),
    })
    .partial()
    .default({}),
  ingredients: z
    .array(
      z.object({
        raw_text: z.string().min(1),
        section: z.string().nullable(),
        quantity: z.number().nullable(),
        unit: z.string().nullable(),
        ingredient: z.string().nullable(),
        notes: z.string().nullable(),
        optional: z.boolean(),
      }),
    )
    .max(200),
  instructions: z
    .array(
      z.object({
        text: z.string().min(1),
        section: z.string().nullable(),
        duration_min: z.number().int().nullable(),
      }),
    )
    .max(100),
});

const ImproveDraft = z.object({
  recipeId: z.string().uuid(),
  title: z.string().max(300),
  description: z.string().nullable(),
  servings: z.number().int().nullable(),
  prepTimeMin: z.number().int().nullable(),
  cookTimeMin: z.number().int().nullable(),
  ingredients: z.array(z.string().max(500)).max(200).default([]),
  instructions: z.array(z.string().max(4000)).max(100).default([]),
});

export type RecipeSuggestions = {
  meal_types: string[];
  cuisines: string[];
  diet_types: string[];
  cooking_methods: string[];
  occasions: string[];
  difficulty: string | null;
  tags: string[];
  description: string | null;
  servings: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
};

/**
 * "Improve with AI" — classify the draft currently in the form and suggest the
 * plain fields left blank. Reads the draft off the client rather than the saved
 * row, because the user is normally still typing.
 *
 * Returns suggestions only; nothing is written. The form shows them for the user
 * to accept or dismiss, and the usual Save persists whatever they kept
 * (propose → confirm → execute, per ADR-0010).
 */
export async function improveRecipeAction(input: z.infer<typeof ImproveDraft>) {
  const parsed = ImproveDraft.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid payload" };
  const draft = parsed.data;

  // This spends tokens, so authorize before calling the model. RLS also applies
  // underneath, but a paid call deserves an explicit check.
  const bundle = await recipeService.getById(draft.recipeId);
  if (!bundle.recipe) return { ok: false as const, error: "Recipe not found" };
  const perms = await getRecipePermissions({
    recipeId: bundle.recipe.id,
    recipeCreatedBy: bundle.recipe.created_by,
    recipeHouseholdId: bundle.recipe.household_id,
  });
  if (!perms.canEdit) return { ok: false as const, error: "You can't edit this recipe" };

  const title = draft.title.trim();
  const ingredients = draft.ingredients.map((s) => s.trim()).filter(Boolean);
  if (!title && ingredients.length === 0) {
    return {
      ok: false as const,
      error: "Add a title or a few ingredients first — there's nothing to work from yet.",
    };
  }

  // Tell the model which plain fields are already the user's, so it returns null
  // for them instead of offering to replace their wording.
  const filledFields: string[] = [];
  if (draft.description?.trim()) filledFields.push("description");
  if (draft.servings && draft.servings > 0) filledFields.push("servings");
  if (draft.prepTimeMin && draft.prepTimeMin > 0) filledFields.push("prep_time_min");
  if (draft.cookTimeMin && draft.cookTimeMin > 0) filledFields.push("cook_time_min");

  try {
    const result = await improveRecipe({
      title: title || "Untitled recipe",
      description: draft.description,
      ingredients,
      instructions: draft.instructions.map((s) => s.trim()).filter(Boolean),
      filledFields,
    });
    const d = result.data;

    // Belt and braces: drop any plain-field suggestion for a field the user has
    // already filled, even if the model ignored the instruction.
    const suggestions: RecipeSuggestions = {
      meal_types: d.meal_types,
      cuisines: d.cuisines,
      diet_types: d.diet_types,
      cooking_methods: d.cooking_methods,
      occasions: d.occasions,
      difficulty: d.difficulty,
      tags: d.tags,
      description: filledFields.includes("description") ? null : d.description,
      servings: filledFields.includes("servings") ? null : d.servings,
      prepTimeMin: filledFields.includes("prep_time_min") ? null : d.prep_time_min,
      cookTimeMin: filledFields.includes("cook_time_min") ? null : d.cook_time_min,
    };
    return { ok: true as const, suggestions };
  } catch (err) {
    logger.error({ err, recipeId: draft.recipeId }, "improveRecipeAction failed");
    return { ok: false as const, error: "Couldn't reach the AI just now. Try again in a moment." };
  }
}

export async function saveReviewAction(input: z.infer<typeof ReviewPayload>) {
  const parsed = ReviewPayload.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid payload" };

  await recipeService.update(parsed.data.recipeId, {
    title: parsed.data.title,
    description: parsed.data.description,
    servings: parsed.data.servings,
    prep_time_min: parsed.data.prepTimeMin,
    cook_time_min: parsed.data.cookTimeMin,
    source_name: parsed.data.sourceName,
    source_url: parsed.data.sourceUrl,
    tags: parsed.data.tags,
    meal_types: parsed.data.mealTypes,
    cuisines: parsed.data.cuisines,
    diet_types: parsed.data.dietTypes,
    cooking_methods: parsed.data.cookingMethods,
    occasions: parsed.data.occasions,
    difficulty: parsed.data.difficulty,
    nutrition: parsed.data.nutrition,
    status: "published",
  });
  await recipeService.replaceIngredients(parsed.data.recipeId, parsed.data.ingredients);
  await recipeService.replaceInstructions(parsed.data.recipeId, parsed.data.instructions);

  // Bump the originating ingestion job so the Recent imports list shows
  // "Saved" instead of "Ready for review" once the user has actually
  // saved this recipe. Best-effort: not all recipes have a job (manual
  // entries don't), and a missing row isn't an error.
  try {
    await ingestionService.markJobPublishedForRecipe(parsed.data.recipeId);
  } catch (err) {
    logger.warn({ err }, "failed to bump ingestion_job status to published");
  }

  revalidatePath(`/recipes/${parsed.data.recipeId}`);
  revalidatePath("/recipes");
  revalidatePath("/recipes/import");
  return { ok: true as const };
}
