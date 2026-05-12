"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recipeService } from "@/lib/services/recipe-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
    status: "published",
  });
  await recipeService.replaceIngredients(parsed.data.recipeId, parsed.data.ingredients);
  await recipeService.replaceInstructions(parsed.data.recipeId, parsed.data.instructions);

  // Bump the originating ingestion job so the Recent imports list shows
  // "Saved" instead of "Ready for review" once the user has actually
  // saved this recipe. Best-effort: not all recipes have a job (manual
  // entries don't), and a missing row isn't an error.
  try {
    const supabase = await createSupabaseServerClient();
    await supabase
      .from("ingestion_jobs")
      .update({ status: "published" })
      .eq("recipe_id", parsed.data.recipeId)
      .eq("status", "needs_review");
  } catch (err) {
    logger.warn({ err }, "failed to bump ingestion_job status to published");
  }

  revalidatePath(`/recipes/${parsed.data.recipeId}`);
  revalidatePath("/recipes");
  revalidatePath("/recipes/import");
  return { ok: true as const };
}
