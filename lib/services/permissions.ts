import "server-only";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { householdMembers } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { runInUserTx } from "./user-tx";

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
  const user = await getCurrentUser();
  if (!user) return { canEdit: false, canDelete: false, isCreator: false, isOwner: false };

  const isCreator = user.id === args.recipeCreatedBy;

  // Look up the caller's household role (owner ⇒ can edit any recipe). This was
  // previously two identical if/else branches (tech-debt #1) — collapsed here.
  let isOwner = false;
  if (env.DATABASE_URL) {
    const rows = await runInUserTx((tx) =>
      tx
        .select({ role: householdMembers.role })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, args.recipeHouseholdId),
            eq(householdMembers.userId, user.id),
          ),
        )
        .limit(1),
    );
    isOwner = rows[0]?.role === "owner";
  } else {
    const supabase = await createSupabaseServerClient();
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
