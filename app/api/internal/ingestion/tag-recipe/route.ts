import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { tagRecipe } from "@/lib/ai/recipe-extraction";
import { applyRecipeTags, getRecipeForTagging } from "@/lib/ingestion/persist-recipe";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Internal ingestion step (Module 6): AI-tag ONE recipe. The orchestrator fans
 * these out after persist (replaces the Inngest `recipe.tagging.requested`
 * fan-out). Reuses the exact tagging logic (`tagRecipe` + `applyRecipeTags`).
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { recipeId } = (await req.json()) as { recipeId: string };

  const recipe = await getRecipeForTagging(recipeId);
  if (!recipe) return Response.json({ ok: false, error: `Recipe ${recipeId} not found` });

  const result = await tagRecipe({
    title: recipe.title,
    description: recipe.description,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions,
  });
  await applyRecipeTags({ recipeId, tags: result.data });

  return Response.json({ ok: true, recipeId });
}
