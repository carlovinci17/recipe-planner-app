"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Clock, Star, Users } from "lucide-react";
import type { RecipeListItem } from "@/lib/services/recipe-service";
import { Badge } from "@/components/ui/badge";
import { formatMinutes, cn } from "@/lib/utils";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import { resolveCoverImage, coverObjectPositionStyle } from "@/lib/recipes/cover-image";
import { SourcePill } from "@/components/recipes/source-pill";
import { setRecipeFavoriteAction } from "@/app/(app)/recipes/[id]/actions";
import { AddToPlannerButton } from "@/app/(app)/recipes/[id]/add-to-planner-button";

export function RecipeCard({
  recipe,
  rating,
}: {
  recipe: RecipeListItem;
  rating?: { avg: number; count: number };
}) {
  const [isFavorite, setIsFavorite] = useState(recipe.is_favorite);
  const [, startFav] = useTransition();
  const coverRef = resolveCoverImage(recipe);
  const cover = useSignedImage(coverRef?.path ?? null, coverRef?.bucket ?? "recipe-uploads", {
    width: 640,
    resize: "cover",
    quality: 75,
  });
  const totalMin = (recipe.prep_time_min ?? 0) + (recipe.cook_time_min ?? 0);
  const focalStyle = coverObjectPositionStyle(recipe);

  function toggleFavorite() {
    const next = !isFavorite;
    setIsFavorite(next);
    startFav(() => setRecipeFavoriteAction(recipe.id, next));
  }

  const href = `/recipes/${recipe.id}`;

  return (
    <div className="group relative flex overflow-hidden rounded-xl border bg-card shadow-sm transition-colors hover:bg-accent/40 flex-row items-stretch sm:flex-col">

      {/* Action buttons — absolutely positioned, outside the link */}
      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
        <button
          type="button"
          onClick={toggleFavorite}
          aria-label={isFavorite ? "Remove from favourites" : "Add to favourites"}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full shadow-sm transition-colors",
            isFavorite
              ? "bg-amber-400 hover:bg-amber-500 text-white"
              : "bg-background/80 hover:bg-amber-50 text-muted-foreground hover:text-amber-500 border border-border/60",
          )}
        >
          <Star className={cn("h-3.5 w-3.5", isFavorite && "fill-current")} />
        </button>
        <AddToPlannerButton recipeId={recipe.id} householdId={recipe.household_id} compact />
      </div>

      {/* Clickable content — image + body wrapped in Link */}
      <Link href={href} className="flex flex-1 flex-row items-stretch sm:flex-col">

        {/* Desktop cover image */}
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
            <div className="hidden sm:block line-clamp-2 text-sm text-muted-foreground">
              {recipe.description.length > 120
                ? `${recipe.description.slice(0, 120).trimEnd()}…`
                : recipe.description}
            </div>
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

        {/* Mobile thumbnail */}
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
        </div>

      </Link>
    </div>
  );
}
