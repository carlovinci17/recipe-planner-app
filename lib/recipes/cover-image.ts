/**
 * Resolve which image to display as the recipe's "cover".
 *
 * Two-track storage:
 *   - `image_paths`         → user-uploaded photos in `recipe-images` bucket
 *   - `cover_image_path`    → AI-generated page preview in `recipe-uploads`
 *
 * User uploads always win. If none, fall back to the AI cover. If neither,
 * return null and the UI shows a placeholder.
 */
export type CoverImageRef = { path: string; bucket: "recipe-images" | "recipe-uploads" };

/**
 * CSS style object for `object-position` based on the recipe's focal point.
 * Defaults to 50%/50% (center crop, same as the historic behavior) when
 * the recipe doesn't have focal coordinates set.
 *
 * Pair with `object-fit: cover` on the `<img>` to keep the focal point
 * visible at any aspect ratio without re-encoding the underlying image.
 */
export function coverObjectPositionStyle(recipe: {
  cover_focal_x?: number | null;
  cover_focal_y?: number | null;
}): { objectPosition: string } {
  const x = clampPct(recipe.cover_focal_x);
  const y = clampPct(recipe.cover_focal_y);
  return { objectPosition: `${x}% ${y}%` };
}

function clampPct(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 50;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v);
}

export function resolveCoverImage(recipe: {
  image_paths: string[] | null;
  cover_image_path: string | null;
}): CoverImageRef | null {
  const userImages = recipe.image_paths ?? [];
  // Legacy data: the old import pipeline used to seed image_paths with the
  // AI page path (which actually lives in recipe-uploads). If image_paths[0]
  // is byte-equal to cover_image_path, it's that artifact — fall through to
  // the cover entry below so the URL gets signed against the right bucket.
  const firstUser = userImages[0];
  if (
    firstUser &&
    firstUser !== recipe.cover_image_path
  ) {
    return { path: firstUser, bucket: "recipe-images" };
  }
  if (recipe.cover_image_path) {
    return { path: recipe.cover_image_path, bucket: "recipe-uploads" };
  }
  return null;
}
