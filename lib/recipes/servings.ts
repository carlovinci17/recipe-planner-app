/**
 * Serving-size scaling. A recipe is stored as written (its own `servings`
 * yield); the household cooks for DEFAULT_SERVINGS unless it says otherwise,
 * so both the recipe page and new planner entries start there.
 */
export const DEFAULT_SERVINGS = 2;
export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 24;

type ScalableIngredient = {
  raw_text: string;
  quantity: number | null;
  unit: string | null;
  ingredient: string | null;
  notes: string | null;
};

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
};

// Leading amount in the text as written: "2", "1.5", "1/2", "1 1/2", "½", "1½", "1 ½".
const LEADING_AMOUNT = /^(\d+(?:\.\d+)?)?\s*(\d+\/\d+|[¼½¾⅓⅔⅛])?/;

function parseLeadingAmount(text: string): { value: number; length: number } | null {
  const m = LEADING_AMOUNT.exec(text);
  if (!m || (!m[1] && !m[2])) return null;
  let value = m[1] ? Number(m[1]) : 0;
  const frac = m[2];
  if (frac) {
    if (frac in UNICODE_FRACTIONS) {
      value += UNICODE_FRACTIONS[frac]!;
    } else {
      const [n, d] = frac.split("/").map(Number);
      if (!d) return null;
      value += n! / d;
    }
  }
  return { value, length: m[0].trimEnd().length };
}

const NICE_FRACTIONS: [number, string][] = [
  [0.125, "⅛"],
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
];

/** Kitchen-friendly number: ½ and ¾ for small amounts, whole grams for big ones. */
export function formatQuantity(value: number): string {
  if (value >= 20) return String(Math.round(value));
  const whole = Math.floor(value);
  const rest = value - whole;
  if (rest < 0.05) return String(whole || value.toFixed(2).replace(/0+$/, ""));
  if (rest > 0.95) return String(whole + 1);
  for (const [f, glyph] of NICE_FRACTIONS) {
    if (Math.abs(rest - f) < 0.05) return whole ? `${whole}${glyph}` : glyph;
  }
  return String(Math.round(value * 10) / 10);
}

/**
 * The ingredient line for `scale` × the written amount. Prefers editing the
 * number in place so the original wording survives ("2 small carrots, diced");
 * falls back to rebuilding from the parsed fields when the text does not start
 * with the stored quantity. Lines with no quantity ("salt to taste") are
 * returned unchanged.
 */
export function scaleIngredientText(ing: ScalableIngredient, scale: number): string {
  if (scale === 1 || ing.quantity === null || ing.quantity <= 0) return ing.raw_text;
  const scaled = formatQuantity(ing.quantity * scale);

  const lead = parseLeadingAmount(ing.raw_text);
  if (lead && Math.abs(lead.value - ing.quantity) < 0.01) {
    return scaled + ing.raw_text.slice(lead.length);
  }
  const parts = [scaled, ing.unit, ing.ingredient].filter(Boolean).join(" ");
  return ing.notes ? `${parts}, ${ing.notes}` : parts;
}
