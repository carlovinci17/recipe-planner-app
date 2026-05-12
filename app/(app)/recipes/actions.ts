"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recipeService } from "@/lib/services/recipe-service";
import { householdService } from "@/lib/services/household-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

const BulkDeleteSchema = z.object({
  householdId: z.string().uuid(),
  recipeIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Owner-only bulk delete. Two layers of authorization:
 *   1. Membership + role check here (only household owners can bulk-delete).
 *   2. RLS at the row level — even if this check is bypassed, the database
 *      rejects deletes the caller doesn't own.
 *
 * Returns the count of rows actually removed. RLS may filter out rows the
 * caller can't delete, so `deleted` may be smaller than `recipeIds.length`.
 */
export async function bulkDeleteRecipesAction(input: z.infer<typeof BulkDeleteSchema>) {
  const parsed = BulkDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    const memberships = await householdService.listForCurrentUser();
    const m = memberships.find((m) => m.household.id === parsed.data.householdId);
    if (!m) {
      return { ok: false as const, error: "Not a member of this household" };
    }
    if (m.role !== "owner") {
      return { ok: false as const, error: "Only household owners can bulk-delete recipes" };
    }
    const deleted = await recipeService.bulkDelete({
      householdId: parsed.data.householdId,
      recipeIds: parsed.data.recipeIds,
    });
    revalidatePath("/recipes");
    return { ok: true as const, deleted };
  } catch (err) {
    logger.error({ err }, "bulkDeleteRecipesAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const BulkPublishSchema = z.object({
  recipeIds: z.array(z.string().uuid()).min(1).max(100),
});

/**
 * Bulk-publish recipes that are currently in `needs_review`. Used by the
 * "Save all" action on a multi-recipe import row — when an N-recipe PDF
 * imports cleanly, the user can approve every sibling at once instead of
 * stepping through each review page.
 *
 * Two safety guards:
 *   - The filter `status = 'needs_review'` ensures already-published or
 *     already-failed recipes don't get reverted.
 *   - RLS scopes to household membership at the row level. The returned
 *     count reflects only rows the caller could actually update — so
 *     calling with foreign ids is harmless and visible (returned count
 *     less than recipeIds.length).
 */
export async function bulkPublishRecipesAction(input: z.infer<typeof BulkPublishSchema>) {
  const parsed = BulkPublishSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    const supabase = await createSupabaseServerClient();
    const { error, count, data } = await supabase
      .from("recipes")
      .update({ status: "published" }, { count: "exact" })
      .eq("status", "needs_review")
      .in("id", parsed.data.recipeIds)
      .select("id");
    if (error) throw error;
    revalidatePath("/recipes");
    revalidatePath("/recipes/import");
    return { ok: true as const, published: count ?? 0, ids: data?.map((r) => r.id) ?? [] };
  } catch (err) {
    logger.error({ err }, "bulkPublishRecipesAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}
