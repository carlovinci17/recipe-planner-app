/**
 * Deterministic source-name → Tailwind palette. Same source label always
 * lands on the same colour, so the user's eye learns to spot "Health with
 * Bec" or "RecipeTin Eats" at a glance across the listing.
 *
 * Pinned map covers a handful of popular sources (including a few from the
 * KNOWN domain list in source-name.ts) so they get nice, on-brand-ish hues.
 * Anything not pinned falls back to a stable hash over the PALETTE.
 *
 * Tailwind class names must be statically discoverable for JIT. The classes
 * baked into this file are all literal — no template-string composition.
 */

export type SourcePalette = {
  /** Solid background, used for the pill body. */
  bg: string;
  /** Text colour that pairs with the bg. */
  text: string;
  /** Soft border so the pill keeps shape over busy thumbnails. */
  border: string;
  /** Translucent variant for the banner overlay (sits on top of a photo). */
  overlayBg: string;
  overlayText: string;
  overlayBorder: string;
};

const PALETTE: SourcePalette[] = [
  {
    bg: "bg-lime-100",
    text: "text-lime-900",
    border: "border-lime-300",
    overlayBg: "bg-lime-500/85",
    overlayText: "text-lime-950",
    overlayBorder: "border-lime-200/50",
  },
  {
    bg: "bg-sky-100",
    text: "text-sky-900",
    border: "border-sky-300",
    overlayBg: "bg-sky-500/85",
    overlayText: "text-white",
    overlayBorder: "border-sky-200/50",
  },
  {
    bg: "bg-amber-100",
    text: "text-amber-900",
    border: "border-amber-300",
    overlayBg: "bg-amber-500/90",
    overlayText: "text-amber-950",
    overlayBorder: "border-amber-200/50",
  },
  {
    bg: "bg-rose-100",
    text: "text-rose-900",
    border: "border-rose-300",
    overlayBg: "bg-rose-500/85",
    overlayText: "text-white",
    overlayBorder: "border-rose-200/50",
  },
  {
    bg: "bg-violet-100",
    text: "text-violet-900",
    border: "border-violet-300",
    overlayBg: "bg-violet-500/85",
    overlayText: "text-white",
    overlayBorder: "border-violet-200/50",
  },
  {
    bg: "bg-emerald-100",
    text: "text-emerald-900",
    border: "border-emerald-300",
    overlayBg: "bg-emerald-500/85",
    overlayText: "text-white",
    overlayBorder: "border-emerald-200/50",
  },
  {
    bg: "bg-orange-100",
    text: "text-orange-900",
    border: "border-orange-300",
    overlayBg: "bg-orange-500/90",
    overlayText: "text-orange-950",
    overlayBorder: "border-orange-200/50",
  },
  {
    bg: "bg-cyan-100",
    text: "text-cyan-900",
    border: "border-cyan-300",
    overlayBg: "bg-cyan-500/85",
    overlayText: "text-white",
    overlayBorder: "border-cyan-200/50",
  },
  {
    bg: "bg-pink-100",
    text: "text-pink-900",
    border: "border-pink-300",
    overlayBg: "bg-pink-500/85",
    overlayText: "text-white",
    overlayBorder: "border-pink-200/50",
  },
  {
    bg: "bg-teal-100",
    text: "text-teal-900",
    border: "border-teal-300",
    overlayBg: "bg-teal-500/85",
    overlayText: "text-white",
    overlayBorder: "border-teal-200/50",
  },
  {
    bg: "bg-indigo-100",
    text: "text-indigo-900",
    border: "border-indigo-300",
    overlayBg: "bg-indigo-500/85",
    overlayText: "text-white",
    overlayBorder: "border-indigo-200/50",
  },
  {
    bg: "bg-fuchsia-100",
    text: "text-fuchsia-900",
    border: "border-fuchsia-300",
    overlayBg: "bg-fuchsia-500/85",
    overlayText: "text-white",
    overlayBorder: "border-fuchsia-200/50",
  },
];

// Index into PALETTE for a handful of sources where the user has expressed
// a colour preference or a brand association feels natural. Key is the
// normalised source name (lowercased, trimmed).
const PINNED: Record<string, number> = {
  "health with bec": 0,        // lime
  "recipetin eats": 5,         // emerald
  "bbc good food": 3,          // rose
  "bbc food": 3,
  "youtube": 3,                // youtube red ≈ rose
  "nyt cooking": 1,            // sky-ish
  "smitten kitchen": 8,        // pink
  "bon appétit": 6,            // orange
  "serious eats": 6,
  "allrecipes": 2,             // amber
  "tasty": 7,                  // cyan
  "jamie oliver": 5,
  "half baked harvest": 9,     // teal
  "minimalist baker": 11,      // fuchsia
  "budget bytes": 10,          // indigo
  "the kitchn": 1,
  "food52": 4,                 // violet
  "delish": 8,
  "food network": 6,
  "epicurious": 11,
  "ottolenghi": 4,
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getSourcePalette(name: string): SourcePalette {
  const key = name.trim().toLowerCase();
  const pinned = PINNED[key];
  if (typeof pinned === "number") return PALETTE[pinned]!;
  return PALETTE[hash(key) % PALETTE.length]!;
}
