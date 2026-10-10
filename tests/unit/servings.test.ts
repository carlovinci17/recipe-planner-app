import { describe, expect, it } from "vitest";
import { formatQuantity, scaleIngredientText } from "@/lib/recipes/servings";

const ing = (
  raw_text: string,
  quantity: number | null,
  rest: Partial<{ unit: string; ingredient: string; notes: string }> = {},
) => ({
  raw_text,
  quantity,
  unit: rest.unit ?? null,
  ingredient: rest.ingredient ?? null,
  notes: rest.notes ?? null,
});

describe("formatQuantity", () => {
  it.each([
    [0.5, "½"],
    [0.25, "¼"],
    [1.5, "1½"],
    [2, "2"],
    [0.333, "⅓"],
    [1.2, "1.2"],
    [300, "300"],
    [22.4, "22"],
    [0.125, "⅛"],
    [0.03, "0.03"],
  ])("%s → %s", (v, out) => expect(formatQuantity(v)).toBe(out));
});

describe("scaleIngredientText", () => {
  it("returns the original line at scale 1", () => {
    expect(scaleIngredientText(ing("2 lemons", 2), 1)).toBe("2 lemons");
  });

  it("edits the number in place, keeping the wording", () => {
    expect(scaleIngredientText(ing("2 small carrots, diced", 2), 0.5)).toBe(
      "1 small carrots, diced",
    );
    expect(scaleIngredientText(ing("600 g chicken breast, skinless", 600), 0.5)).toBe(
      "300 g chicken breast, skinless",
    );
  });

  it("understands unicode and slash fractions", () => {
    expect(scaleIngredientText(ing("½ tsp vanilla extract", 0.5), 2)).toBe("1 tsp vanilla extract");
    expect(scaleIngredientText(ing("1 1/2 cups flour", 1.5), 2)).toBe("3 cups flour");
    expect(scaleIngredientText(ing("1½ cups milk", 1.5), 2)).toBe("3 cups milk");
  });

  it("rebuilds from fields when the text does not lead with the quantity", () => {
    expect(
      scaleIngredientText(
        ing("Chicken breast, 600g", 600, { unit: "g", ingredient: "chicken breast" }),
        0.5,
      ),
    ).toBe("300 g chicken breast");
  });

  it("leaves unquantified lines alone", () => {
    expect(scaleIngredientText(ing("Salt, to taste", null), 3)).toBe("Salt, to taste");
  });
});
