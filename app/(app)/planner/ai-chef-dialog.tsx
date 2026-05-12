"use client";

import { useMemo, useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { ChefHat, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelectPopover } from "@/components/recipes/multi-select-popover";
import type { MealSlot } from "@/types/database.types";
import type { RecipeListItem } from "@/lib/services/recipe-service";
import { addEntryAction, planWithAIAction } from "./actions";

const SLOT_OPTIONS: { id: MealSlot; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
];

const TIME_OPTIONS: { value: number | null; label: string }[] = [
  { value: 20, label: "Quick (≤ 20 min)" },
  { value: 45, label: "Medium (≤ 45 min)" },
  { value: 90, label: "Long (≤ 90 min)" },
  { value: null, label: "Any" },
];

type Suggestion = {
  date: string;
  slot: MealSlot;
  recipeId: string;
  reason: string;
  title: string;
};

/**
 * "Ask AI Chef" dialog. Lets the user describe what they want for the week,
 * fires off a single AI call to pick recipes from their library, and shows
 * a preview the user can curate before applying. Apply = create planner_entries
 * for each accepted suggestion (skipping any cell that's been filled in the
 * meantime via realtime).
 */
export function AIChefDialog({
  householdId,
  weekStartIso,
  recipes,
  open,
  onOpenChange,
  onApplied,
}: {
  householdId: string;
  weekStartIso: string;
  recipes: RecipeListItem[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onApplied: () => void;
}) {
  // Form state — preferences the user picks before generating.
  const [slots, setSlots] = useState<MealSlot[]>(["dinner"]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [avoidRepeats, setAvoidRepeats] = useState(true);
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [dietTypes, setDietTypes] = useState<string[]>([]);
  const [maxTimeMin, setMaxTimeMin] = useState<number | null>(null);
  const [freeText, setFreeText] = useState("");

  // Result state — when populated, replaces the form with the preview list.
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [aiNotes, setAiNotes] = useState<string | null>(null);

  const [generating, startGenerate] = useTransition();
  const [applying, startApply] = useTransition();

  // Pull cuisine + diet options from the user's actual library so the
  // multi-select only offers values that exist (no dead choices).
  const cuisineOptions = useMemo(
    () =>
      Array.from(new Set(recipes.flatMap((r) => r.cuisines ?? []).filter(Boolean))).sort(),
    [recipes],
  );
  const dietOptions = useMemo(
    () =>
      Array.from(new Set(recipes.flatMap((r) => r.diet_types ?? []).filter(Boolean))).sort(),
    [recipes],
  );

  function toggleSlot(slot: MealSlot) {
    setSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot],
    );
  }

  function generate() {
    if (slots.length === 0) {
      toast.error("Pick at least one meal slot to plan");
      return;
    }
    startGenerate(async () => {
      const result = await planWithAIAction({
        householdId,
        weekStartIso,
        slots,
        favoritesOnly,
        cuisines,
        dietTypes,
        maxTimeMin,
        avoidRepeats,
        freeText: freeText.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't generate plan");
        return;
      }
      if (result.assignments.length === 0) {
        toast.info("AI didn't find suitable recipes for those slots");
        return;
      }
      setSuggestions(result.assignments);
      setAccepted(new Set(result.assignments.map((a) => `${a.date}|${a.slot}`)));
      setAiNotes(result.notes);
    });
  }

  function applySelected() {
    if (!suggestions) return;
    const picked = suggestions.filter((s) => accepted.has(`${s.date}|${s.slot}`));
    if (picked.length === 0) {
      toast.error("Nothing selected to apply");
      return;
    }
    startApply(async () => {
      // Fire entry inserts in parallel — the realtime channel reconciles
      // duplicates if a sibling user added something concurrently.
      const results = await Promise.all(
        picked.map((s) =>
          addEntryAction({
            householdId,
            date: s.date,
            slot: s.slot,
            recipeId: s.recipeId,
            customTitle: null,
          }),
        ),
      );
      const failed = results.filter((r) => !r.ok).length;
      const success = results.length - failed;
      if (success > 0) {
        toast.success(
          `Added ${success} ${success === 1 ? "meal" : "meals"} to the planner`,
        );
        onApplied();
      }
      if (failed > 0) {
        toast.error(`${failed} ${failed === 1 ? "entry" : "entries"} couldn't be added`);
      }
      reset();
      onOpenChange(false);
    });
  }

  function reset() {
    setSuggestions(null);
    setAccepted(new Set());
    setAiNotes(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function toggleAccepted(key: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedCount = accepted.size;
  const inProgress = generating || applying;

  return (
    <Dialog open={open} onOpenChange={(next) => !inProgress && handleOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChefHat className="h-5 w-5 text-primary" />
            Ask AI Chef
          </DialogTitle>
          <DialogDescription>
            {suggestions
              ? "Review the picks below, deselect any you don't want, then apply to your planner."
              : "Tell me what you're craving and I'll fill the empty slots from your recipe library."}
          </DialogDescription>
        </DialogHeader>

        {!suggestions ? (
          <div className="space-y-5">
            {/* Slots ─────────────────────────────────────────────── */}
            <div className="space-y-2">
              <Label>Which meals to plan</Label>
              <div className="flex flex-wrap gap-2">
                {SLOT_OPTIONS.map((s) => {
                  const active = slots.includes(s.id);
                  return (
                    <Button
                      key={s.id}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      onClick={() => toggleSlot(s.id)}
                    >
                      {s.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Recipe pool ───────────────────────────────────────── */}
            <div className="space-y-2">
              <Label>From which recipes</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={favoritesOnly ? "default" : "outline"}
                  onClick={() => setFavoritesOnly((v) => !v)}
                >
                  ★ Favorites only
                </Button>
                <MultiSelectPopover
                  label="Cuisines"
                  options={cuisineOptions}
                  selected={cuisines}
                  onChange={setCuisines}
                  searchPlaceholder="Search cuisines..."
                />
                <MultiSelectPopover
                  label="Diet"
                  options={dietOptions}
                  selected={dietTypes}
                  onChange={setDietTypes}
                  searchPlaceholder="Search diets..."
                />
              </div>
            </div>

            {/* Time ─────────────────────────────────────────────── */}
            <div className="space-y-2">
              <Label>How much time</Label>
              <div className="flex flex-wrap gap-2">
                {TIME_OPTIONS.map((t) => (
                  <Button
                    key={t.label}
                    type="button"
                    size="sm"
                    variant={maxTimeMin === t.value ? "default" : "outline"}
                    onClick={() => setMaxTimeMin(t.value)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Variety ─────────────────────────────────────────── */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="avoid-repeats"
                checked={avoidRepeats}
                onCheckedChange={(checked) => setAvoidRepeats(checked === true)}
              />
              <Label htmlFor="avoid-repeats" className="font-normal">
                Don&apos;t repeat the same recipe across the week
              </Label>
            </div>

            {/* Free text ────────────────────────────────────────── */}
            <div className="space-y-2">
              <Label htmlFor="ai-chef-note">Anything else? (optional)</Label>
              <Textarea
                id="ai-chef-note"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="e.g. Light meals, kid-friendly, no seafood, summery flavors"
                rows={2}
              />
            </div>
          </div>
        ) : (
          <SuggestionsList
            suggestions={suggestions}
            accepted={accepted}
            aiNotes={aiNotes}
            onToggle={toggleAccepted}
          />
        )}

        <DialogFooter className="gap-2">
          {!suggestions ? (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={inProgress}
              >
                Cancel
              </Button>
              <Button onClick={generate} disabled={inProgress || slots.length === 0}>
                <Sparkles className="mr-2 h-4 w-4" />
                {generating ? "Thinking..." : "Generate plan"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={reset} disabled={applying}>
                Back
              </Button>
              <Button onClick={applySelected} disabled={applying || selectedCount === 0}>
                {applying
                  ? "Adding..."
                  : `Apply ${selectedCount} ${selectedCount === 1 ? "meal" : "meals"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionsList({
  suggestions,
  accepted,
  aiNotes,
  onToggle,
}: {
  suggestions: Suggestion[];
  accepted: Set<string>;
  aiNotes: string | null;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {aiNotes ? (
        <div className="rounded-md border bg-accent/40 px-3 py-2 text-xs text-muted-foreground">
          {aiNotes}
        </div>
      ) : null}
      <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {suggestions.map((s) => {
          const key = `${s.date}|${s.slot}`;
          const isAccepted = accepted.has(key);
          return (
            <li
              key={key}
              className={`flex items-start gap-3 rounded-md border bg-background px-3 py-2 transition-colors ${
                isAccepted ? "" : "opacity-50"
              }`}
            >
              <Checkbox
                checked={isAccepted}
                onCheckedChange={() => onToggle(key)}
                className="mt-1"
                aria-label={`Toggle ${s.title}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {format(parseISO(s.date), "EEE, MMM d")} · {s.slot}
                  </span>
                </div>
                <div className="truncate font-medium">{s.title}</div>
                <div className="text-xs text-muted-foreground">{s.reason}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
