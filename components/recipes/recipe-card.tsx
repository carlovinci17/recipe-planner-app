"use client";

import Link from "next/link";
import { Clock, Star, Users } from "lucide-react";
import type { RecipeListItem } from "@/lib/services/recipe-service";
import { Badge } from "@/components/ui/badge";
import { formatMinutes } from "@/lib/utils";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import { resolveCoverImage, coverObjectPositionStyle } from "@/lib/recipes/cover-image";
import { SourcePill } from "@/components/recipes/source-pill";

export function RecipeCard({
  recipe,
  rating,
}: {
  recipe: RecipeListItem;
  /**
   * Household-level rating aggregate for this recipe. Optional because the
   * card is used in contexts that don't fetch aggregates (e.g. embedded
   * pickers); when absent, the rating display falls back to hidden. The
   * deprecated `recipe.rating` integer is NO LONGER read — it represents
   * a long-dead single-user rating model and produced stale values.
   */
  rating?: { avg: number; count: number };
}) {
  const coverRef = resolveCoverImage(recipe);
  // Listing card thumbs: cards are ~280–320px wide; 640 covers 2× DPI
  // with room to spare. Supabase's transform pipeline caches the variant.
  const cover = useSignedImage(coverRef?.path ?? null, coverRef?.bucket ?? "recipe-uploads", {
    width: 640,
    resize: "cover",
    quality: 75,
  });
  const totalMin = (recipe.prep_time_min ?? 0) + (recipe.cook_time_min ?? 0);
  const focalStyle = coverObjectPositionStyle(recipe);

  return (
    <Link
      href={`/recipes/${recipe.id}`}
      className="group flex overflow-hidden rounded-xl border bg-card shadow-sm transition-colors hover:bg-accent/40 flex-row items-stretch sm:flex-col"
    >
      {/* Desktop cover image — full width, hidden on mobile */}
      <div className="relative hidden aspect-[4/3] w-full overflow-hidden bg-muted sm:block">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={recipe.title}
            loading="lazy"
            style={focalStyle}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">🍽️</div>
        )}
        {recipe.status === "needs_review" ? (
          <div className="absolute left-2 top-2">
            <Badge variant="default">Needs review</Badge>
          </div>
        ) : (
          <div className="absolute left-2 top-2 max-w-[70%]">
            <SourcePill recipe={recipe} variant="overlay" size="xs" asLink={false} />
          </div>
        )}
        {recipe.is_favorite ? (
          <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur-sm">
            <Star className="h-4 w-4 fill-amber-500 text-amber-500" aria-label="Favorite" />
          </div>
        ) : null}
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col gap-1 p-2.5 sm:gap-2 sm:p-4">
        {recipe.status === "needs_review" ? (
          <div className="sm:hidden mb-0.5">
            <Badge variant="default" className="text-xs">Needs review</Badge>
          </div>
        ) : null}
        <div className="line-clamp-2 font-medium leading-snug">{recipe.title}</div>
        {recipe.description ? (
          <div className="hidden sm:block line-clamp-2 text-sm text-muted-foreground">{recipe.description}</div>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {totalMin > 0 ? (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {formatMinutes(totalMin)}
            </span>
          ) : null}
          {recipe.servings ? (
            <span className="hidden sm:flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {recipe.servings}
            </span>
          ) : null}
          {rating && rating.count > 0 ? (
            <span
              className="hidden sm:flex items-center gap-1"
              title={`${rating.count} ${rating.count === 1 ? "rating" : "ratings"}`}
            >
              <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
              <span className="font-medium text-foreground">{rating.avg.toFixed(1)}</span>
              <span className="text-[10px]">({rating.count})</span>
            </span>
          ) : null}
        </div>
        {recipe.tags.length > 0 ? (
          <div className="hidden sm:flex flex-wrap gap-1">
            {recipe.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      {/* Mobile thumbnail — small square on the right, hidden on desktop */}
      <div className="relative order-last m-2.5 h-16 w-16 shrink-0 self-center overflow-hidden rounded-lg bg-muted sm:hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={recipe.title}
            loading="lazy"
            style={focalStyle}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xl">🍽️</div>
        )}
        {recipe.is_favorite ? (
          <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 shadow-sm">
            <Star className="h-3 w-3 fill-amber-500 text-amber-500" aria-label="Favorite" />
          </div>
        ) : null}
      </div>
    </Link>
  );
}
