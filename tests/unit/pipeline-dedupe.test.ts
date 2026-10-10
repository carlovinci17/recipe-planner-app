import { describe, expect, it } from "vitest";
import { dedupeRecipes } from "@/lib/ingestion/pipeline-helpers";
import type { ExtractedRecipe } from "@/lib/ai/schemas";

const ing = (raw_text: string, section: string | null = null) => ({
  raw_text,
  section,
  quantity: null,
  unit: null,
  ingredient: null,
  notes: null,
  optional: false,
});
const step = (text: string, section: string | null = null) => ({
  text,
  section,
  duration_min: null,
});
const recipe = (over: Partial<ExtractedRecipe>): ExtractedRecipe =>
  ({
    is_recipe: true,
    confidence: 0.9,
    title: "Steak with chimichurri",
    description: null,
    servings: null,
    prep_time_min: null,
    cook_time_min: null,
    ingredients: [],
    instructions: [],
    nutrition: {},
    source_notes: null,
    source_page_index: null,
    cover_focal_x: null,
    cover_focal_y: null,
    ...over,
  }) as ExtractedRecipe;

describe("dedupeRecipes", () => {
  it("merges two halves of a recipe split across a chunk edge", () => {
    const meatHalf = recipe({
      servings: 4,
      source_page_index: 5,
      ingredients: [ing("500 g steak", "Meat"), ing("1 tbsp oil", "Meat")],
      instructions: [step("Sear the steak", "Meat")],
    });
    const sauceHalf = recipe({
      title: "Steak With Chimichurri",
      ingredients: [ing("1 tbsp oil", "Meat"), ing("1 bunch parsley", "Sauce")],
      instructions: [step("Blitz the parsley", "Sauce")],
    });
    const [merged, ...rest] = dedupeRecipes([meatHalf, sauceHalf]);
    expect(rest).toHaveLength(0);
    expect(merged!.ingredients.map((i) => i.raw_text)).toEqual([
      "500 g steak",
      "1 tbsp oil",
      "1 bunch parsley",
    ]);
    expect(merged!.instructions.map((i) => i.text)).toEqual([
      "Sear the steak",
      "Blitz the parsley",
    ]);
    expect(merged!.servings).toBe(4);
    expect(merged!.source_page_index).toBe(5);
  });

  it("keeps distinct recipes apart", () => {
    const out = dedupeRecipes([recipe({ title: "Soup" }), recipe({ title: "Salad" })]);
    expect(out.map((r) => r.title)).toEqual(["Soup", "Salad"]);
  });
});
