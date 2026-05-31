"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChefHat, ChevronLeft, ChevronRight, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { MealSlot, Tables } from "@/types/database.types";
import type { RecipeListItem } from "@/lib/services/recipe-service";
import { coverObjectPositionStyle, resolveCoverImage } from "@/lib/recipes/cover-image";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  addEntryAction,
  generateShoppingListRangeAction,
  moveEntryAction,
  removeEntryAction,
} from "./actions";
import { AIChefDialog } from "./ai-chef-dialog";

const SLOTS: { id: MealSlot; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
];

type EntryWithRecipe = Tables<"planner_entries"> & {
  recipe: {
    id: string;
    title: string;
    cover_image_path: string | null;
    image_paths: string[] | null;
    cover_focal_x: number;
    cover_focal_y: number;
  } | null;
};

/** Nutrition fields the planner aggregates. Subset of recipes.nutrition JSONB. */
type DayMacros = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  /** True if at least one entry contributed any data — drives "show row" gating. */
  hasAny: boolean;
};

const EMPTY_MACROS: DayMacros = {
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
  hasAny: false,
};

/**
 * Roll up a day's macros across its planner entries.
 *
 * Each recipe's `nutrition` is for the whole recipe (yield = recipe.servings).
 * Per-entry portion = (entry.servings ?? recipe.servings) / recipe.servings.
 * Recipes without `servings` or without `nutrition` are skipped — better to
 * undercount than to surface garbage.
 */
function computeDayMacros(
  dayEntries: EntryWithRecipe[],
  recipesById: Map<string, RecipeListItem>,
): DayMacros {
  const totals = { ...EMPTY_MACROS };
  for (const entry of dayEntries) {
    if (!entry.recipe_id) continue;
    const r = recipesById.get(entry.recipe_id);
    if (!r || !r.servings || r.servings <= 0) continue;
    const n = (r.nutrition ?? {}) as Record<string, number | null | undefined>;
    const portion = (entry.servings ?? r.servings) / r.servings;
    if (typeof n.calories === "number") {
      totals.calories += n.calories * portion;
      totals.hasAny = true;
    }
    if (typeof n.protein_g === "number") {
      totals.protein_g += n.protein_g * portion;
      totals.hasAny = true;
    }
    if (typeof n.carbs_g === "number") {
      totals.carbs_g += n.carbs_g * portion;
      totals.hasAny = true;
    }
    if (typeof n.fat_g === "number") {
      totals.fat_g += n.fat_g * portion;
      totals.hasAny = true;
    }
    if (typeof n.fiber_g === "number") {
      totals.fiber_g += n.fiber_g * portion;
      totals.hasAny = true;
    }
  }
  return totals;
}

export function PlannerGrid({
  householdId,
  weekStartIso,
  previousWeekIso,
  nextWeekIso,
  dates,
  initialEntries,
  recipes,
}: {
  householdId: string;
  weekStartIso: string;
  previousWeekIso: string;
  nextWeekIso: string;
  dates: string[];
  initialEntries: unknown[];
  recipes: RecipeListItem[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries as EntryWithRecipe[]);
  const [pickerCell, setPickerCell] = useState<{ date: string; slot: MealSlot } | null>(null);
  const [pending, start] = useTransition();
  const [activeEntry, setActiveEntry] = useState<EntryWithRecipe | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const entry = entries.find((e) => e.id === event.active.id);
    setActiveEntry(entry ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveEntry(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // over.id is `${date}|${slot}` for a cell drop
    const parts = String(over.id).split("|");
    if (parts.length !== 2) return;
    const [newDate, newSlot] = parts as [string, MealSlot];

    const entry = entries.find((e) => e.id === active.id);
    if (!entry) return;
    if (entry.date === newDate && entry.slot === newSlot) return;

    // Optimistic update
    const newPosition = entries.filter((e) => e.date === newDate && e.slot === newSlot).length;
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, date: newDate, slot: newSlot as MealSlot, position: newPosition } : e)),
    );

    start(async () => {
      const result = await moveEntryAction({ entryId: entry.id, date: newDate, slot: newSlot, position: newPosition });
      if (!result.ok) {
        // Revert on failure
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, date: entry.date, slot: entry.slot, position: entry.position } : e)),
        );
        toast.error("Couldn't move meal");
      }
    });
  }

  // Realtime sync
  // Realtime: merge changes directly into local state. Avoid router.refresh()
  // on every event — that causes a full server round-trip and makes the grid
  // feel laggy. Recipe info for new entries is looked up from the `recipes`
  // prop (already in memory), so the thumbnail renders without a fetch.
  useEffect(() => {
    const supabase = createClient();

    function attachRecipe(row: Tables<"planner_entries">): EntryWithRecipe {
      if (!row.recipe_id) return { ...row, recipe: null };
      const r = recipes.find((r) => r.id === row.recipe_id);
      return {
        ...row,
        recipe: r
          ? {
              id: r.id,
              title: r.title,
              cover_image_path: r.cover_image_path,
              image_paths: r.image_paths ?? [],
              cover_focal_x: r.cover_focal_x,
              cover_focal_y: r.cover_focal_y,
            }
          : null,
      };
    }

    const channel = supabase
      .channel(`planner-${householdId}-${weekStartIso}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "planner_entries",
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const next = attachRecipe(payload.new as Tables<"planner_entries">);
            setEntries((prev) => (prev.some((e) => e.id === next.id) ? prev : [...prev, next]));
          } else if (payload.eventType === "UPDATE") {
            const next = attachRecipe(payload.new as Tables<"planner_entries">);
            setEntries((prev) => prev.map((e) => (e.id === next.id ? next : e)));
          } else if (payload.eventType === "DELETE") {
            const id = (payload.old as Tables<"planner_entries">).id;
            setEntries((prev) => prev.filter((e) => e.id !== id));
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, weekStartIso, recipes]);

  const grouped = useMemo(() => {
    const map = new Map<string, EntryWithRecipe[]>();
    for (const entry of entries) {
      const key = `${entry.date}|${entry.slot}`;
      const arr = map.get(key) ?? [];
      arr.push(entry);
      map.set(key, arr);
    }
    return map;
  }, [entries]);

  // Indexed lookup: recipe id → full RecipeListItem (with nutrition + servings).
  // Built once per `recipes` prop change; used by the per-day macro rollup.
  const recipesById = useMemo(
    () => new Map(recipes.map((r) => [r.id, r])),
    [recipes],
  );

  // Per-day totals. Computed eagerly so the totals-row can be hidden when
  // every day is empty (no nutrition data at all).
  const dailyMacros = useMemo(() => {
    return dates.map((d) => {
      const entriesForDay = entries.filter((e) => e.date === d);
      return computeDayMacros(entriesForDay, recipesById);
    });
  }, [dates, entries, recipesById]);

  const showMacrosRow = dailyMacros.some((m) => m.hasAny);

  function handleAdd(recipeId: string | null, customTitle: string | null) {
    if (!pickerCell) return;
    const cell = pickerCell;
    setPickerCell(null);

    start(async () => {
      const result = await addEntryAction({
        householdId,
        date: cell.date,
        slot: cell.slot,
        recipeId,
        customTitle,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Failed to add");
        return;
      }
      // Splice the server-confirmed row into local state immediately. The
      // realtime subscription will also receive this event but our `setEntries`
      // dedupes by id, so it's a no-op.
      // Cast through unknown: PostgREST's embedded-select types are an opaque
      // SelectQueryError generic, but the runtime shape matches EntryWithRecipe.
      const entry = result.entry as unknown as EntryWithRecipe;
      setEntries((prev) => {
        if (prev.some((e) => e.id === entry.id)) return prev;
        return [...prev, entry];
      });
    });
  }

  async function handleRemove(entryId: string) {
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
    const result = await removeEntryAction(entryId);
    if (!result.ok) {
      toast.error("Could not remove entry");
      router.refresh();
    }
  }

  const [aiChefOpen, setAiChefOpen] = useState(false);
  const [shoppingDialogOpen, setShoppingDialogOpen] = useState(false);
  // Don't compute "today" at render time — it'd produce different values on
  // the server vs client and trigger a hydration mismatch. Initialise on
  // first dialog open instead (see openShoppingDialog below).
  const [listStart, setListStart] = useState<string>("");
  const [listDays, setListDays] = useState<number>(7);

  async function generateShopping() {
    const result = await generateShoppingListRangeAction({
      householdId,
      startDateIso: listStart,
      numDays: listDays,
    });
    if (!result.ok) {
      toast.error(result.error ?? "Failed to generate");
      return;
    }
    setShoppingDialogOpen(false);
    if (result.itemCount === 0) {
      // Empty list usually means nothing was planned in the chosen range —
      // tell the user instead of silently navigating to an empty shopping
      // page that looks like the action did nothing.
      toast.warning(
        "No ingredients to add — your planner has no recipes in that date range.",
      );
      return;
    }
    toast.success(
      `Shopping list created with ${result.itemCount} ${
        result.itemCount === 1 ? "item" : "items"
      }`,
    );
    router.push("/shopping");
  }

  return (
    <div className="container space-y-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Weekly planner</h1>
          <p className="text-sm text-muted-foreground">
            Week of {format(parseISO(weekStartIso), "MMM d")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/planner?week=${previousWeekIso}`} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" size="icon" asChild>
            <Link href={`/planner?week=${nextWeekIso}`} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setAiChefOpen(true)}>
            <ChefHat className="mr-2 h-4 w-4" /> Ask AI Chef
          </Button>
          <Button
            onClick={() => {
              if (!listStart) {
                setListStart(new Date().toISOString().slice(0, 10));
              }
              setShoppingDialogOpen(true);
            }}
          >
            <ShoppingBasket className="mr-2 h-4 w-4" /> Build shopping list
          </Button>
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[72px_repeat(7,1fr)] gap-1.5">
          <div />
          {dates.map((d) => (
            <div key={d} className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <div>{format(parseISO(d), "EEE")}</div>
              <div className="font-display text-base font-semibold text-foreground">
                {format(parseISO(d), "d")}
              </div>
            </div>
          ))}

          {SLOTS.map((slot) => (
            <div key={slot.id} className="contents">
              <div className="flex items-start pt-2 text-sm font-medium text-muted-foreground">
                {slot.label}
              </div>
              {dates.map((d) => {
                const cellEntries = grouped.get(`${d}|${slot.id}`) ?? [];
                return (
                  <DroppableCell key={`${d}-${slot.id}`} id={`${d}|${slot.id}`}>
                    {cellEntries.map((entry) => (
                      <DraggableEntry
                        key={entry.id}
                        entry={entry}
                        onRemove={() => handleRemove(entry.id)}
                        isDragging={activeEntry?.id === entry.id}
                      />
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-full justify-start text-muted-foreground"
                      onClick={() => setPickerCell({ date: d, slot: slot.id })}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add
                    </Button>
                  </DroppableCell>
                );
              })}
            </div>
          ))}

          {showMacrosRow ? (
            <div className="contents">
              <div className="flex items-start pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Day total
              </div>
              {dates.map((d, idx) => (
                <DayMacrosCell key={`totals-${d}`} macros={dailyMacros[idx]!} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeEntry ? <PlannerEntryTile entry={activeEntry} isDragOverlay /> : null}
      </DragOverlay>
      </DndContext>

      <AIChefDialog
        householdId={householdId}
        weekStartIso={weekStartIso}
        recipes={recipes}
        open={aiChefOpen}
        onOpenChange={setAiChefOpen}
        // Inserts already flow in via realtime; we don't need to refetch.
        onApplied={() => {}}
      />

      <Dialog open={!!pickerCell} onOpenChange={(open) => !open && setPickerCell(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>Add a meal</DialogTitle>
            <DialogDescription>
              {pickerCell
                ? `${format(parseISO(pickerCell.date), "EEE, MMM d")} · ${pickerCell.slot}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <RecipePicker recipes={recipes} onPick={handleAdd} pending={pending} />
        </DialogContent>
      </Dialog>

      <Dialog
        open={shoppingDialogOpen}
        onOpenChange={(next) => {
          if (next && !listStart) {
            setListStart(new Date().toISOString().slice(0, 10));
          }
          setShoppingDialogOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Build a shopping list</DialogTitle>
            <DialogDescription>
              Aggregates ingredients across all recipes planned in this date range.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Start date</label>
              <Input
                type="date"
                value={listStart}
                onChange={(e) => setListStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Number of days</label>
              <div className="flex flex-wrap gap-2">
                {[1, 3, 5, 7, 14].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant={listDays === n ? "default" : "outline"}
                    onClick={() => setListDays(n)}
                  >
                    {n} {n === 1 ? "day" : "days"}
                  </Button>
                ))}
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={listDays}
                  onChange={(e) =>
                    setListDays(Math.max(1, Math.min(31, Number(e.target.value) || 1)))
                  }
                  className="w-24"
                />
              </div>
            </div>
            {listStart ? (
              <p className="text-xs text-muted-foreground">
                Pulls planner entries from{" "}
                <span className="font-medium">{format(parseISO(listStart), "EEE, MMM d")}</span>{" "}
                through{" "}
                <span className="font-medium">
                  {format(
                    new Date(parseISO(listStart).getTime() + (listDays - 1) * 86400000),
                    "EEE, MMM d",
                  )}
                </span>
                .
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShoppingDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={generateShopping}>
              <ShoppingBasket className="mr-2 h-4 w-4" /> Build list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Drag & Drop wrappers ─────────────────────────────────────────────────────

function DroppableCell({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <Card
      ref={setNodeRef}
      className={cn("min-h-[72px] transition-colors", isOver && "border-primary/60 bg-primary/5")}
    >
      <CardContent className="flex flex-col gap-1 p-1.5">{children}</CardContent>
    </Card>
  );
}

function DraggableEntry({
  entry,
  onRemove,
  isDragging,
}: {
  entry: EntryWithRecipe;
  onRemove: () => void;
  isDragging: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: entry.id });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn("touch-none", isDragging && "opacity-30")}
    >
      <PlannerEntryTile entry={entry} onRemove={onRemove} />
    </div>
  );
}

function PlannerEntry({
  entry,
  onRemove,
}: {
  entry: EntryWithRecipe;
  onRemove: () => void;
}) {
  return <PlannerEntryTile entry={entry} onRemove={onRemove} />;
}

function PlannerEntryTile({
  entry,
  onRemove,
  isDragOverlay,
}: {
  entry: EntryWithRecipe;
  onRemove?: () => void;
  isDragOverlay?: boolean;
}) {
  const title = entry.recipe?.title ?? entry.custom_title ?? "Meal";
  const coverRef = entry.recipe ? resolveCoverImage(entry.recipe) : null;
  // Planner entry: width-only transform (server doesn't crop) so the
  // browser's `object-fit: cover` + `object-position` can apply the
  // recipe's focal point to the 36px-square slot. 128px wide covers
  // retina + the focal-driven crop overhead without extra bytes.
  const cover = useSignedImage(coverRef?.path ?? null, coverRef?.bucket ?? "recipe-uploads", {
    width: 640,
    quality: 75,
  });
  const focalStyle = entry.recipe ? coverObjectPositionStyle(entry.recipe) : undefined;

  const inner = (
    <div className="group relative h-16 w-full overflow-hidden rounded-md border bg-muted">
      {/* Cover image or placeholder */}
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" style={focalStyle} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xl">🍽️</div>
      )}

      {/* Title overlay — truncated by default, full on hover */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1 pt-4">
        <p className="truncate text-[10px] font-medium leading-tight text-white group-hover:whitespace-normal group-hover:overflow-visible">
          {title}
        </p>
      </div>

      {/* Remove button — top-right on hover, hidden during drag overlay */}
      {!isDragOverlay && onRemove && (
        <button
          type="button"
          className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
          aria-label="Remove"
        >
          <Trash2 className="h-3 w-3 text-white" />
        </button>
      )}
    </div>
  );

  const wrapClass = cn("w-full", isDragOverlay && "rotate-1 opacity-90 shadow-lg");

  return entry.recipe && !isDragOverlay ? (
    <Link href={`/recipes/${entry.recipe.id}`} title={title} className={cn("block", wrapClass)}>
      {inner}
    </Link>
  ) : (
    <div title={title} className={wrapClass}>{inner}</div>
  );
}

/**
 * Per-day macro summary card. UX-first redesign:
 *   - Calories as the headline (largest, boldest — what users glance at first)
 *   - Each macro on its own row with: colored dot + plain-language label +
 *     right-aligned grams. Dots let users scan a single nutrient across the
 *     week without re-reading labels.
 *   - Colors loosely map to mental associations (protein/red-meat,
 *     carbs/water, fat/butter, fiber/greens) and are also distinct enough
 *     that the row labels alone work for color-blind viewers.
 *   - Tabular-nums on the value column so grams stack vertically across
 *     days for instant cross-day comparison.
 */
function DayMacrosCell({ macros }: { macros: DayMacros }) {
  if (!macros.hasAny) {
    return (
      <Card className="min-h-[64px] bg-muted/30">
        <CardContent className="flex h-full items-center justify-center p-2 text-[11px] text-muted-foreground">
          —
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="bg-muted/30">
      <CardContent className="space-y-2 p-2.5">
        {/* Headline: calories. Display font, bold, baseline-aligned with a
            small caps "Calories" label so the unit stays explicit without
            stealing visual weight. */}
        <div className="flex items-baseline justify-between gap-1.5 border-b border-border/40 pb-1.5">
          <span className="font-display text-lg font-bold leading-none text-foreground tabular-nums">
            {Math.round(macros.calories).toLocaleString()}
          </span>
          <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            Calories
          </span>
        </div>
        {/* Macro rows. Order is calories-adjacent → most-tracked → fiber.
            Fiber is conditional because import pipelines often miss it and
            an empty fiber row reads as broken data, not as zero fiber. */}
        <div className="space-y-1 text-[11px] leading-none">
          <MacroRow color="rose" label="Protein" grams={macros.protein_g} />
          <MacroRow color="sky" label="Carbs" grams={macros.carbs_g} />
          <MacroRow color="amber" label="Fat" grams={macros.fat_g} />
          {macros.fiber_g > 0 ? (
            <MacroRow color="emerald" label="Fiber" grams={macros.fiber_g} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function MacroRow({
  color,
  label,
  grams,
}: {
  color: "rose" | "sky" | "amber" | "emerald";
  label: string;
  grams: number;
}) {
  // Static class strings (Tailwind JIT scans literal strings — building these
  // dynamically with template literals would silently produce no styles).
  const dotClass = {
    rose: "bg-rose-500",
    sky: "bg-sky-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
  }[color];
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass)} aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium tabular-nums text-foreground">
        {Math.round(grams)}g
      </span>
    </div>
  );
}

function RecipePicker({
  recipes,
  onPick,
  pending,
}: {
  recipes: RecipeListItem[];
  onPick: (recipeId: string | null, customTitle: string | null) => void;
  pending: boolean;
}) {
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const filtered = recipes.filter(
    (r) => !query || r.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <Input
        placeholder="Search your recipes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="shrink-0"
      />
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-md border">
        {filtered.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No recipes match.</div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={pending}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => onPick(r.id, null)}
            >
              <span className="truncate">{r.title}</span>
              {r.meal_types[0] ? (
                <Badge variant="outline" className="ml-2 capitalize">
                  {r.meal_types[0]}
                </Badge>
              ) : null}
            </button>
          ))
        )}
      </div>
      <div className="shrink-0 space-y-1.5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Or quick-add</div>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Leftovers"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <Button
            type="button"
            disabled={!custom.trim() || pending}
            onClick={() => onPick(null, custom.trim())}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
