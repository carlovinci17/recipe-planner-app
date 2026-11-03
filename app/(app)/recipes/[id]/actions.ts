"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recipeService } from "@/lib/services/recipe-service";
import { ratingService } from "@/lib/services/rating-service";
import { plannerService } from "@/lib/services/planner-service";
import { logger } from "@/lib/logger";
import type { MealSlot } from "@/types/database.types";

export async function setRecipeFavoriteAction(recipeId: string, value: boolean) {
  await recipeService.setFavorite(recipeId, value);
  revalidatePath(`/recipes/${recipeId}`);
}

export async function setRecipeRatingAction(recipeId: string, value: number | null) {
  await recipeService.setRating(recipeId, value);
  revalidatePath(`/recipes/${recipeId}`);
}

const MyRatingSchema = z.object({
  recipeId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
});

export async function setMyRecipeRatingAction(input: z.infer<typeof MyRatingSchema>) {
  const parsed = MyRatingSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid rating" };
  try {
    await ratingService.setMyRating(parsed.data);
    revalidatePath(`/recipes/${parsed.data.recipeId}`);
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "setMyRecipeRatingAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function clearMyRecipeRatingAction(recipeId: string) {
  try {
    await ratingService.clearMyRating(recipeId);
    revalidatePath(`/recipes/${recipeId}`);
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "clearMyRecipeRatingAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function archiveRecipeAction(recipeId: string) {
  await recipeService.archive(recipeId);
  revalidatePath("/recipes");
}

export async function deleteRecipeAction(recipeId: string) {
  try {
    await recipeService.delete(recipeId);
    revalidatePath("/recipes");
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "deleteRecipeAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function publishRecipeAction(recipeId: string) {
  await recipeService.publish(recipeId);
  revalidatePath(`/recipes/${recipeId}`);
}

const SignUploadSchema = z.object({
  recipeId: z.string().uuid(),
  householdId: z.string().uuid(),
  fileName: z.string().min(1).max(300),
  contentType: z.string().min(1).max(200),
});

export async function signRecipeImageUploadAction(input: z.infer<typeof SignUploadSchema>) {
  const parsed = SignUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    const result = await recipeService.createImageUploadUrl(parsed.data);
    return { ok: true as const, ...result };
  } catch (err) {
    logger.error({ err }, "signRecipeImageUploadAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const PathSchema = z.object({
  recipeId: z.string().uuid(),
  path: z.string().min(1),
});

export async function attachRecipeImageAction(input: z.infer<typeof PathSchema>) {
  const parsed = PathSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await recipeService.attachImage(parsed.data);
    revalidatePath(`/recipes/${parsed.data.recipeId}`);
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "attachRecipeImageAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function setRecipeCoverAction(input: z.infer<typeof PathSchema>) {
  const parsed = PathSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await recipeService.setCoverImage(parsed.data);
    revalidatePath(`/recipes/${parsed.data.recipeId}`);
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "setRecipeCoverAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function clearRecipeCoverAction(recipeId: string) {
  try {
    await recipeService.update(recipeId, { cover_image_path: null });
    revalidatePath(`/recipes/${recipeId}`);
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "clearRecipeCoverAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function removeRecipeImageAction(input: z.infer<typeof PathSchema>) {
  const parsed = PathSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await recipeService.removeImage(parsed.data);
    revalidatePath(`/recipes/${parsed.data.recipeId}`);
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "removeRecipeImageAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const CoverSourceSchema = z.object({
  bucket: z.enum(["recipe-images", "recipe-uploads"]),
  path: z.string().min(1).max(500),
});

const CropCoverSchema = z.object({
  recipeId: z.string().uuid(),
  source: CoverSourceSchema,
  /** Crop region as percentages (0–100) of the source image. */
  crop: z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    width: z.number().min(1).max(100),
    height: z.number().min(1).max(100),
  }),
});

/**
 * Crop one of the recipe's images into a new cover. The original stays on the
 * recipe as another image (see recipeService.cropCover).
 */
export async function cropRecipeCoverAction(input: z.infer<typeof CropCoverSchema>) {
  const parsed = CropCoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    const path = await recipeService.cropCover(parsed.data);
    revalidatePath(`/recipes/${parsed.data.recipeId}`);
    revalidatePath("/recipes");
    return { ok: true as const, path };
  } catch (err) {
    logger.error({ err }, "cropRecipeCoverAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const MakeCoverSchema = z.object({
  recipeId: z.string().uuid(),
  source: CoverSourceSchema,
});

/** Make one of the recipe's images the cover as it is, without cropping. */
export async function makeRecipeCoverAction(input: z.infer<typeof MakeCoverSchema>) {
  const parsed = MakeCoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await recipeService.makeCover(parsed.data);
    revalidatePath(`/recipes/${parsed.data.recipeId}`);
    revalidatePath("/recipes");
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "makeRecipeCoverAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const AddToPlannerSchema = z.object({
  householdId: z.string().uuid(),
  recipeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
});

export async function addToPlannerAction(input: z.infer<typeof AddToPlannerSchema>) {
  const parsed = AddToPlannerSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    const entry = await plannerService.addEntry({
      householdId: parsed.data.householdId,
      recipeId: parsed.data.recipeId,
      date: parsed.data.date,
      slot: parsed.data.slot as MealSlot,
    });
    revalidatePath("/planner");
    return { ok: true as const, entry };
  } catch (err) {
    logger.error({ err }, "addToPlannerAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}
