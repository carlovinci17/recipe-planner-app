import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { recipes, shoppingListItems, shoppingLists } from "@/lib/db/schema";
import { runInUserTx } from "./user-tx";
import type { Tables } from "@/types/database.types";

/**
 * "Shopping May 12" — short, scannable date label that matches the format
 * the planner-generated lists already use (Postgres `to_char(d, 'Mon DD')`).
 */
function formatDateName(d: Date): string {
  const month = d.toLocaleString("en-US", { month: "short" });
  return `Shopping ${month} ${d.getDate()}`;
}

// Snake_case aliases for whole-row reads, so Drizzle results keep the `Tables<>`
// shape (tech-debt #2). Numeric columns come back as strings from postgres.js;
// the `as unknown as Tables<>` cast at the boundary bridges that (same pattern
// as recipe-service).
const shoppingListColumns = {
  id: shoppingLists.id,
  household_id: shoppingLists.householdId,
  name: shoppingLists.name,
  week_start: shoppingLists.weekStart,
  is_active: shoppingLists.isActive,
  created_by: shoppingLists.createdBy,
  created_at: shoppingLists.createdAt,
  updated_at: shoppingLists.updatedAt,
} as const;

const shoppingListItemColumns = {
  id: shoppingListItems.id,
  list_id: shoppingListItems.listId,
  ingredient: shoppingListItems.ingredient,
  quantity: shoppingListItems.quantity,
  unit: shoppingListItems.unit,
  category: shoppingListItems.category,
  source_recipe_ids: shoppingListItems.sourceRecipeIds,
  custom: shoppingListItems.custom,
  is_checked: shoppingListItems.isChecked,
  position: shoppingListItems.position,
  notes: shoppingListItems.notes,
  created_at: shoppingListItems.createdAt,
  updated_at: shoppingListItems.updatedAt,
} as const;

export const shoppingService = {
  async listLists(householdId: string): Promise<Tables<"shopping_lists">[]> {
    return runInUserTx(async (tx) => {
      const rows = await tx
        .select(shoppingListColumns)
        .from(shoppingLists)
        .where(eq(shoppingLists.householdId, householdId))
        .orderBy(desc(shoppingLists.createdAt));
      return rows as unknown as Tables<"shopping_lists">[];
    });
  },

  async getActive(householdId: string): Promise<{
    list: Tables<"shopping_lists">;
    items: Tables<"shopping_list_items">[];
    sourceRecipeTitles: Record<string, string>;
  } | null> {
    return runInUserTx(async (tx) => {
      const [list] = (await tx
        .select(shoppingListColumns)
        .from(shoppingLists)
        .where(and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.isActive, true)))
        .orderBy(desc(shoppingLists.createdAt))
        .limit(1)) as unknown as Tables<"shopping_lists">[];
      if (!list) return null;

      const itemRows = (await tx
        .select(shoppingListItemColumns)
        .from(shoppingListItems)
        .where(eq(shoppingListItems.listId, list.id))
        .orderBy(
          shoppingListItems.category,
          shoppingListItems.position,
        )) as unknown as Tables<"shopping_list_items">[];

      const sourceIds = Array.from(
        new Set(
          itemRows.flatMap((it) =>
            Array.isArray(it.source_recipe_ids) ? it.source_recipe_ids : [],
          ),
        ),
      );
      const sourceRecipeTitles: Record<string, string> = {};
      if (sourceIds.length > 0) {
        const recipeRows = await tx
          .select({ id: recipes.id, title: recipes.title })
          .from(recipes)
          .where(inArray(recipes.id, sourceIds));
        for (const r of recipeRows) sourceRecipeTitles[r.id] = r.title;
      }

      return { list, items: itemRows, sourceRecipeTitles };
    });
  },

  async createList(args: { householdId: string; name?: string }): Promise<string> {
    // Default name is the date so lists are self-describing in the sidebar
    // without users having to type one in. Format mirrors the planner-
    // generated lists (which already use `Mon DD` via Postgres `to_char`),
    // so manual + auto lists sit alongside each other cleanly.
    const defaultName = formatDateName(new Date());

    return runInUserTx(async (tx, userId) => {
      // Switching active: a new list becomes active and the previous active
      // list flips off.
      await tx
        .update(shoppingLists)
        .set({ isActive: false })
        .where(
          and(eq(shoppingLists.householdId, args.householdId), eq(shoppingLists.isActive, true)),
        );
      const [row] = await tx
        .insert(shoppingLists)
        .values({
          householdId: args.householdId,
          name: args.name ?? defaultName,
          createdBy: userId,
          isActive: true,
        })
        .returning({ id: shoppingLists.id });
      if (!row) throw new Error("Failed to create list");
      return row.id;
    });
  },

  /**
   * Switch the active list within a household. Unsets is_active on whatever
   * was previously active and flips it on for the target. RLS scopes both
   * updates to the household membership.
   */
  async setActive(listId: string): Promise<void> {
    await runInUserTx(async (tx) => {
      const [list] = await tx
        .select({ household_id: shoppingLists.householdId })
        .from(shoppingLists)
        .where(eq(shoppingLists.id, listId))
        .limit(1);
      if (!list) throw new Error("List not found");
      await tx
        .update(shoppingLists)
        .set({ isActive: false })
        .where(
          and(eq(shoppingLists.householdId, list.household_id), eq(shoppingLists.isActive, true)),
        );
      await tx.update(shoppingLists).set({ isActive: true }).where(eq(shoppingLists.id, listId));
    });
  },

  async renameList(listId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name can't be empty");
    await runInUserTx((tx) =>
      tx
        .update(shoppingLists)
        .set({ name: trimmed.slice(0, 100) })
        .where(eq(shoppingLists.id, listId)),
    );
  },

  async deleteList(listId: string): Promise<void> {
    // Items cascade via FK on shopping_list_items.list_id.
    await runInUserTx((tx) => tx.delete(shoppingLists).where(eq(shoppingLists.id, listId)));
  },

  async addItem(args: {
    listId: string;
    ingredient: string;
    quantity?: number | null;
    unit?: string | null;
    category?: string | null;
  }) {
    await runInUserTx(async (tx) => {
      const existing = await tx
        .select({ position: shoppingListItems.position })
        .from(shoppingListItems)
        .where(eq(shoppingListItems.listId, args.listId))
        .orderBy(desc(shoppingListItems.position))
        .limit(1);
      const nextPos = (existing[0]?.position ?? -1) + 1;
      await tx.insert(shoppingListItems).values({
        listId: args.listId,
        ingredient: args.ingredient,
        quantity: args.quantity ?? null,
        unit: args.unit ?? null,
        category: args.category ?? null,
        custom: true,
        position: nextPos,
      });
    });
  },

  async toggleChecked(itemId: string, checked: boolean) {
    await runInUserTx((tx) =>
      tx
        .update(shoppingListItems)
        .set({ isChecked: checked })
        .where(eq(shoppingListItems.id, itemId)),
    );
  },

  /** Bulk-toggle every item in a list. Returns how many rows were affected. */
  async setAllChecked(listId: string, checked: boolean): Promise<number> {
    return runInUserTx(async (tx) => {
      const rows = await tx
        .update(shoppingListItems)
        .set({ isChecked: checked })
        .where(eq(shoppingListItems.listId, listId))
        .returning({ id: shoppingListItems.id });
      return rows.length;
    });
  },

  /** Hard-delete every item in a list, keeping the list itself. */
  async clearList(listId: string): Promise<number> {
    return runInUserTx(async (tx) => {
      const rows = await tx
        .delete(shoppingListItems)
        .where(eq(shoppingListItems.listId, listId))
        .returning({ id: shoppingListItems.id });
      return rows.length;
    });
  },

  async updateItem(
    itemId: string,
    patch: Partial<{
      ingredient: string;
      quantity: number | null;
      unit: string | null;
      category: string | null;
    }>,
  ) {
    await runInUserTx((tx) =>
      tx
        .update(shoppingListItems)
        .set({
          ...(patch.ingredient !== undefined ? { ingredient: patch.ingredient } : {}),
          ...(patch.quantity !== undefined ? { quantity: patch.quantity ?? null } : {}),
          ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
          ...(patch.category !== undefined ? { category: patch.category } : {}),
        })
        .where(eq(shoppingListItems.id, itemId)),
    );
  },

  async removeItem(itemId: string) {
    await runInUserTx((tx) => tx.delete(shoppingListItems).where(eq(shoppingListItems.id, itemId)));
  },
};
