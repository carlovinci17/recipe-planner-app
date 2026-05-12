/**
 * Derive a friendly source name from a recipe's source_url.
 *
 *   https://www.recipetineats.com/honey-soy-chicken/  →  "RecipeTin Eats"
 *   https://www.bbcgoodfood.com/recipes/easy-pasta    →  "BBC Good Food"
 *   https://example.com/...                            →  "Example"
 *   null / invalid                                     →  null
 *
 * The KNOWN map gives us nice capitalisation/spacing for popular sites;
 * unknown domains fall back to the domain stem capitalised.
 */
const KNOWN: Record<string, string> = {
  "recipetineats.com": "RecipeTin Eats",
  "bbcgoodfood.com": "BBC Good Food",
  "allrecipes.com": "Allrecipes",
  "smittenkitchen.com": "Smitten Kitchen",
  "seriouseats.com": "Serious Eats",
  "bonappetit.com": "Bon Appétit",
  "nytimes.com": "NYT Cooking",
  "cooking.nytimes.com": "NYT Cooking",
  "epicurious.com": "Epicurious",
  "foodnetwork.com": "Food Network",
  "delish.com": "Delish",
  "food52.com": "Food52",
  "thekitchn.com": "The Kitchn",
  "halfbakedharvest.com": "Half Baked Harvest",
  "minimalistbaker.com": "Minimalist Baker",
  "budgetbytes.com": "Budget Bytes",
  "bbc.co.uk": "BBC Food",
  "tasty.co": "Tasty",
  "jamieoliver.com": "Jamie Oliver",
  "ottolenghi.co.uk": "Ottolenghi",
  "youtube.com": "YouTube",
  "m.youtube.com": "YouTube",
  "youtu.be": "YouTube",
};

export function getSourceName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (KNOWN[host]) return KNOWN[host]!;
    // Fall back: split on dots, drop TLD, capitalise the stem.
    // "foodbloggerpro.com" → "Foodbloggerpro"
    const stem = host.split(".")[0] ?? host;
    if (!stem) return null;
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  } catch {
    return null;
  }
}

/**
 * Resolve the best source label for a recipe. Priority:
 *   1. `source_name` (explicit, editable on the review form)
 *   2. `source_metadata.channel_name` (legacy YouTube imports that
 *      predate `source_name`)
 *   3. `getSourceName(source_url)` (domain-derived fallback)
 *
 * Use this everywhere we want to display the source — listing card, detail
 * page, the source filter on the recipes browser, etc.
 */
export function getRecipeSourceName(recipe: {
  source_name: string | null;
  source_url: string | null;
  source_metadata: unknown;
}): string | null {
  if (recipe.source_name && recipe.source_name.trim().length > 0) {
    return recipe.source_name;
  }
  const meta = recipe.source_metadata as { channel_name?: string } | null;
  if (meta?.channel_name && meta.channel_name.trim().length > 0) {
    return meta.channel_name;
  }
  return getSourceName(recipe.source_url);
}

/**
 * Slug used as the value in URL filters and chip keys. Keeps things URL-safe
 * and stable even if we tweak display capitalisation later.
 */
export function getSourceSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
