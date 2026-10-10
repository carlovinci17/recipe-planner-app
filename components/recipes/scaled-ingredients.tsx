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
  section: string | null;
  raw_text: string;
  quantity: number | null;
  unit: string | null;
  ingredient: string | null;
  notes: string | null;
};

/** Consecutive runs of the same section; a null section joins no heading. */
function groupBySection(items: Ingredient[]) {
  const groups: { section: string | null; items: Ingredient[] }[] = [];
  for (const ing of items) {
    const section = ing.section?.trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.section === section) last.items.push(ing);
    else groups.push({ section, items: [ing] });
  }
  return groups;
}

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
      {/* Grouped by section ("Meat", "Sauce") in list order, so a recipe with
          several ingredient lists reads the way the page printed it. */}
      <div className="space-y-4">
        {groupBySection(ingredients).map((group, gi) => (
          <div key={gi}>
            {group.section ? (
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.section}
              </h3>
            ) : null}
            <ul className="space-y-2 text-sm">
              {group.items.map((ing) => (
                <li key={ing.id} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{scaleIngredientText(ing, scale)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
