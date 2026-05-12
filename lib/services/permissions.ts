import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cache } from "react";

/**
 * Resolve the current user's permissions on a recipe. Mirrors the RLS policy
 * (creator OR household owner can edit) for UI gating purposes — RLS still
 * enforces server-side, this just hides buttons.
 */
export const getRecipePermissions = cache(async function getRecipePermissions(args: {
  recipeId: string;
  recipeCreatedBy: string;
  recipeHouseholdId: string;
}): Promise<{ canEdit: boolean; canDelete: boolean; isCreator: boolean; isOwner: boolean }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { canEdit: false, canDelete: false, isCreator: false, isOwner: false };

  const isCreator = user.id === args.recipeCreatedBy;

  let isOwner = false;
  if (!isCreator) {
    // Only check ownership if not creator — saves a round-trip.
    const { data } = await supabase
      .from("household_members")
      .select("role")
      .eq("household_id", args.recipeHouseholdId)
      .eq("user_id", user.id)
      .maybeSingle();
    isOwner = data?.role === "owner";
  } else {
    // Creator may or may not be owner — only matters for surfacing role labels.
    const { data } = await supabase
      .from("household_members")
      .select("role")
      .eq("household_id", args.recipeHouseholdId)
      .eq("user_id", user.id)
      .maybeSingle();
    isOwner = data?.role === "owner";
  }

  const canMutate = isCreator || isOwner;
  return { canEdit: canMutate, canDelete: canMutate, isCreator, isOwner };
});
