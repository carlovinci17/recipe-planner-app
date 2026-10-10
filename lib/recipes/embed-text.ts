/**
 * The text a recipe is embedded from (recipes.embedding). One definition shared
 * by the write path (`embedRecipe`) and the backfill script, so a recipe embedded
 * at import and one embedded by the backfill are comparable vectors.
 */
export type EmbeddableRecipe = {
  title: string;
  description: string | null;
  cuisines: string[] | null;
  meal_types: string[] | null;
  diet_types: string[] | null;
  tags: string[] | null;
  ingredients: string[] | null;
};

export function recipeEmbedText(r: EmbeddableRecipe): string {
  return [
    r.title,
    r.description ?? "",
    (r.cuisines ?? []).join(" "),
    (r.meal_types ?? []).join(" "),
    (r.diet_types ?? []).join(" "),
    (r.tags ?? []).join(" "),
    (r.ingredients ?? []).join(", "),
  ]
    .filter((s) => s && s.trim())
    .join("\n");
}
