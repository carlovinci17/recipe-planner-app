import { redirect } from "next/navigation";
import { getActiveHousehold } from "@/lib/services/active-household";
import { recipeService } from "@/lib/services/recipe-service";

/**
 * Creating a manual recipe is just inserting a draft and redirecting into
 * the review screen, where editing UI already exists.
 */
export default async function NewRecipePage() {
  const household = await getActiveHousehold();
  const id = await recipeService.createDraft({ householdId: household.id });
  redirect(`/recipes/${id}/review`);
}
