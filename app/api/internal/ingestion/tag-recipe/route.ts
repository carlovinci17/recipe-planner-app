import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { tagRecipe } from "@/lib/ai/recipe-extraction";
import { applyRecipeTags } from "@/lib/ingestion/persist-recipe";

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
  const supabase = createSupabaseAdmin();

  const { data, error } = await supabase
    .from("recipes")
    .select(
      `id, title, description,
       ingredients:recipe_ingredients(raw_text, ingredient),
       steps:recipe_instructions(text)`,
    )
    .eq("id", recipeId)
    .single();
  if (error || !data) return Response.json({ ok: false, error: `Recipe ${recipeId} not found` });

  const recipe = data as unknown as {
    title: string;
    description: string | null;
    ingredients: Array<{ raw_text: string; ingredient: string | null }>;
    steps: Array<{ text: string }>;
  };

  const result = await tagRecipe({
    title: recipe.title,
    description: recipe.description,
    ingredients: recipe.ingredients.map((i) => i.ingredient ?? i.raw_text ?? ""),
    instructions: recipe.steps.map((s) => s.text),
  });
  await applyRecipeTags({ recipeId, tags: result.data });

  return Response.json({ ok: true, recipeId });
}
