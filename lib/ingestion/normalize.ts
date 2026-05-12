import "server-only";
import type { ExtractedRecipe } from "@/lib/ai/schemas";

const FRACTION_MAP: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

const UNIT_ALIASES: Record<string, string> = {
  tbsps: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tsp: "tsp",
  tsps: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  cup: "cup",
  cups: "cup",
  ounce: "oz",
  ounces: "oz",
  pound: "lb",
  pounds: "lb",
  gram: "g",
  grams: "g",
  kilogram: "kg",
  kilograms: "kg",
  milliliter: "ml",
  millilitre: "ml",
  milliliters: "ml",
  liter: "l",
  litre: "l",
  liters: "l",
  cloves: "clove",
  pinches: "pinch",
};

function parseFraction(input: string): number | null {
  const trimmed = input.trim();
  if (FRACTION_MAP[trimmed] !== undefined) return FRACTION_MAP[trimmed]!;

  // mixed: "1 1/2"
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed && mixed[1] && mixed[2] && mixed[3]) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }
  // pure: "1/2"
  const pure = trimmed.match(/^(\d+)\/(\d+)$/);
  if (pure && pure[1] && pure[2]) return Number(pure[1]) / Number(pure[2]);

  // unicode fraction-attached: "1½"
  const unicodeMixed = trimmed.match(/^(\d+)([½⅓⅔¼¾⅕⅖⅗⅘⅙⅛⅜⅝⅞])$/);
  if (unicodeMixed && unicodeMixed[1] && unicodeMixed[2]) {
    return Number(unicodeMixed[1]) + (FRACTION_MAP[unicodeMixed[2]] ?? 0);
  }
  return null;
}

export function parseQuantity(input: string | null | undefined): number | null {
  if (!input) return null;
  const value = String(input).trim();
  if (!value) return null;

  const fraction = parseFraction(value);
  if (fraction !== null) return fraction;

  // Range: "1-2" or "1–2" → midpoint
  const range = value.match(/^(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)$/);
  if (range && range[1] && range[2]) return (Number(range[1]) + Number(range[2])) / 2;

  const num = Number(value.replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const lower = unit.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[lower] ?? (lower || null);
}

/**
 * Final pass: ensure quantities are numeric, units are canonical, drop empty
 * ingredients, and clamp confidence into [0, 1].
 */
export function normalizeExtractedRecipe(recipe: ExtractedRecipe): ExtractedRecipe {
  return {
    ...recipe,
    confidence: Math.max(0, Math.min(1, recipe.confidence)),
    title: recipe.title.trim(),
    ingredients: recipe.ingredients
      .map((ing) => ({
        ...ing,
        raw_text: ing.raw_text.trim(),
        quantity: ing.quantity ?? parseQuantity(ing.raw_text.match(/^[\d\s/.,–-]+/)?.[0] ?? null),
        unit: normalizeUnit(ing.unit),
        ingredient: ing.ingredient?.trim() ?? null,
      }))
      .filter((ing) => ing.raw_text.length > 0),
    instructions: recipe.instructions
      .map((step) => ({ ...step, text: step.text.trim() }))
      .filter((step) => step.text.length > 0),
  };
}
