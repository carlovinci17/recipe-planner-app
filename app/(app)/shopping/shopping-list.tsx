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

// Human-friendly section labels.
const CATEGORY_LABEL: Record<string, string> = {
  fruit: "Fruit",
  veggies: "Veggies",
  produce: "Produce", // legacy
  herbs: "Herbs",
  protein: "Protein",
  meat: "Meat",
  seafood: "Seafood",
  dairy: "Dairy",
  grains: "Grains",
  baking: "Baking",
  frozen: "Frozen",
  beverage: "Beverages",
  condiment: "Condiments",
  spices: "Spices",
  pantry: "Items found at home",
  other: "Other",
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
      const key = item.category ?? "other";
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
  async function copyList() {
    // Format: one item per line. Skip checked items (they're already in your
    // basket). Group by category in the same order as the on-screen view.
    const lines = items
      .filter((i) => !i.is_checked)
      .sort((a, b) => {
        const ai = CATEGORY_ORDER.indexOf(a.category ?? "other");
        const bi = CATEGORY_ORDER.indexOf(b.category ?? "other");
        if (ai !== bi) return ai - bi;
        return a.position - b.position;
      })
      .map(formatItemLine)
      .filter((s) => s.length > 0);

    if (lines.length === 0) {
      toast.info("Nothing left to copy — all items are checked off.");
      return;
    }

    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(`Copied ${lines.length} ${lines.length === 1 ? "item" : "items"}`);
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
                <div className="text-[10px] text-muted-foreground">
                  {list.length} {list.length === 1 ? "item" : "items"}
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
 * Format a single shopping-list line for clipboard copy. Examples:
 *   "2 cups flour"
 *   "3 eggs"
 *   "Salt"
 *   "1.5 lb ground beef"
 *
 * Quantity is dropped when it's 0/null, units are dropped when missing,
 * trailing whitespace is collapsed.
 */
function formatItemLine(item: Item): string {
  const parts: string[] = [];
  if (item.quantity != null && item.quantity > 0) {
    // Render fractional quantities cleanly (1.5 stays 1.5; 1.0 becomes 1).
    parts.push(Number.isInteger(item.quantity) ? String(item.quantity) : String(item.quantity));
  }
  if (item.unit) parts.push(item.unit);
  if (item.ingredient) parts.push(item.ingredient);
  return parts.join(" ").trim();
}
