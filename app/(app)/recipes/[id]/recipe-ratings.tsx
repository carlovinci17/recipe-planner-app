"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RecipeRating } from "@/lib/services/rating-service";
import {
  clearMyRecipeRatingAction,
  setMyRecipeRatingAction,
} from "./actions";

/**
 * Per-user recipe ratings, rendered on the detail page.
 *
 * - The current user's row at top with an interactive 1–5 star picker.
 *   Clicking a star sets the rating; clicking the active star clears it.
 *   Hover preview shows the prospective rating before commit.
 * - Other household members' ratings appear below as small avatar + stars
 *   pills. RLS hides ratings from other households automatically.
 */
export function RecipeRatings({
  recipeId,
  ratings,
  currentUserId,
}: {
  recipeId: string;
  ratings: RecipeRating[];
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hover, setHover] = useState<number | null>(null);

  const myRating = ratings.find((r) => r.user_id === currentUserId)?.rating ?? null;
  const otherRatings = ratings.filter((r) => r.user_id !== currentUserId);

  const display = hover ?? myRating ?? 0;

  function setRating(stars: number) {
    if (pending) return;
    // Click the same star you already have set → clear.
    if (myRating === stars) {
      start(async () => {
        const result = await clearMyRecipeRatingAction(recipeId);
        if (!result.ok) toast.error(result.error ?? "Failed to clear rating");
        router.refresh();
      });
      return;
    }
    start(async () => {
      const result = await setMyRecipeRatingAction({ recipeId, rating: stars });
      if (!result.ok) toast.error(result.error ?? "Failed to save rating");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Ratings</h3>
        {ratings.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {average(ratings).toFixed(1)} avg · {ratings.length}{" "}
            {ratings.length === 1 ? "rating" : "ratings"}
          </span>
        ) : null}
      </div>

      {currentUserId ? (
        <div className="flex items-center gap-3 pb-3">
          <span className="text-sm text-muted-foreground">Your rating</span>
          <div
            className="flex items-center gap-0.5"
            onMouseLeave={() => setHover(null)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHover(n)}
                onClick={() => setRating(n)}
                disabled={pending}
                className={cn(
                  "rounded p-0.5 transition-transform hover:scale-110",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                aria-label={`Rate ${n} ${n === 1 ? "star" : "stars"}`}
              >
                <Star
                  className={cn(
                    "h-5 w-5 transition-colors",
                    n <= display
                      ? "fill-amber-500 text-amber-500"
                      : "text-muted-foreground/40",
                  )}
                />
              </button>
            ))}
          </div>
          {myRating ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRating(myRating)}
              disabled={pending}
              className="ml-auto h-7 text-xs text-muted-foreground"
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {otherRatings.length > 0 ? (
        <div className="space-y-1.5 border-t pt-3">
          {otherRatings.map((r) => (
            <OtherRatingRow key={r.user_id} rating={r} />
          ))}
        </div>
      ) : null}

      {!myRating && otherRatings.length === 0 ? (
        <p className="border-t pt-3 text-xs text-muted-foreground">
          No ratings yet. Be the first to rate this recipe.
        </p>
      ) : null}
    </div>
  );
}

function OtherRatingRow({ rating }: { rating: RecipeRating }) {
  const profile = rating.user;
  const name = profile?.display_name ?? profile?.email ?? "Member";
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <Avatar className="h-6 w-6">
        {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt={name} /> : null}
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>
      <span className="truncate text-sm">{name}</span>
      <div className="ml-auto flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={cn(
              "h-3.5 w-3.5",
              n <= rating.rating ? "fill-amber-500 text-amber-500" : "text-muted-foreground/30",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function average(ratings: RecipeRating[]): number {
  if (ratings.length === 0) return 0;
  return ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
}
