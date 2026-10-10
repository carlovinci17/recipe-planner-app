"use client";

import { useState } from "react";
import { Minus, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_SERVINGS,
  MAX_SERVINGS,
  MIN_SERVINGS,
  scaleIngredientText,
} from "@/lib/recipes/servings";

type Ingredient = {
  id: string;
  raw_text: string;
  quantity: number | null;
  unit: string | null;
  ingredient: string | null;
  notes: string | null;
};

/**
 * Ingredients with a servings stepper. Opens at DEFAULT_SERVINGS and scales
 * every quantified line against the recipe's own yield; a recipe with no
 * recorded yield is assumed to be written for DEFAULT_SERVINGS.
 */
export function ScaledIngredients({
  ingredients,
  recipeServings,
}: {
  ingredients: Ingredient[];
  recipeServings: number | null;
}) {
  const base = recipeServings && recipeServings > 0 ? recipeServings : DEFAULT_SERVINGS;
  const [servings, setServings] = useState(DEFAULT_SERVINGS);
  const scale = servings / base;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Ingredients</h2>
        <div className="flex items-center gap-1" role="group" aria-label="Servings">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setServings((s) => Math.max(MIN_SERVINGS, s - 1))}
            disabled={servings <= MIN_SERVINGS}
            aria-label="Fewer servings"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="flex min-w-[4.5rem] items-center justify-center gap-1 text-sm tabular-nums">
            <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            {servings} {servings === 1 ? "serving" : "servings"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setServings((s) => Math.min(MAX_SERVINGS, s + 1))}
            disabled={servings >= MAX_SERVINGS}
            aria-label="More servings"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {servings !== base ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Scaled from the original {base} {base === 1 ? "serving" : "servings"}.
        </p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {ingredients.map((ing) => (
          <li key={ing.id} className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>{scaleIngredientText(ing, scale)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
