"use client";

import { useState, useTransition } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  improveRecipeAction,
  type RecipeSuggestions,
} from "@/app/(app)/recipes/[id]/review/actions";

/**
 * "Improve with AI" — reads the draft currently in the form, asks the model for
 * a full pass over the recipe, and shows the result section by section for the
 * user to keep or drop (propose → confirm → execute, per ADR-0010).
 *
 * Nothing is written here. Applying only updates the form's own state; the
 * user still presses Save.
 */

export type ImproveDraftInput = {
  recipeId: string;
  title: string;
  description: string | null;
  servings: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  nutrition: Record<string, number | null>;
  mealTypes: string[];
  dietTypes: string[];
  cuisines: string[];
  tags: string[];
  ingredients: string[];
  instructions: string[];
};

/** The suggestion with every section the user unticked set to null. */
export type AppliedSuggestions = {
  classification: Pick<
    RecipeSuggestions,
    | "meal_types"
    | "cuisines"
    | "diet_types"
    | "cooking_methods"
    | "occasions"
    | "difficulty"
    | "tags"
  > | null;
  title: string | null;
  description: string | null;
  details: Pick<RecipeSuggestions, "servings" | "prep_time_min" | "cook_time_min"> | null;
  nutrition: RecipeSuggestions["nutrition"];
  ingredients: RecipeSuggestions["ingredients"];
  instructions: RecipeSuggestions["instructions"];
};

type SectionKey =
  | "classification"
  | "title"
  | "description"
  | "details"
  | "nutrition"
  | "ingredients"
  | "instructions";

const NUTRITION_LABELS: [string, string, string][] = [
  ["calories", "Calories", "kcal"],
  ["protein_g", "Protein", "g"],
  ["carbs_g", "Carbs", "g"],
  ["fat_g", "Fat", "g"],
  ["fiber_g", "Fiber", "g"],
  ["sugar_g", "Sugar", "g"],
  ["sodium_mg", "Sodium", "mg"],
];

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

function Section({
  label,
  checked,
  onCheckedChange,
  children,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
        {label}
      </label>
      <div className={checked ? "" : "opacity-50"}>{children}</div>
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
  const [selected, setSelected] = useState<Record<SectionKey, boolean>>({
    classification: true,
    title: true,
    description: true,
    details: true,
    nutrition: true,
    ingredients: true,
    instructions: true,
  });

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

  const s = suggestions;
  const hasDetails =
    !!s && (s.servings !== null || s.prep_time_min !== null || s.cook_time_min !== null);
  const toggle = (k: SectionKey) => (v: boolean) => setSelected((p) => ({ ...p, [k]: v }));

  function apply() {
    if (!s) return;
    onApply({
      classification: selected.classification
        ? {
            meal_types: s.meal_types,
            cuisines: s.cuisines,
            diet_types: s.diet_types,
            cooking_methods: s.cooking_methods,
            occasions: s.occasions,
            difficulty: s.difficulty,
            tags: s.tags,
          }
        : null,
      title: selected.title ? s.title : null,
      description: selected.description ? s.description : null,
      details:
        selected.details && hasDetails
          ? {
              servings: s.servings,
              prep_time_min: s.prep_time_min,
              cook_time_min: s.cook_time_min,
            }
          : null,
      nutrition: selected.nutrition ? s.nutrition : null,
      ingredients: selected.ingredients ? s.ingredients : null,
      instructions: selected.instructions ? s.instructions : null,
    });
    setSuggestions(null);
    toast.success("Suggestions applied — review them, then save.");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={run} disabled={pending}>
          <Sparkles className="mr-1.5 h-4 w-4" />
          {pending ? "Thinking…" : "Improve with AI"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Reviews the whole recipe — title, tags, nutrition, ingredients and method. Nothing saves
          until you do.
        </p>
      </div>

      {s && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Suggestions</p>
              <p className="text-xs text-muted-foreground">
                Untick anything you don&apos;t want. Applying fills the form — you can still edit
                everything before saving.
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

          {s.changes.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              {s.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}

          <Section
            label="Meal types & tags"
            checked={selected.classification}
            onCheckedChange={toggle("classification")}
          >
            <div className="space-y-1.5">
              <ChipRow label="Meal" values={s.meal_types} />
              <ChipRow label="Cuisine" values={s.cuisines} />
              <ChipRow label="Diet" values={s.diet_types} />
              <ChipRow label="Method" values={s.cooking_methods} />
              <ChipRow label="Occasion" values={s.occasions} />
              <ChipRow label="Difficulty" values={s.difficulty ? [s.difficulty] : []} />
              <ChipRow label="Tags" values={s.tags} />
            </div>
          </Section>

          {s.title && (
            <Section label="Title" checked={selected.title} onCheckedChange={toggle("title")}>
              <p className="text-sm">{s.title}</p>
            </Section>
          )}

          {s.description && (
            <Section
              label="Description"
              checked={selected.description}
              onCheckedChange={toggle("description")}
            >
              <p className="text-sm text-muted-foreground">{s.description}</p>
            </Section>
          )}

          {hasDetails && (
            <Section
              label="Servings & times"
              checked={selected.details}
              onCheckedChange={toggle("details")}
            >
              <ChipRow
                label="Set"
                values={[
                  s.servings !== null ? `serves ${s.servings}` : null,
                  s.prep_time_min !== null ? `${s.prep_time_min} min prep` : null,
                  s.cook_time_min !== null ? `${s.cook_time_min} min cook` : null,
                ].filter((v): v is string => v !== null)}
              />
            </Section>
          )}

          {s.nutrition && (
            <Section
              label="Nutrition (per serving)"
              checked={selected.nutrition}
              onCheckedChange={toggle("nutrition")}
            >
              <ChipRow
                label="Estimate"
                values={NUTRITION_LABELS.flatMap(([key, label, unit]) => {
                  const v = (s.nutrition as Record<string, number | null>)[key];
                  return typeof v === "number" ? [`${label} ${Math.round(v)} ${unit}`] : [];
                })}
              />
            </Section>
          )}

          {s.ingredients && (
            <Section
              label={`Ingredients (${s.ingredients.length})`}
              checked={selected.ingredients}
              onCheckedChange={toggle("ingredients")}
            >
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {s.ingredients.map((ing, i) => (
                  <li key={i}>{ing.raw_text}</li>
                ))}
              </ul>
            </Section>
          )}

          {s.instructions && (
            <Section
              label={`Method (${s.instructions.length} steps)`}
              checked={selected.instructions}
              onCheckedChange={toggle("instructions")}
            >
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {s.instructions.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </Section>
          )}

          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={apply}>
              <Check className="mr-1.5 h-4 w-4" />
              Apply selected
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
