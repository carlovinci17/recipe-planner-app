"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useMemo,
  useState,
  useTransition,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import type { Tables } from "@/types/database.types";
import { saveReviewAction } from "./actions";
import { deleteRecipeAction } from "../actions";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import { RecipeImageUploader } from "@/components/recipes/recipe-image-uploader";
import { TagEditor } from "@/components/recipes/tag-editor";
import { ImproveWithAI } from "@/components/recipes/improve-with-ai";
import { DeleteRecipeButton } from "../delete-recipe-button";
import { useUnsavedChangesGuard } from "@/lib/recipes/use-unsaved-changes-guard";
import { CoverPicker } from "./cover-picker";
import { clearRecipeCoverAction } from "../actions";

type Recipe = Tables<"recipes">;
type Ingredient = Tables<"recipe_ingredients">;
type Instruction = Tables<"recipe_instructions">;
type Difficulty = "easy" | "medium" | "hard" | null;

/** Mirrors the recipe browser's meal filter so a tagged recipe is findable. */
const MEAL_TYPE_OPTIONS = ["breakfast", "lunch", "dinner", "snack", "dessert"] as const;

/** Nutrition fields (per serving) — keys match the `nutrition` JSON columns. */
const NUTRITION_FIELDS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein_g", label: "Protein", unit: "g" },
  { key: "carbs_g", label: "Carbs", unit: "g" },
  { key: "fat_g", label: "Fat", unit: "g" },
  { key: "fiber_g", label: "Fiber", unit: "g" },
  { key: "sugar_g", label: "Sugar", unit: "g" },
  { key: "sodium_mg", label: "Sodium", unit: "mg" },
] as const;

export function ReviewForm({
  recipe,
  ingredients: initialIngredients,
  instructions: initialInstructions,
  canDelete = false,
  plannerEntryCount = 0,
  sourcePages = [],
  duplicates = [],
}: {
  recipe: Recipe;
  ingredients: Ingredient[];
  instructions: Instruction[];
  canDelete?: boolean;
  plannerEntryCount?: number;
  /** Every source page path from the originating ingestion_jobs row. */
  sourcePages?: string[];
  /** Existing published recipes whose title matches this one. */
  duplicates?: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // "Untitled recipe" is the seed value for fresh manual creates — show it
  // as a placeholder rather than a pre-filled value so the user just types.
  const [title, setTitle] = useState(recipe.title === "Untitled recipe" ? "" : recipe.title);
  const [description, setDescription] = useState(recipe.description ?? "");
  const [servings, setServings] = useState(recipe.servings ?? 0);
  const [prep, setPrep] = useState(recipe.prep_time_min ?? 0);
  const [cook, setCook] = useState(recipe.cook_time_min ?? 0);
  const [tags, setTags] = useState<string[]>(recipe.tags ?? []);
  // Taxonomy. Until now these were only ever written by the AI tagger during
  // import, so a hand-typed recipe had empty meal_types and was invisible to
  // the planner's meal-type filters. Editable here, and fillable in one click
  // via "Improve with AI".
  const [mealTypes, setMealTypes] = useState<string[]>(recipe.meal_types ?? []);
  // Not surfaced as editors (the AI is far better at these than a text box),
  // but carried through so an accepted suggestion survives Save.
  const [difficulty, setDifficulty] = useState<Difficulty>(
    (recipe.difficulty as Difficulty) ?? null,
  );
  const [cuisines, setCuisines] = useState<string[]>(recipe.cuisines ?? []);
  const [dietTypes, setDietTypes] = useState<string[]>(recipe.diet_types ?? []);
  const [cookingMethods, setCookingMethods] = useState<string[]>(recipe.cooking_methods ?? []);
  const [occasions, setOccasions] = useState<string[]>(recipe.occasions ?? []);
  // Nutrition — extracted into the `nutrition` JSON, now visible + editable.
  const seedNutrition = (recipe.nutrition ?? {}) as Record<string, number | null>;
  const [nutrition, setNutrition] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(NUTRITION_FIELDS.map((f) => [f.key, seedNutrition[f.key] ?? null])),
  );
  // Source attribution — seeded from auto-populated source_name (or the
  // legacy channel_name) and editable to anything. URL is optional and
  // separate; users can credit a cookbook with no URL or a YouTube
  // channel with the video URL.
  const meta = recipe.source_metadata as { channel_name?: string } | null;
  const [sourceName, setSourceName] = useState(
    recipe.source_name ?? meta?.channel_name ?? "",
  );
  const [sourceUrl, setSourceUrl] = useState(recipe.source_url ?? "");
  const [ingredients, setIngredients] = useState(initialIngredients);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [coverCleared, setCoverCleared] = useState(false);
  const [clearingCover, startClearCover] = useTransition();
  // Review form hero is medium-sized; 1200px wide is plenty.
  const cover = useSignedImage(
    coverCleared ? null : recipe.cover_image_path,
    "recipe-uploads",
    { width: 1200, resize: "cover", quality: 80 },
  );

  function patchIngredient(idx: number, patch: Partial<Ingredient>) {
    setIngredients((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function patchInstruction(idx: number, patch: Partial<Instruction>) {
    setInstructions((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  // ────────────────────────────────────────────────────────────
  // Unsaved-changes guard
  // ────────────────────────────────────────────────────────────
  // Snapshot of the form's initial values; we compare against current state
  // to determine "dirty". JSON-stringify is fine for this — sub-millisecond
  // even for ~30 ingredients and not on a hot render path.
  const initialSnapshot = useMemo(
    () =>
      JSON.stringify({
        title: recipe.title === "Untitled recipe" ? "" : recipe.title,
        description: recipe.description ?? "",
        servings: recipe.servings ?? 0,
        prep: recipe.prep_time_min ?? 0,
        cook: recipe.cook_time_min ?? 0,
        sourceName: recipe.source_name ?? meta?.channel_name ?? "",
        sourceUrl: recipe.source_url ?? "",
        tags: recipe.tags ?? [],
        mealTypes: recipe.meal_types ?? [],
        difficulty: recipe.difficulty ?? null,
        cuisines: recipe.cuisines ?? [],
        dietTypes: recipe.diet_types ?? [],
        cookingMethods: recipe.cooking_methods ?? [],
        occasions: recipe.occasions ?? [],
        nutrition: NUTRITION_FIELDS.map((f) => seedNutrition[f.key] ?? null),
        ingredients: initialIngredients.map((i) => ({
          raw_text: i.raw_text,
          quantity: i.quantity,
          unit: i.unit,
          ingredient: i.ingredient,
          notes: i.notes,
          optional: i.optional,
          section: i.section,
        })),
        instructions: initialInstructions.map((s) => ({
          text: s.text,
          duration_min: s.duration_min,
          section: s.section,
        })),
      }),
    [recipe, initialIngredients, initialInstructions],
  );

  const currentSnapshot = JSON.stringify({
    title,
    description,
    servings,
    prep,
    cook,
    sourceName,
    sourceUrl,
    tags,
    mealTypes,
    difficulty,
    cuisines,
    dietTypes,
    cookingMethods,
    occasions,
    nutrition: NUTRITION_FIELDS.map((f) => nutrition[f.key] ?? null),
    ingredients: ingredients.map((i) => ({
      raw_text: i.raw_text,
      quantity: i.quantity,
      unit: i.unit,
      ingredient: i.ingredient,
      notes: i.notes,
      optional: i.optional,
      section: i.section,
    })),
    instructions: instructions.map((s) => ({
      text: s.text,
      duration_min: s.duration_min,
      section: s.section,
    })),
  });

  const isDirty = currentSnapshot !== initialSnapshot;
  // For a freshly-created recipe (status = needs_review, source = manual),
  // the user's first encounter is empty fields — the bar should warn even
  // before they type, so they don't lose the new "Untitled recipe" row to
  // a forgotten browser tab. Detect that case and treat it as dirty.
  const isFreshManual =
    recipe.source_kind === "manual" && recipe.title === "Untitled recipe";
  const guard = useUnsavedChangesGuard({ when: isDirty || isFreshManual });

  // Both save paths (Save, and save-then-navigate from the unsaved-changes
  // dialog) send the identical payload — build it once so the two can't drift.
  function buildSavePayload() {
    return {
      recipeId: recipe.id,
      title: title.trim(),
      description: description.trim() || null,
      servings: servings || null,
      prepTimeMin: prep || null,
      cookTimeMin: cook || null,
      sourceName: sourceName.trim() || null,
      sourceUrl: sourceUrl.trim() || null,
      tags,
      mealTypes,
      cuisines,
      dietTypes,
      cookingMethods,
      occasions,
      difficulty,
      nutrition,
      ingredients: ingredients.map((ing) => ({
        raw_text: ing.raw_text,
        section: ing.section,
        quantity: ing.quantity,
        unit: ing.unit,
        ingredient: ing.ingredient,
        notes: ing.notes,
        optional: ing.optional,
      })),
      instructions: instructions.map((step) => ({
        text: step.text,
        section: step.section,
        duration_min: step.duration_min,
      })),
    };
  }

  /** The live draft sent to "Improve with AI" — plain strings, not row shapes. */
  function buildImproveDraft() {
    return {
      recipeId: recipe.id,
      title: title.trim(),
      description: description.trim() || null,
      servings: servings || null,
      prepTimeMin: prep || null,
      cookTimeMin: cook || null,
      ingredients: ingredients.map((i) => i.raw_text).filter(Boolean),
      instructions: instructions.map((s) => s.text).filter(Boolean),
    };
  }

  // Save the current form state, then run a follow-up callback (used by the
  // unsaved-changes dialog to navigate after a successful save).
  async function saveAndThen(after?: () => void) {
    return new Promise<boolean>((resolve) => {
      start(async () => {
        if (!title.trim()) {
          toast.error("Give your recipe a title before saving.");
          resolve(false);
          return;
        }
        const result = await saveReviewAction(buildSavePayload());
        if (!result.ok) {
          toast.error(result.error ?? "Save failed");
          resolve(false);
          return;
        }
        toast.success("Recipe saved");
        if (after) after();
        resolve(true);
      });
    });
  }

  async function discard() {
    const result = await deleteRecipeAction(recipe.id);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't discard");
      return false;
    }
    toast.success("Discarded");
    return true;
  }

  function save() {
    start(async () => {
      const result = await saveReviewAction(buildSavePayload());
      if (result.ok) {
        toast.success("Recipe saved");
        router.push(`/recipes/${recipe.id}`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Save failed");
      }
    });
  }

  return (
    <>
    {duplicates.length > 0 && (
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-amber-900 dark:text-amber-200 text-sm">
            Possible duplicate — this recipe already exists in your library
          </p>
          <ul className="mt-1 space-y-0.5">
            {duplicates.map((d) => (
              <li key={d.id} className="text-sm text-amber-800 dark:text-amber-300">
                <Link
                  href={`/recipes/${d.id}`}
                  target="_blank"
                  className="underline hover:text-amber-900 dark:hover:text-amber-100"
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            You can save this as a new version, or discard it using the delete button below.
          </p>
        </div>
      </div>
    )}
    <div className="grid gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-lg"
                placeholder="What's this recipe called?"
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Servings">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={servings || ""}
                  onChange={(e) => setServings(Math.max(0, Number(e.target.value) || 0))}
                />
              </Field>
              <Field label="Prep (min)">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={prep || ""}
                  onChange={(e) => setPrep(Math.max(0, Number(e.target.value) || 0))}
                />
              </Field>
              <Field label="Cook (min)">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={cook || ""}
                  onChange={(e) => setCook(Math.max(0, Number(e.target.value) || 0))}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <Field label="Source">
                <Input
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="e.g. RecipeTin Eats, Health with Bec, Grandma's cookbook"
                  maxLength={100}
                />
              </Field>
              <Field label="Source link">
                <Input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://..."
                />
              </Field>
            </div>
            <Field label="Tags">
              <TagEditor value={tags} onChange={setTags} placeholder="weeknight, comfort-food..." />
            </Field>

            <Field label="Meal type">
              <div className="flex flex-wrap gap-1.5">
                {MEAL_TYPE_OPTIONS.map((m) => {
                  const on = mealTypes.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setMealTypes((prev) => (on ? prev.filter((v) => v !== m) : [...prev, m]))
                      }
                      className={`rounded-full border px-3 py-1 text-sm capitalize transition-colors ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background hover:bg-accent"
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </Field>

            {mealTypes.length === 0 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Without a meal type this recipe won&apos;t show up in the planner&apos;s
                breakfast/lunch/dinner filters. Pick one, or let AI suggest it.
              </p>
            )}

            <Separator />

            <ImproveWithAI
              getDraft={buildImproveDraft}
              onApply={(s) => {
                // Taxonomy is replaced wholesale — it's the AI's job. Tags are
                // merged so anything the user typed by hand survives.
                setMealTypes(s.mealTypes);
                setCuisines(s.cuisines);
                setDietTypes(s.dietTypes);
                setCookingMethods(s.cookingMethods);
                setOccasions(s.occasions);
                if (s.difficulty) setDifficulty(s.difficulty);
                setTags((prev) => Array.from(new Set([...prev, ...s.tags])));
                // Plain fields: the action only ever returns these for fields
                // left blank, so this can't clobber the user's own words.
                if (s.description) setDescription(s.description);
                if (s.servings) setServings(s.servings);
                if (s.prepTimeMin) setPrep(s.prepTimeMin);
                if (s.cookTimeMin) setCook(s.cookTimeMin);
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-medium">Nutrition <span className="font-normal text-muted-foreground">(per serving)</span></p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {NUTRITION_FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label} (${f.unit})`}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={nutrition[f.key] ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const v = raw === "" ? null : Math.max(0, Number(raw));
                      setNutrition((prev) => ({ ...prev, [f.key]: Number.isNaN(v as number) ? null : v }));
                    }}
                    placeholder="—"
                  />
                </Field>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <SectionTitle
              title="Ingredients"
              onAdd={() =>
                setIngredients((prev) => [
                  ...prev,
                  {
                    id: `tmp-${prev.length}`,
                    recipe_id: recipe.id,
                    position: prev.length,
                    section: null,
                    raw_text: "",
                    quantity: null,
                    unit: null,
                    ingredient: null,
                    notes: null,
                    optional: false,
                    created_at: new Date().toISOString(),
                  } as Ingredient,
                ])
              }
            />
            <Separator />
            <ul className="space-y-2">
              {ingredients.map((ing, idx) => (
                <li key={ing.id} className="flex items-start gap-2">
                  <Input
                    value={ing.raw_text}
                    onChange={(e) => patchIngredient(idx, { raw_text: e.target.value })}
                    placeholder="e.g. 1 cup flour"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setIngredients((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <SectionTitle
              title="Instructions"
              onAdd={() =>
                setInstructions((prev) => [
                  ...prev,
                  {
                    id: `tmp-${prev.length}`,
                    recipe_id: recipe.id,
                    position: prev.length,
                    section: null,
                    text: "",
                    duration_min: null,
                    created_at: new Date().toISOString(),
                  } as Instruction,
                ])
              }
            />
            <Separator />
            <ol className="space-y-3">
              {instructions.map((step, idx) => (
                <li key={step.id} className="flex items-start gap-2">
                  <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-sm">
                    {idx + 1}
                  </span>
                  <Textarea
                    value={step.text}
                    onChange={(e) => patchInstruction(idx, { text: e.target.value })}
                    rows={2}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setInstructions((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Recipe photos</h3>
          <RecipeImageUploader
            recipeId={recipe.id}
            householdId={recipe.household_id}
            initialPaths={recipe.image_paths ?? []}
          />
        </div>

        {sourcePages.length > 0 ? (
          <CoverPicker
            recipeId={recipe.id}
            currentCoverPath={recipe.cover_image_path}
            sourcePages={sourcePages}
            hasUserUploads={(recipe.image_paths ?? []).length > 0}
            initialFocalX={recipe.cover_focal_x}
            initialFocalY={recipe.cover_focal_y}
          />
        ) : recipe.cover_image_path && !coverCleared ? (
          // Single-image / URL imports: show cover with option to clear it.
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="flex items-center justify-between p-3">
              <span className="text-sm font-medium">Cover image</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                disabled={clearingCover}
                onClick={() =>
                  startClearCover(async () => {
                    const result = await clearRecipeCoverAction(recipe.id);
                    if (result.ok) {
                      setCoverCleared(true);
                      toast.success("Cover removed");
                    } else {
                      toast.error(result.error ?? "Couldn't remove cover");
                    }
                  })
                }
              >
                <X className="mr-1 h-3 w-3" />
                Remove
              </Button>
            </div>
            {cover && (
              <div className="bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover} alt="Cover" className="h-auto w-full" />
              </div>
            )}
          </div>
        ) : null}

        <div className="rounded-xl border bg-card p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">AI confidence</span>
            <Badge variant="secondary">
              {recipe.ai_confidence ? Math.round(recipe.ai_confidence * 100) : "—"}%
            </Badge>
          </div>
          {recipe.ai_model ? (
            <p className="mt-1 text-xs text-muted-foreground">Model: {recipe.ai_model}</p>
          ) : null}
        </div>
      </aside>
    </div>

    {/*
      Sticky action bar. Stays in view as the user scrolls a long form,
      so Save/Delete are always one click away. Backdrop blur softens the
      visual weight without obscuring content underneath. The page already
      has `pb-24` on the grid above so the last form content isn't hidden.
      On mobile, the bar floats above the bottom nav (z-40 sits below the
      mobile nav's z-30 — wait, equal — but the bottom nav is fixed too;
      we use `bottom-14 md:bottom-0` to clear the mobile nav.)
    */}
    <div className="pointer-events-none sticky bottom-14 z-30 -mx-4 mt-6 md:bottom-0 md:-mx-6">
      <div className="pointer-events-auto border-t bg-background/85 px-4 py-3 backdrop-blur-md md:px-6">
        <div className="container mx-auto flex max-w-5xl items-center justify-between gap-2">
          {canDelete ? (
            <DeleteRecipeButton
              recipeId={recipe.id}
              recipeTitle={recipe.title}
              plannerEntryCount={plannerEntryCount}
            />
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={pending} size="lg" className="min-w-32">
            {pending ? "Saving..." : "Save recipe"}
          </Button>
        </div>
      </div>
    </div>

    {/*
      Unsaved-changes dialog. Triggered by useUnsavedChangesGuard when the
      user clicks an in-app link with dirty state. Save / Discard / Cancel.
    */}
    <Dialog open={guard.pending !== null} onOpenChange={(open) => !open && guard.cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this recipe?</DialogTitle>
          <DialogDescription>
            You have unsaved changes. Save them to your library, discard the recipe, or stay
            and keep editing.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10"
            onClick={async () => {
              const ok = await discard();
              if (ok) guard.proceed();
            }}
            disabled={pending}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Discard
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={guard.cancel} disabled={pending}>
              Keep editing
            </Button>
            <Button
              onClick={async () => {
                const ok = await saveAndThen();
                if (ok) guard.proceed();
              }}
              disabled={pending}
            >
              {pending ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // Associate the label with its control so the field has an accessible name
  // (screen readers announce it; clicking the label focuses the input; and
  // getByLabel() in tests resolves it). We generate one id and inject it into
  // the single child control rather than duplicating htmlFor/id at every call site.
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
    </div>
  );
}

function SectionTitle({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <Button type="button" size="sm" variant="outline" onClick={onAdd}>
        <Plus className="mr-1 h-4 w-4" /> Add
      </Button>
    </div>
  );
}
