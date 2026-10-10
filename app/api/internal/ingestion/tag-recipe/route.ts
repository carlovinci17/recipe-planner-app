import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { tagRecipe } from "@/lib/ai/recipe-extraction";
import { applyRecipeTags, getRecipeForTagging } from "@/lib/ingestion/persist-recipe";
import { embedRecipe } from "@/lib/agents/embeddings";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Internal ingestion step (Module 6): AI-tag ONE recipe. The orchestrator fans
 * these out after persist (replaces the Inngest `recipe.tagging.requested`
 * fan-out). Reuses the exact tagging logic (`tagRecipe` + `applyRecipeTags`),
 * then embeds the recipe for semantic search.
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

  // Embed after tagging so the tags are part of the vector. Best-effort: a
  // missing embedding only hides the recipe from the assistant's semantic
  // search, which the backfill script repairs — not worth failing the step.
  try {
    await embedRecipe(recipeId);
  } catch (err) {
    logger.warn({ err, recipeId }, "embedRecipe failed after tagging");
  }

  return Response.json({ ok: true, recipeId });
}
