"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
  const [items, setItems] = useState<Item[]>(initialItems);
  const [newName, setNewName] = useState("");
  const [, start] = useTransition();

  useEffect(() => {
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

  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      // Fall back to keyword-based categorisation when the DB has no category.
      const key = item.category ?? categorizeIngredient(item.ingredient ?? "");
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(
      (a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]),
    );
  }, [items]);

  const remaining = items.filter((i) => !i.is_checked).length;

  function toggle(item: Item) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_checked: !i.is_checked } : i)));
    void toggleCheckedAction(item.id, !item.is_checked);
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

  function remove(item: Item) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    void removeItemAction(item.id);
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

  async function copyCategoryItems(category: string, categoryItems: Item[]) {
    const unchecked = categoryItems.filter((i) => !i.is_checked);
    if (unchecked.length === 0) {
      toast.info("All items in this category are already checked off.");
      return;
    }
    const lines = mergeAndFormatItems(unchecked).filter(Boolean);
    const label = CATEGORY_LABEL[category] ?? category;
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
                // Resolve source recipe titles from the household-scoped map.
                // Recipes deleted after the list was generated drop silently.
                const sourceTitles = (item.source_recipe_ids ?? [])
                  .map((id) => sourceRecipeTitles[id])
                  .filter((t): t is string => !!t);
                return (
                  <div
                    key={item.id}
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
                        {item.quantity || item.unit ? (
                          <span className="text-xs text-muted-foreground">
                            {item.quantity ?? ""} {item.unit ?? ""}
                          </span>
                        ) : null}
                      </div>
                      {sourceTitles.length > 0 ? (
                        <div
                          className="mt-0.5 truncate text-[11px] text-muted-foreground"
                          title={sourceTitles.join(", ")}
                        >
                          from{" "}
                          {sourceTitles.length === 1 ? (
                            <span className="italic">{sourceTitles[0]}</span>
                          ) : (
                            <>
                              <span className="italic">{sourceTitles[0]}</span>
                              <span> +{sourceTitles.length - 1} more</span>
                            </>
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
