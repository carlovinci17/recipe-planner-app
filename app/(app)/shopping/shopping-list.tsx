"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useHouseholdRealtime } from "@/lib/realtime/use-household-realtime";
import { Check, CheckSquare, Copy, Plus, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database.types";
import {
  addItemAction,
  clearListAction,
  removeItemAction,
  setAllCheckedAction,
  toggleCheckedAction,
} from "./actions";
import { BuildFromPlannerButton } from "./build-from-planner-button";

type List = Tables<"shopping_lists">;
type Item = Tables<"shopping_list_items">;

// ── Ingredient merging ────────────────────────────────────────────────────────

type MergedShoppingItem = {
  id: string;           // first constituent item's id (used as React key)
  ids: string[];        // all constituent item ids (for toggle/remove)
  ingredient: string;   // display name (first occurrence, title-cased)
  displayQty: string;   // e.g. "4.5 tsp" or "200g"
  quantity: number | null;
  unit: string | null;
  category: string | null;
  is_checked: boolean;  // true only if ALL ids are checked
  source_recipe_ids: string[];
  mealCount: number;    // unique recipe count
  position: number;
};

// Volume conversion: everything → tsp as the base unit.
const TO_TSP: Record<string, number> = {
  tsp: 1, teaspoon: 1, teaspoons: 1,
  tbsp: 3, tablespoon: 3, tablespoons: 3,
  cup: 48, cups: 48,
  ml: 0.2, milliliter: 0.2, milliliters: 0.2, millilitre: 0.2, millilitres: 0.2,
  l: 200, liter: 200, liters: 200, litre: 200, litres: 200,
  "fl oz": 6, "fluid oz": 6,
};
// Weight conversion: everything → g as the base unit.
const TO_G: Record<string, number> = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.59, pound: 453.59, pounds: 453.59,
};

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\.$/, "");
}

function singularize(name: string): string {
  const lower = name.toLowerCase().trim();
  // Basic English plural rules — just enough for common ingredients.
  if (lower.endsWith("ies") && lower.length > 4) return lower.slice(0, -3) + "y"; // berries→berry
  if (lower.endsWith("ves") && lower.length > 4) return lower.slice(0, -3) + "f";  // leaves→leaf
  if (lower.endsWith("ses") || lower.endsWith("xes") || lower.endsWith("zes")) return lower.slice(0, -2);
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 3) return lower.slice(0, -1);
  return lower;
}

function mergeShoppingItems(items: Item[]): MergedShoppingItem[] {
  const groups = new Map<string, Item[]>();

  for (const item of items) {
    const key = singularize(item.ingredient ?? "");
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  return Array.from(groups.values()).map((group) => {
    const first = group[0]!;
    const allIds = group.map((i) => i.id);
    const allChecked = group.every((i) => i.is_checked);
    const allRecipeIds = [...new Set(group.flatMap((i) => i.source_recipe_ids ?? []))];
    const mealCount = allRecipeIds.length;

    // Try to sum quantities with unit conversion.
    let totalTsp = 0, tspCount = 0;
    let totalG = 0, gCount = 0;
    let totalCount = 0, countCount = 0;

    for (const item of group) {
      const qty = item.quantity ?? 0;
      const unit = normalizeUnit(item.unit ?? "");
      if (TO_TSP[unit] !== undefined) { totalTsp += qty * TO_TSP[unit]!; tspCount++; }
      else if (TO_G[unit] !== undefined) { totalG += qty * TO_G[unit]!; gCount++; }
      else { totalCount += qty; countCount++; }
    }

    let displayQty = "";
    let mergedQty: number | null = null;
    let mergedUnit: string | null = null;

    if (tspCount > 0 && gCount === 0 && countCount === 0) {
      // All volume — display in friendliest unit.
      if (totalTsp >= 48) {
        mergedQty = Math.round((totalTsp / 48) * 10) / 10;
        mergedUnit = mergedQty === 1 ? "cup" : "cups";
      } else if (totalTsp >= 3) {
        mergedQty = Math.round((totalTsp / 3) * 10) / 10;
        mergedUnit = mergedQty === 1 ? "tbsp" : "tbsp";
      } else {
        mergedQty = Math.round(totalTsp * 10) / 10;
        mergedUnit = "tsp";
      }
      displayQty = `${mergedQty} ${mergedUnit}`;
    } else if (gCount > 0 && tspCount === 0 && countCount === 0) {
      // All weight.
      if (totalG >= 1000) {
        mergedQty = Math.round((totalG / 1000) * 10) / 10;
        mergedUnit = "kg";
      } else {
        mergedQty = Math.round(totalG * 10) / 10;
        mergedUnit = "g";
      }
      displayQty = `${mergedQty}${mergedUnit}`;
    } else if (countCount > 0 && tspCount === 0 && gCount === 0) {
      // All counts / unitless.
      mergedQty = Math.round(totalCount * 10) / 10;
      mergedUnit = group.find((i) => i.unit)?.unit ?? null;
      displayQty = mergedUnit ? `${mergedQty} ${mergedUnit}` : `${mergedQty}`;
    } else if (group.length === 1) {
      // Single item — show as-is.
      mergedQty = first.quantity;
      mergedUnit = first.unit;
      displayQty = [first.quantity, first.unit].filter(Boolean).join(" ");
    } else {
      // Mixed units — just show comma-separated original quantities.
      displayQty = group
        .map((i) => [i.quantity, i.unit].filter(Boolean).join(" "))
        .filter(Boolean)
        .join(" + ");
    }

    return {
      id: first.id,
      ids: allIds,
      ingredient: first.ingredient ?? "",
      displayQty,
      quantity: mergedQty,
      unit: mergedUnit,
      category: first.category,
      is_checked: allChecked,
      source_recipe_ids: allRecipeIds,
      mealCount,
      position: first.position,
    };
  }).sort((a, b) => a.position - b.position);
}


// Order reflects how a user actually shops:
//   1. Perishables first (fruit, veggies, herbs, proteins, dairy)
//   2. Bulk dry goods (grains, baking)
//   3. Frozen
//   4. Drinks + condiments + spices
//   5. "Pantry — items found at home" pinned LAST so the user scans the
//      stuff-they-need-to-buy stuff first and the maybe-already-have stuff
//      after.
const CATEGORY_ORDER = [
  "fruit",
  "veggies",
  "produce", // legacy bucket — items from before the fruit/veggies split
  "herbs",
  "protein",
  "meat",
  "seafood",
  "dairy",
  "grains",
  "baking",
  "frozen",
  "beverage",
  "condiment",
  "spices",
  "pantry",
  "other",
];

/**
 * Keyword-based ingredient categoriser. Returns the best-matching category
 * from CATEGORY_ORDER. Used as a fallback when the DB item has no category.
 */
const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ["fruit", ["apple","apricot","avocado","banana","berry","berries","blueberr","cherry","date","fig","grape","guava","kiwi","lemon","lime","lychee","mango","melon","nectarine","orange","papaya","passionfruit","peach","pear","pineapple","plum","pomegranate","raspberry","strawberr","watermelon","zest"]],
  ["veggies", ["artichoke","asparagus","bean sprout","beetroot","bok choy","broccoli","brussels","cabbage","capsicum","carrot","cauliflower","celery","corn","courgette","cucumber","eggplant","fennel","garlic","kale","leek","lettuce","mushroom","onion","parsnip","pea","pepper","potato","pumpkin","radish","shallot","silverbeet","spinach","spring onion","squash","sweet potato","tomato","turnip","zucchini"]],
  ["herbs", ["basil","bay leaf","chive","cilantro","coriander","dill","ginger","lemongrass","marjoram","mint","oregano","parsley","rosemary","sage","tarragon","thyme"]],
  ["protein", ["chicken","beef","duck","egg","falafel","lamb","lentil","mince","pork","steak","tempeh","tofu","turkey","veal","venison"]],
  ["seafood", ["anchov","calamari","clam","cod","crab","fish","haddock","lobster","mussel","octopus","oyster","prawn","salmon","sardine","scallop","shrimp","squid","tuna","trout","whitebait"]],
  ["dairy", ["butter","cheese","cream","creme","custard","ghee","kefir","milk","mozzarella","parmesan","ricotta","sour cream","whey","yoghurt","yogurt"]],
  ["grains", ["barley","bread","bulgur","couscous","flour","noodle","oat","pasta","polenta","quinoa","rice","rye","semolina","spelt","tortilla","wrap"]],
  ["baking", ["baking powder","baking soda","bicarbonate","chocolate chip","cocoa","coconut flour","icing sugar","maple syrup","molasses","sugar","vanilla","yeast"]],
  ["beverage", ["beer","broth","coffee","juice","milk","stock","tea","water","wine"]],
  ["condiment", ["hoisin","hot sauce","ketchup","mayo","mayonnaise","mustard","relish","salsa","soy sauce","sriracha","tahini","tamari","teriyaki","worcestershire"]],
  ["spices", ["allspice","anise","cardamom","cayenne","chilli","chili","cinnamon","clove","cumin","curry","fenugreek","nutmeg","paprika","pepper","saffron","salt","star anise","sumac","turmeric","za'atar"]],
  ["pantry", ["coconut cream","coconut milk","honey","lard","miso","oil","olive oil","rice vinegar","sesame oil","sesame seed","sunflower oil","vegetable oil","vinegar"]],
];

function categorizeIngredient(name: string): string {
  const lower = name.toLowerCase();
  for (const [cat, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return cat;
  }
  return "other";
}

// Human-friendly section labels with emoji.
const CATEGORY_LABEL: Record<string, string> = {
  fruit:     "🍎 Fruit",
  veggies:   "🥦 Veggies",
  produce:   "🥬 Produce",
  herbs:     "🌿 Herbs",
  protein:   "🍗 Protein",
  meat:      "🥩 Meat",
  seafood:   "🐟 Seafood",
  dairy:     "🥛 Dairy",
  grains:    "🌾 Grains",
  baking:    "🎂 Baking",
  frozen:    "🧊 Frozen",
  beverage:  "🥤 Beverages",
  condiment: "🧴 Condiments",
  spices:    "🧂 Spices",
  pantry:    "🏠 Items found at home",
  other:     "🛒 Other",
};

// Realtime transport (ADR-0009): dual-run gate. When azure, the Supabase channel
// is skipped and the Web PubSub hook drives updates via router.refresh().
const REALTIME_IS_AZURE = process.env.NEXT_PUBLIC_REALTIME_PROVIDER === "azure";

export function ShoppingList({
  householdId,
  list,
  initialItems,
  sourceRecipeTitles = {},
}: {
  householdId: string;
  list: List;
  initialItems: Item[];
  /** Map of recipe id → title for items that came from a recipe. */
  sourceRecipeTitles?: Record<string, string>;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [newName, setNewName] = useState("");
  const [, start] = useTransition();

  useEffect(() => {
    if (REALTIME_IS_AZURE) return; // azure path uses the Web PubSub hook below
    const supabase = createClient();
    const channel = supabase
      .channel(`shopping-${list.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shopping_list_items", filter: `list_id=eq.${list.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setItems((prev) =>
              prev.find((i) => i.id === (payload.new as Item).id) ? prev : [...prev, payload.new as Item],
            );
          } else if (payload.eventType === "UPDATE") {
            setItems((prev) => prev.map((i) => (i.id === (payload.new as Item).id ? (payload.new as Item) : i)));
          } else if (payload.eventType === "DELETE") {
            setItems((prev) => prev.filter((i) => i.id !== (payload.old as Item).id));
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [list.id]);

  // Azure realtime (ADR-0009): refetch on any shopping change (events carry ids
  // only). router.refresh() re-runs the server component; sync the fresh items in.
  useHouseholdRealtime((e) => {
    if (e.type === "shopping.changed") router.refresh();
  });
  useEffect(() => {
    if (REALTIME_IS_AZURE) setItems(initialItems);
  }, [initialItems]);

  // ── Ingredient merging ───────────────────────────────────────────────────
  // Normalise names (lowercase, singular) so "Lemons", "lemon", "LEMON" all
  // map to the same key. Items with the same key are merged: quantities are
  // summed (with unit conversion for common cooking units) and source recipes
  // are deduplicated.

  const mergedItems = useMemo(() => mergeShoppingItems(items), [items]);

  const grouped = useMemo(() => {
    const map = new Map<string, MergedShoppingItem[]>();
    for (const item of mergedItems) {
      const key = item.category ?? categorizeIngredient(item.ingredient);
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(
      (a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]),
    );
  }, [mergedItems]);

  const remaining = mergedItems.filter((i) => !i.is_checked).length;

  function toggle(item: MergedShoppingItem) {
    const next = !item.is_checked;
    setItems((prev) =>
      prev.map((i) => (item.ids.includes(i.id) ? { ...i, is_checked: next } : i)),
    );
    item.ids.forEach((id) => void toggleCheckedAction(id, next));
  }

  function addItem() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    start(async () => {
      const result = await addItemAction({ listId: list.id, ingredient: name });
      if (!result.ok) toast.error(result.error ?? "Failed to add");
    });
  }

  function remove(item: MergedShoppingItem) {
    setItems((prev) => prev.filter((i) => !item.ids.includes(i.id)));
    item.ids.forEach((id) => void removeItemAction(id));
  }

  // Bulk operations: select all (toggle on/off based on current state) +
  // delete all (with confirmation, since it's destructive).
  const [bulkPending, bulkStart] = useTransition();
  const allChecked = items.length > 0 && items.every((i) => i.is_checked);
  function toggleAllChecked() {
    const nextChecked = !allChecked;
    // Optimistic — realtime will reconcile.
    setItems((prev) => prev.map((i) => ({ ...i, is_checked: nextChecked })));
    bulkStart(async () => {
      const result = await setAllCheckedAction({ listId: list.id, checked: nextChecked });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't update items");
      }
    });
  }

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  function clearAll() {
    bulkStart(async () => {
      const result = await clearListAction({ listId: list.id });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't clear list");
        return;
      }
      setItems([]);
      setConfirmClearOpen(false);
      toast.success(`Cleared ${result.deleted} ${result.deleted === 1 ? "item" : "items"}`);
    });
  }

  const [copied, setCopied] = useState(false);
  const [copiedCategory, setCopiedCategory] = useState<string | null>(null);

  async function copyCategoryItems(category: string, categoryItems: MergedShoppingItem[]) {
    const unchecked = categoryItems.filter((i) => !i.is_checked);
    if (unchecked.length === 0) {
      toast.info("All items in this category are already checked off.");
      return;
    }
    const label = CATEGORY_LABEL[category] ?? category;
    const lines = unchecked.map((i) =>
      i.displayQty ? `${i.ingredient} (${i.displayQty})` : i.ingredient,
    );
    const text = `${label}\n${lines.join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCategory(category);
      setTimeout(() => setCopiedCategory(null), 1500);
      toast.success(`Copied ${lines.length} item${lines.length === 1 ? "" : "s"} from ${label}`);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  async function copyList() {
    // Format: one item per line. Skip checked items (they're already in your
    // basket). Group by category in the same order as the on-screen view.
    const unchecked = items.filter((i) => !i.is_checked);

    if (unchecked.length === 0) {
      toast.info("Nothing left to copy — all items are checked off.");
      return;
    }

    const text = mergeAndGroupForCopy(unchecked);
    const itemCount = new Set(unchecked.map((i) => (i.ingredient ?? "").toLowerCase())).size;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(`Copied ${itemCount} ${itemCount === 1 ? "item" : "items"}`);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  return (
    <div className="container max-w-3xl space-y-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{list.name}</h1>
          <p className="text-sm text-muted-foreground">
            {remaining} of {items.length} items remaining
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={toggleAllChecked}
            disabled={items.length === 0 || bulkPending}
            title={allChecked ? "Uncheck every item" : "Check every item"}
          >
            <CheckSquare className="mr-2 h-4 w-4" />
            {allChecked ? "Uncheck all" : "Select all"}
          </Button>
          <Button variant="outline" onClick={copyList} disabled={items.length === 0}>
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4" /> Copied
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" /> Copy list
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfirmClearOpen(true)}
            disabled={items.length === 0}
            className="text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete all
          </Button>
          <BuildFromPlannerButton householdId={householdId} />
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Add an item..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addItem();
          }}
        />
        <Button onClick={addItem} disabled={!newName.trim()}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>

      <div className="space-y-4">
        {grouped.map(([category, list]) => (
          <Card key={category}>
            <CardContent className="space-y-2 pt-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABEL[category] ?? category}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    {list.length} {list.length === 1 ? "item" : "items"}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyCategoryItems(category, list)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={`Copy ${CATEGORY_LABEL[category] ?? category}`}
                    title={`Copy ${CATEGORY_LABEL[category] ?? category}`}
                  >
                    {copiedCategory === category
                      ? <Check className="h-3.5 w-3.5 text-green-500" />
                      : <Copy className="h-3.5 w-3.5" />
                    }
                  </button>
                </div>
              </div>
              {list.map((item) => {
                const sourceTitles = item.source_recipe_ids
                  .map((id) => sourceRecipeTitles[id])
                  .filter((t): t is string => !!t);
                const uniqueTitles = [...new Set(sourceTitles)];
                return (
                  <div
                    key={item.id}
                    data-testid="shopping-item"
                    className={`flex items-start gap-3 rounded-md px-2 py-2 transition-colors ${
                      item.is_checked ? "opacity-50" : "hover:bg-accent/40"
                    }`}
                  >
                    <Checkbox
                      checked={item.is_checked}
                      onCheckedChange={() => toggle(item)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className={item.is_checked ? "line-through" : ""}>
                          {item.ingredient}
                        </span>
                        {item.displayQty ? (
                          <span className="text-xs text-muted-foreground">{item.displayQty}</span>
                        ) : null}
                      </div>
                      {uniqueTitles.length > 0 ? (
                        <div
                          className="mt-0.5 truncate text-[11px] text-muted-foreground"
                          title={uniqueTitles.join(", ")}
                        >
                          {item.mealCount > 1 ? `for ${item.mealCount} meals` : (
                            <>from <span className="italic">{uniqueTitles[0]}</span></>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      className="mt-1 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={confirmClearOpen} onOpenChange={(open) => !bulkPending && setConfirmClearOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all items?</DialogTitle>
            <DialogDescription>
              This removes all {items.length} {items.length === 1 ? "item" : "items"} from{" "}
              <span className="font-medium">{list.name}</span>. The list itself stays. This can&apos;t
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmClearOpen(false)}
              disabled={bulkPending}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={clearAll}
              disabled={bulkPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkPending ? "Deleting..." : "Delete all"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Format a quantity+unit string. Returns empty string if no quantity.
 * Examples: "2 cups", "3", "1.5 lb"
 */
function formatQty(quantity: number | null | undefined, unit: string | null | undefined): string {
  if (!quantity || quantity <= 0) return "";
  const q = Number.isInteger(quantity) ? String(quantity) : String(quantity);
  return unit ? `${q} ${unit}` : q;
}

/**
 * Format a quantity+unit combination. Returns empty string if no quantity.
 */
function formatQtyUnit(qty: number, unit: string): string {
  const q = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, "");
  return unit === "__none__" ? q : `${q} ${unit}`;
}

/**
 * Merge duplicate ingredients globally, then group by category.
 * Returns a formatted multi-section string with category headers.
 *
 * Format:
 *   Veggies
 *   - Broccoli (2 cups)
 *   - Spinach
 *
 *   Protein
 *   - Chicken breast (500g)
 */
/**
 * Merge duplicates in a list of items and return formatted "Ingredient (qty)" strings.
 * Used for per-category copy.
 */
function mergeAndFormatItems(items: Item[]): string[] {
  const merged = new Map<string, { name: string; units: Map<string, number> }>();
  for (const item of items) {
    const name = (item.ingredient ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!merged.has(key)) merged.set(key, { name, units: new Map() });
    const entry = merged.get(key)!;
    const unit = (item.unit ?? "").trim().toLowerCase() || "__none__";
    entry.units.set(unit, (entry.units.get(unit) ?? 0) + (item.quantity ?? 0));
  }
  return Array.from(merged.values()).map(({ name, units }) => {
    const qtyParts: string[] = [];
    for (const [unit, total] of units) {
      if (total > 0) qtyParts.push(formatQtyUnit(total, unit));
    }
    return qtyParts.length > 0 ? `${name} (${qtyParts.join(", ")})` : name;
  });
}

function mergeAndGroupForCopy(items: Item[]): string {
  // Step 1: merge duplicates globally (by ingredient name, case-insensitive).
  // Keep the "best" category — prefer anything over "other".
  const merged = new Map<string, {
    name: string;
    category: string;
    units: Map<string, number>;
    position: number;
  }>();

  for (const item of items) {
    const name = (item.ingredient ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const cat = item.category ?? categorizeIngredient(name);

    if (!merged.has(key)) {
      merged.set(key, { name, category: cat, units: new Map(), position: item.position });
    } else {
      const existing = merged.get(key)!;
      // Upgrade category if existing is "other" and new one is more specific
      if (existing.category === "other" && cat !== "other") existing.category = cat;
    }
    const entry = merged.get(key)!;
    const unit = (item.unit ?? "").trim().toLowerCase() || "__none__";
    entry.units.set(unit, (entry.units.get(unit) ?? 0) + (item.quantity ?? 0));
  }

  // Step 2: group merged items by category in CATEGORY_ORDER.
  const byCat = new Map<string, Array<{ name: string; units: Map<string, number> }>>();
  for (const cat of CATEGORY_ORDER) byCat.set(cat, []);

  for (const { name, category, units, position: _pos } of merged.values()) {
    const cat = CATEGORY_ORDER.includes(category) ? category : "other";
    byCat.get(cat)!.push({ name, units });
  }

  // Step 3: format sections.
  const sections: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    const catItems = byCat.get(cat)!;
    if (catItems.length === 0) continue;

    const label = CATEGORY_LABEL[cat] ?? cat;
    const lines = catItems.map(({ name, units }) => {
      const qtyParts: string[] = [];
      for (const [unit, total] of units) {
        if (total > 0) qtyParts.push(formatQtyUnit(total, unit));
      }
      const detail = qtyParts.length > 0 ? ` (${qtyParts.join(", ")})` : "";
      return `${name}${detail}`;
    });

    sections.push(`${label}\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}
