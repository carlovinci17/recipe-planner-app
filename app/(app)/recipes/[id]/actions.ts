"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recipeService } from "@/lib/services/recipe-service";
import { ratingService } from "@/lib/services/rating-service";
import { plannerService } from "@/lib/services/planner-service";
import { ingestionStorage } from "@/lib/ingestion/storage";
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

const SourcePageCoverSchema = z.object({
  recipeId: z.string().uuid(),
  sourcePath: z.string().min(1),
});

const CoverFocalSchema = z.object({
  recipeId: z.string().uuid(),
  focalX: z.number().int().min(0).max(100),
  focalY: z.number().int().min(0).max(100),
});

/**
 * Manual override for the cover image's focal point. AI sets this at
 * extraction time; this action lets the user nudge framing on the review
 * page or import dialog when the AI's guess missed the food.
 */
export async function setRecipeCoverFocalAction(input: z.infer<typeof CoverFocalSchema>) {
  const parsed = CoverFocalSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await recipeService.update(parsed.data.recipeId, {
      cover_focal_x: parsed.data.focalX,
      cover_focal_y: parsed.data.focalY,
    });
    revalidatePath(`/recipes/${parsed.data.recipeId}`);
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "setRecipeCoverFocalAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

/**
 * Set `cover_image_path` (the AI source page in the recipe-uploads bucket)
 * to a different source page. Used by the CoverPicker on the review page so
 * users can correct the AI's per-recipe page attribution when it picked the
 * wrong page from a multi-recipe document. Distinct from `setRecipeCoverAction`
 * which reorders user-uploaded photos in image_paths.
 *
 * Note: if the recipe has user-uploaded photos in image_paths, those still
 * take precedence over cover_image_path (per resolveCoverImage). The picker
 * UI surfaces this so the user knows to clear user-uploads first if they
 * want the source page to be visible.
 */
export async function setRecipeSourcePageCoverAction(
  input: z.infer<typeof SourcePageCoverSchema>,
) {
  const parsed = SourcePageCoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await recipeService.update(parsed.data.recipeId, {
      cover_image_path: parsed.data.sourcePath,
    });
    revalidatePath(`/recipes/${parsed.data.recipeId}`);
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "setRecipeSourcePageCoverAction failed");
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

const CropCoverSchema = z.object({
  recipeId: z.string().uuid(),
  sourcePath: z.string().min(1),
  /** Crop region as percentages (0–100) of the source image dimensions. */
  cropX: z.number().min(0).max(100),
  cropY: z.number().min(0).max(100),
  cropWidth: z.number().min(1).max(100),
  cropHeight: z.number().min(1).max(100),
});

/**
 * Crop a region from a source page image, optimise it via Sharp, store it
 * in recipe-uploads, and set it as the recipe's cover.
 */
export async function cropAndSaveCoverAction(input: z.infer<typeof CropCoverSchema>) {
  const parsed = CropCoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const { recipeId, sourcePath, cropX, cropY, cropWidth, cropHeight } = parsed.data;

  try {
    const sharp = (await import("sharp")).default;

    // Download source page image from Storage
    const buffer = await ingestionStorage.downloadFile({
      bucket: ingestionStorage.uploadsBucket,
      path: sourcePath,
    });

    // Get actual pixel dimensions so we can convert % → px
    const meta = await sharp(buffer).metadata();
    const W = meta.width ?? 1200;
    const H = meta.height ?? 1600;

    const left = Math.max(0, Math.round((cropX / 100) * W));
    const top = Math.max(0, Math.round((cropY / 100) * H));
    const width = Math.min(W - left, Math.max(1, Math.round((cropWidth / 100) * W)));
    const height = Math.min(H - top, Math.max(1, Math.round((cropHeight / 100) * H)));

    const cropped = await sharp(buffer)
      .extract({ left, top, width, height })
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    // Upload the cropped image alongside the source pages. Must go through the
    // storage seam: writing straight to Supabase here while /api/images reads
    // from Azure Blob meant the new cover saved but never rendered.
    const croppedPath = sourcePath.replace(/\/[^/]+$/, `/cover-crop-${Date.now()}.jpg`);
    await ingestionStorage.uploadTo({
      bucket: ingestionStorage.uploadsBucket,
      path: croppedPath,
      buffer: cropped,
      contentType: "image/jpeg",
    });

    // Point the recipe's cover at the new cropped image, reset focal to center
    await recipeService.update(recipeId, {
      cover_image_path: croppedPath,
      cover_focal_x: 50,
      cover_focal_y: 50,
    });

    revalidatePath(`/recipes/${recipeId}`);
    return { ok: true as const, croppedPath };
  } catch (err) {
    logger.error({ err }, "cropAndSaveCoverAction failed");
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
