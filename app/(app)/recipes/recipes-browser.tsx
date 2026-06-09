"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckSquare, SlidersHorizontal, Star, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { RecipeSearchCombobox } from "@/components/recipes/recipe-search-combobox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RecipeCard } from "@/components/recipes/recipe-card";
import { MultiSelectPopover } from "@/components/recipes/multi-select-popover";
import { cn } from "@/lib/utils";
import type { RecipeListItem } from "@/lib/services/recipe-service";
import { getRecipeSourceName } from "@/lib/recipes/source-name";
import { bulkDeleteRecipesAction, bulkPublishRecipesAction } from "./actions";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "dessert"] as const;
const DIET_TYPES = [
  "vegetarian",
  "vegan",
  "gluten-free",
  "dairy-free",
  "low-carb",
  "keto",
  "paleo",
  "pescatarian",
  "nut-free",
];

type ChipRemoval = {
  kind: "meal" | "diet" | "cuisine" | "tag" | "source" | "fav";
  value?: string;
};

/**
 * Hybrid recipe filter UX.
 *
 * Layout:
 *   [search ............................................... ]
 *   ( All | Breakfast | Lunch | Dinner | Snack | Dessert )       ← segmented (single-select)
 *   [⭐ Favourites]  [Diet ▾]  [Cuisine ▾]  [Tags ▾]              ← popover pills (multi-select)
 *   ┊ active filter chips with × ┊                  [ Clear all ]
 *   [recipe grid]
 *
 * - Text search hits the server (Postgres FTS). Everything else is in-memory
 *   so the chips/popovers feel instant.
 * - Cuisine + Tag option lists are derived from the loaded recipe set, so any
 *   tag the user adds in the editor automatically appears as a filter.
 */
export function RecipesBrowser({
  householdId,
  initialRecipes,
  initialQuery,
  isOwner,
  ratingAggregates = {},
}: {
  householdId: string;
  initialRecipes: RecipeListItem[];
  initialQuery: string;
  isOwner: boolean;
  ratingAggregates?: Record<string, { avg: number; count: number }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [recipes, setRecipes] = useState(initialRecipes);

  // Selection mode (owner-only). When `selectMode` is on, the recipe cards
  // show checkboxes and clicking the card toggles selection instead of
  // navigating. This lets owners curate big imports without clicking into
  // each recipe to delete one at a time.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);
  const [bulkDeleting, startBulkDelete] = useTransition();
  const [bulkPublishing, startBulkPublish] = useTransition();

  // ── Filters — initialised from URL so they survive navigation ──────────
  // State is the source of truth for rendering; URL is kept in sync via
  // window.history.replaceState (no re-render, no server round-trip).
  const sp = (key: string) => searchParams.get(key);
  const [reviewOnly, setReviewOnly] = useState(() => sp("review") === "1");
  const [meal, setMeal] = useState<string | null>(() => sp("meal"));
  const [diets, setDiets] = useState<string[]>(() => sp("diets")?.split(",").filter(Boolean) ?? []);
  const [cuisines, setCuisines] = useState<string[]>(() => sp("cuisines")?.split(",").filter(Boolean) ?? []);
  const [tags, setTags] = useState<string[]>(() => sp("tags")?.split(",").filter(Boolean) ?? []);
  const [sources, setSources] = useState<string[]>(() => sp("sources")?.split(",").filter(Boolean) ?? []);
  const [favOnly, setFavOnly] = useState(() => sp("fav") === "1");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);

  /** Write current filter state to the URL without triggering re-render. */
  function syncUrl(patch: {
    meal?: string | null;
    diets?: string[];
    cuisines?: string[];
    tags?: string[];
    sources?: string[];
    fav?: boolean;
    review?: boolean;
  }) {
    const params = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null | undefined) => {
      if (v) params.set(k, v); else params.delete(k);
    };
    if ("meal" in patch) set("meal", patch.meal ?? null);
    if ("diets" in patch) set("diets", patch.diets?.join(",") || null);
    if ("cuisines" in patch) set("cuisines", patch.cuisines?.join(",") || null);
    if ("tags" in patch) set("tags", patch.tags?.join(",") || null);
    if ("sources" in patch) set("sources", patch.sources?.join(",") || null);
    if ("fav" in patch) set("fav", patch.fav ? "1" : null);
    if ("review" in patch) set("review", patch.review ? "1" : null);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  const reviewCount = useMemo(
    () => recipes.filter((r) => r.status === "needs_review").length,
    [recipes],
  );

  // Option lists derived from the loaded recipes. Sources come from
  // source_url → friendly name (e.g. "https://recipetineats.com/..." →
  // "RecipeTin Eats"). Recipes without a source_url are excluded from the
  // source list.
  const { allCuisines, allTags, allSources } = useMemo(() => {
    const c = new Set<string>();
    const t = new Set<string>();
    const s = new Set<string>();
    for (const r of recipes) {
      r.cuisines.forEach((x) => c.add(x));
      r.tags.forEach((x) => t.add(x));
      const name = getRecipeSourceName(r);
      if (name) s.add(name);
    }
    return {
      allCuisines: Array.from(c).sort(),
      allTags: Array.from(t).sort(),
      allSources: Array.from(s).sort(),
    };
  }, [recipes]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return recipes.filter((r) => {
      // Client-side text filter — mirrors the fuzzy search so pressing Enter
      // shows the same results in the grid immediately without a server round-trip.
      if (q) {
        const haystack = [
          r.title,
          r.description ?? "",
          r.tags.join(" "),
          r.cuisines.join(" "),
          r.meal_types.join(" "),
          r.diet_types.join(" "),
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (reviewOnly && r.status !== "needs_review") return false;
      if (favOnly && !r.is_favorite) return false;
      if (meal && !r.meal_types.includes(meal)) return false;
      // Multi-select uses OR semantics within a category — recipe matches if
      // it has any of the selected diets/cuisines/tags/sources.
      if (diets.length && !diets.some((d) => r.diet_types.includes(d))) return false;
      if (cuisines.length && !cuisines.some((c) => r.cuisines.includes(c))) return false;
      if (tags.length && !tags.some((t) => r.tags.includes(t))) return false;
      if (sources.length) {
        const recipeSource = getRecipeSourceName(r);
        if (!recipeSource || !sources.includes(recipeSource)) return false;
      }
      return true;
    });
  }, [recipes, deferredQuery, reviewOnly, favOnly, meal, diets, cuisines, tags, sources]);

  function commitTextSearch(value: string) {
    // Preserve all active filter params when updating the text query.
    const next = new URLSearchParams(window.location.search);
    if (value.trim()) next.set("q", value.trim()); else next.delete("q");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  function removeChip(c: ChipRemoval) {
    if (c.kind === "fav") { setFavOnly(false); syncUrl({ fav: false }); }
    else if (c.kind === "meal") { setMeal(null); syncUrl({ meal: null }); }
    else if (c.kind === "diet" && c.value) {
      const next = diets.filter((x) => x !== c.value);
      setDiets(next); syncUrl({ diets: next });
    } else if (c.kind === "cuisine" && c.value) {
      const next = cuisines.filter((x) => x !== c.value);
      setCuisines(next); syncUrl({ cuisines: next });
    } else if (c.kind === "tag" && c.value) {
      const next = tags.filter((x) => x !== c.value);
      setTags(next); syncUrl({ tags: next });
    } else if (c.kind === "source" && c.value) {
      const next = sources.filter((x) => x !== c.value);
      setSources(next); syncUrl({ sources: next });
    }
  }

  function clearAll() {
    setMeal(null);
    setDiets([]);
    setCuisines([]);
    setTags([]);
    setSources([]);
    setFavOnly(false);
    setReviewOnly(false);
    syncUrl({ meal: null, diets: [], cuisines: [], tags: [], sources: [], fav: false, review: false });
    setQuery("");
    commitTextSearch("");
  }

  const activeChips: { key: string; label: string; remove: () => void }[] = [];
  if (favOnly)
    activeChips.push({ key: "fav", label: "favourites", remove: () => removeChip({ kind: "fav" }) });
  if (meal)
    activeChips.push({ key: `meal-${meal}`, label: meal, remove: () => removeChip({ kind: "meal" }) });
  for (const d of diets)
    activeChips.push({
      key: `diet-${d}`,
      label: d,
      remove: () => removeChip({ kind: "diet", value: d }),
    });
  for (const c of cuisines)
    activeChips.push({
      key: `cuisine-${c}`,
      label: c,
      remove: () => removeChip({ kind: "cuisine", value: c }),
    });
  for (const t of tags)
    activeChips.push({
      key: `tag-${t}`,
      label: t,
      remove: () => removeChip({ kind: "tag", value: t }),
    });
  for (const s of sources)
    activeChips.push({
      key: `source-${s}`,
      label: s,
      remove: () => removeChip({ kind: "source", value: s }),
    });

  const hasAny = activeChips.length > 0 || deferredQuery.length > 0;

  // ─── Selection helpers (owner-only) ────────────────────────────
  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleSelectMode() {
    setSelectMode((on) => {
      if (on) setSelectedIds(new Set());
      return !on;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function performBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    startBulkDelete(async () => {
      const result = await bulkDeleteRecipesAction({ householdId, recipeIds: ids });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't delete");
        return;
      }
      // Optimistic-ish: remove rows whose ids we tried to delete from the
      // visible list. RLS may have skipped rows the caller didn't own; for
      // those, the next page load will resurrect them — uncommon enough to
      // not worry about here.
      setRecipes((prev) => prev.filter((r) => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
      setConfirmBulkDeleteOpen(false);
      setSelectMode(false);
      toast.success(
        `Deleted ${result.deleted} ${result.deleted === 1 ? "recipe" : "recipes"}`,
      );
      // Force a server round-trip so any planner entries that referenced
      // these recipes show their cascade deletion.
      router.refresh();
    });
  }

  function performBulkPublish() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    startBulkPublish(async () => {
      const result = await bulkPublishRecipesAction({ recipeIds: ids });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't publish");
        return;
      }
      setRecipes((prev) =>
        prev.map((r) =>
          (result.ids ?? []).includes(r.id) ? { ...r, status: "published" as const } : r,
        ),
      );
      setSelectedIds(new Set());
      setSelectMode(false);
      toast.success(`Published ${result.published} ${result.published === 1 ? "recipe" : "recipes"}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <RecipeSearchCombobox
        recipes={recipes}
        initialQuery={query}
        onSearch={(val) => {
          setQuery(val);
          commitTextSearch(val);
        }}
      />

      {/* ── Mobile: Filters button → bottom sheet ── */}
      <div className="flex items-center gap-2 sm:hidden">
        {reviewCount > 0 && (
          <button
            type="button"
            onClick={() => { const n = !reviewOnly; setReviewOnly(n); syncUrl({ review: n }); }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              reviewOnly
                ? "border-amber-400 bg-amber-50 text-amber-800"
                : "border-amber-300 bg-amber-50/60 text-amber-700",
            )}
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-white">
              {reviewCount}
            </span>
            Review
          </button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          onClick={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeChips.length > 0 && (
            <Badge variant="default" className="h-4 min-w-4 px-1 text-[10px]">
              {activeChips.length}
            </Badge>
          )}
        </Button>
        {activeChips.length > 0 && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={clearAll}>
            Clear all
          </Button>
        )}
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] rounded-t-2xl p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">Filters</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 overflow-y-auto p-4 pb-8">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Meal type</p>
              <SegmentedControl value={meal} options={MEAL_TYPES as readonly string[]} onChange={(v) => { setMeal(v); syncUrl({ meal: v }); }} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">More filters</p>
              <div className="flex flex-wrap gap-2">
                <Button variant={favOnly ? "default" : "outline"} size="sm" className="h-8 gap-1.5" onClick={() => { const n = !favOnly; setFavOnly(n); syncUrl({ fav: n }); }}>
                  <Star className={cn("h-3.5 w-3.5", favOnly && "fill-current")} /> Favourites
                </Button>
                <MultiSelectPopover label="Diet" options={DIET_TYPES} selected={diets} onChange={(v) => { setDiets(v); syncUrl({ diets: v }); }} searchPlaceholder="Search diets..." />
                <MultiSelectPopover label="Cuisine" options={allCuisines} selected={cuisines} onChange={(v) => { setCuisines(v); syncUrl({ cuisines: v }); }} emptyMessage={allCuisines.length === 0 ? "No cuisines yet." : "No matches."} searchPlaceholder="Search cuisines..." />
                <MultiSelectPopover label="Tags" options={allTags} selected={tags} onChange={(v) => { setTags(v); syncUrl({ tags: v }); }} emptyMessage={allTags.length === 0 ? "No tags yet." : "No matches."} searchPlaceholder="Search tags..." />
                <MultiSelectPopover label="Source" options={allSources} selected={sources} onChange={(v) => { setSources(v); syncUrl({ sources: v }); }} emptyMessage={allSources.length === 0 ? "No sources yet." : "No matches."} searchPlaceholder="Search sources..." />
              </div>
            </div>
            {activeChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t pt-3">
                <span className="text-xs text-muted-foreground">Active:</span>
                {activeChips.map((chip) => (
                  <Badge key={chip.key} variant="secondary" className="gap-1 pl-2 pr-1 capitalize">
                    <span>{chip.label}</span>
                    <button type="button" onClick={chip.remove} className="rounded-full p-0.5 hover:bg-background/60" aria-label={`Remove ${chip.label}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <Button className="w-full" onClick={() => setFiltersOpen(false)}>
              Show {filtered.length} {filtered.length === 1 ? "recipe" : "recipes"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Desktop: inline filter rows (unchanged) ── */}
      <div className="hidden sm:space-y-4 sm:block">
        {reviewCount > 0 && (
          <button
            type="button"
            onClick={() => { const n = !reviewOnly; setReviewOnly(n); syncUrl({ review: n }); }}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              reviewOnly
                ? "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
                : "border-amber-300 bg-amber-50/60 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-400",
            )}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-white dark:bg-amber-600">
              {reviewCount}
            </span>
            Needs review
            {reviewOnly && <X className="h-3 w-3 opacity-60" />}
          </button>
        )}
        <SegmentedControl value={meal} options={MEAL_TYPES as readonly string[]} onChange={(v) => { setMeal(v); syncUrl({ meal: v }); }} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={favOnly ? "default" : "outline"} size="sm" className="h-8 gap-1.5" onClick={() => { const n = !favOnly; setFavOnly(n); syncUrl({ fav: n }); }}>
            <Star className={cn("h-3.5 w-3.5", favOnly && "fill-current")} /> Favourites
          </Button>
          <MultiSelectPopover label="Diet" options={DIET_TYPES} selected={diets} onChange={(v) => { setDiets(v); syncUrl({ diets: v }); }} searchPlaceholder="Search diets..." />
          <MultiSelectPopover label="Cuisine" options={allCuisines} selected={cuisines} onChange={(v) => { setCuisines(v); syncUrl({ cuisines: v }); }} emptyMessage={allCuisines.length === 0 ? "No cuisines yet — add tags via the recipe editor." : "No matches."} searchPlaceholder="Search cuisines..." />
          <MultiSelectPopover label="Tags" options={allTags} selected={tags} onChange={(v) => { setTags(v); syncUrl({ tags: v }); }} emptyMessage={allTags.length === 0 ? "No tags yet — add tags via the recipe editor." : "No matches."} searchPlaceholder="Search tags..." />
          <MultiSelectPopover label="Source" options={allSources} selected={sources} onChange={(v) => { setSources(v); syncUrl({ sources: v }); }} emptyMessage={allSources.length === 0 ? "No sources yet — import a recipe from a URL to populate this." : "No matches."} searchPlaceholder="Search sources..." />
        </div>
        {hasAny ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            <span className="text-xs text-muted-foreground">Active:</span>
            {activeChips.map((chip) => (
              <Badge key={chip.key} variant="secondary" className="gap-1 pl-2 pr-1 capitalize">
                <span>{chip.label}</span>
                <button type="button" onClick={chip.remove} className="rounded-full p-0.5 hover:bg-background/60" aria-label={`Remove ${chip.label}`}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        ) : null}
      </div>

      {/* Owner-only selection toolbar. Sits between filters and grid so the
          user can select while still narrowing the visible set. */}
      {isOwner ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="text-xs text-muted-foreground">
            {filtered.length} of {recipes.length}{" "}
            {recipes.length === 1 ? "recipe" : "recipes"}
            {selectMode && selectedIds.size > 0 ? (
              <span className="ml-2 font-medium text-foreground">
                · {selectedIds.size} selected
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={allVisibleSelected ? clearSelection : selectAllVisible}
                  disabled={visibleIds.length === 0}
                >
                  <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
                  {allVisibleSelected ? "Clear all" : `Select all (${visibleIds.length})`}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={performBulkPublish}
                  disabled={selectedIds.size === 0 || bulkPublishing || bulkDeleting}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Publish {selectedIds.size > 0 ? `${selectedIds.size} ` : ""}selected
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmBulkDeleteOpen(true)}
                  disabled={selectedIds.size === 0 || bulkDeleting || bulkPublishing}
                  className="text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete {selectedIds.size > 0 ? `${selectedIds.size} ` : ""}selected
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={toggleSelectMode}
                  disabled={bulkDeleting}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={toggleSelectMode}>
                <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
                Select
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {filtered.length} of {recipes.length}{" "}
          {recipes.length === 1 ? "recipe" : "recipes"}
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <div className="font-medium">No matching recipes</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Try clearing filters, or import your first recipe.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((r) => (
            <SelectableRecipeCard
              key={r.id}
              recipe={r}
              rating={ratingAggregates[r.id]}
              selectMode={selectMode}
              selected={selectedIds.has(r.id)}
              onToggleSelect={() => toggleSelected(r.id)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={confirmBulkDeleteOpen}
        onOpenChange={(open) => !bulkDeleting && setConfirmBulkDeleteOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selectedIds.size} {selectedIds.size === 1 ? "recipe" : "recipes"}?
            </DialogTitle>
            <DialogDescription>
              This permanently removes the selected{" "}
              {selectedIds.size === 1 ? "recipe" : "recipes"} from your household.
              Planner entries and ratings tied to{" "}
              {selectedIds.size === 1 ? "it" : "them"} will be removed too. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmBulkDeleteOpen(false)}
              disabled={bulkDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={performBulkDelete}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting
                ? "Deleting..."
                : `Delete ${selectedIds.size} ${selectedIds.size === 1 ? "recipe" : "recipes"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * RecipeCard wrapper that adds a selection-mode overlay. When `selectMode`
 * is on, the wrapper covers the underlying <Link> with a button that
 * toggles selection instead of navigating, and renders a checkbox in the
 * top-left corner. When off, the original card behaves normally.
 */
function SelectableRecipeCard({
  recipe,
  rating,
  selectMode,
  selected,
  onToggleSelect,
}: {
  recipe: RecipeListItem;
  rating?: { avg: number; count: number };
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <div className={cn("relative", selectMode && selected && "ring-2 ring-primary rounded-xl")}>
      <RecipeCard recipe={recipe} rating={rating} />
      {selectMode ? (
        <button
          type="button"
          onClick={onToggleSelect}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl"
          aria-label={selected ? `Unselect ${recipe.title}` : `Select ${recipe.title}`}
        />
      ) : null}
      {selectMode ? (
        <div className="absolute left-3 top-3 z-20 rounded-md bg-background/90 p-1 shadow-sm backdrop-blur-sm">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label={selected ? `Unselect ${recipe.title}` : `Select ${recipe.title}`}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Segmented control with an "All" option that maps to null. Single-select.
 * Renders as connected pill buttons; horizontally scrollable on narrow screens.
 */
function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: readonly string[];
  onChange: (next: string | null) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="inline-flex rounded-lg border bg-background p-1">
        <SegmentButton active={value === null} onClick={() => onChange(null)}>
          All
        </SegmentButton>
        {options.map((opt) => (
          <SegmentButton key={opt} active={value === opt} onClick={() => onChange(opt)}>
            {opt}
          </SegmentButton>
        ))}
      </div>
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
