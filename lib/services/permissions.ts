import "server-only";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/current-user";
import { householdMembers } from "@/lib/db/schema";
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

  // Look up the caller's household role (owner can edit any recipe).
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
  const isOwner = rows[0]?.role === "owner";

  const canMutate = isCreator || isOwner;
  return { canEdit: canMutate, canDelete: canMutate, isCreator, isOwner };
});
