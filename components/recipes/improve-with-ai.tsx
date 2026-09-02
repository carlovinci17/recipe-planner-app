"use client";

import { useState, useTransition } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  improveRecipeAction,
  type RecipeSuggestions,
} from "@/app/(app)/recipes/[id]/review/actions";

/**
 * "Improve with AI" — reads the draft currently in the form, asks the model to
 * classify it and fill the blanks, and shows the result for the user to accept
 * or dismiss (propose → confirm → execute, per ADR-0010).
 *
 * Nothing is written here. Accepting only updates the form's own state; the
 * user still presses Save.
 */

export type ImproveDraftInput = {
  recipeId: string;
  title: string;
  description: string | null;
  servings: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  ingredients: string[];
  instructions: string[];
};

/** Only the fields the form needs to merge in when the user accepts. */
export type AppliedSuggestions = {
  mealTypes: string[];
  cuisines: string[];
  dietTypes: string[];
  cookingMethods: string[];
  occasions: string[];
  difficulty: "easy" | "medium" | "hard" | null;
  tags: string[];
  description: string | null;
  servings: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
};

function ChipRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {values.map((v) => (
        <Badge key={v} variant="secondary" className="text-xs font-normal">
          {v}
        </Badge>
      ))}
    </div>
  );
}

export function ImproveWithAI({
  getDraft,
  onApply,
}: {
  /** Read the live form values at click time — not at render time. */
  getDraft: () => ImproveDraftInput;
  onApply: (s: AppliedSuggestions) => void;
}) {
  const [pending, start] = useTransition();
  const [suggestions, setSuggestions] = useState<RecipeSuggestions | null>(null);

  function run() {
    start(async () => {
      const result = await improveRecipeAction(getDraft());
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSuggestions(result.suggestions);
    });
  }

  function apply() {
    if (!suggestions) return;
    const s = suggestions;
    onApply({
      mealTypes: s.meal_types,
      cuisines: s.cuisines,
      dietTypes: s.diet_types,
      cookingMethods: s.cooking_methods,
      occasions: s.occasions,
      difficulty: (s.difficulty as "easy" | "medium" | "hard" | null) ?? null,
      tags: s.tags,
      description: s.description,
      servings: s.servings,
      prepTimeMin: s.prepTimeMin,
      cookTimeMin: s.cookTimeMin,
    });
    setSuggestions(null);
    toast.success("Suggestions applied — review them, then save.");
  }

  // Which blank fields the model offered to fill. Listed separately from the
  // taxonomy because these change text the user can see in the form above.
  const filled = suggestions
    ? [
        suggestions.description !== null ? "description" : null,
        suggestions.servings !== null ? `serves ${suggestions.servings}` : null,
        suggestions.prepTimeMin !== null ? `${suggestions.prepTimeMin} min prep` : null,
        suggestions.cookTimeMin !== null ? `${suggestions.cookTimeMin} min cook` : null,
      ].filter((v): v is string => v !== null)
    : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={run} disabled={pending}>
          <Sparkles className="mr-1.5 h-4 w-4" />
          {pending ? "Thinking…" : "Improve with AI"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Suggests meal types, tags and anything you&apos;ve left blank. Nothing saves until you do.
        </p>
      </div>

      {suggestions && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Suggestions</p>
              <p className="text-xs text-muted-foreground">
                Applying fills the fields above — you can still edit everything before saving.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSuggestions(null)}
              aria-label="Dismiss suggestions"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-1.5">
            <ChipRow label="Meal" values={suggestions.meal_types} />
            <ChipRow label="Cuisine" values={suggestions.cuisines} />
            <ChipRow label="Diet" values={suggestions.diet_types} />
            <ChipRow label="Method" values={suggestions.cooking_methods} />
            <ChipRow label="Occasion" values={suggestions.occasions} />
            <ChipRow
              label="Difficulty"
              values={suggestions.difficulty ? [suggestions.difficulty] : []}
            />
            <ChipRow label="Tags" values={suggestions.tags} />
            <ChipRow label="Also filling" values={filled} />
          </div>

          {suggestions.description && (
            <p className="rounded-md bg-muted/50 p-2.5 text-sm text-muted-foreground">
              {suggestions.description}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={apply}>
              <Check className="mr-1.5 h-4 w-4" />
              Apply
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSuggestions(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
