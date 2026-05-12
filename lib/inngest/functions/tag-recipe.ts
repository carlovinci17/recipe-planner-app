import "server-only";
import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest/client";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { tagRecipe } from "@/lib/ai/recipe-extraction";
import { applyRecipeTags } from "@/lib/ingestion/persist-recipe";

export const tagRecipeFn = inngest.createFunction(
  {
    id: "ingestion-tag-recipe",
    name: "Tag recipe with AI",
    retries: 2,
    concurrency: { limit: 16 },
  },
  { event: "ingestion/recipe.tagging.requested" },
  async ({ event, step }) => {
    const { recipeId } = event.data;
    const supabase = createSupabaseAdmin();

    type RecipeBundle = {
      title: string;
      description: string | null;
      ingredients: Array<{ raw_text: string; ingredient: string | null }>;
      steps: Array<{ text: string }>;
    };

    const recipe = await step.run("load-recipe", async (): Promise<RecipeBundle> => {
      const { data, error } = await supabase
        .from("recipes")
        .select(
          `id, title, description,
           ingredients:recipe_ingredients(raw_text, ingredient),
           steps:recipe_instructions(text)`,
        )
        .eq("id", recipeId)
        .single();
      if (error || !data) throw new NonRetriableError(`Recipe ${recipeId} not found`);
      // Embedded selects aren't statically typed; cast through unknown.
      return data as unknown as RecipeBundle;
    });

    const tags = await step.run("ai-tag", async () => {
      const result = await tagRecipe({
        title: recipe.title,
        description: recipe.description,
        ingredients: recipe.ingredients.map((i) => i.ingredient ?? i.raw_text ?? ""),
        instructions: recipe.steps.map((s) => s.text),
      });
      return result.data;
    });

    await step.run("apply-tags", () => applyRecipeTags({ recipeId, tags }));
    return { recipeId, tagsApplied: true };
  },
);
