import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * "Shopping May 12" — short, scannable date label that matches the format
 * the planner-generated lists already use (Postgres `to_char(d, 'Mon DD')`).
 */
function formatDateName(d: Date): string {
  const month = d.toLocaleString("en-US", { month: "short" });
  return `Shopping ${month} ${d.getDate()}`;
}

export const shoppingService = {
  async listLists(householdId: string) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("shopping_lists")
      .select("*")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async getActive(householdId: string) {
    const supabase = await createSupabaseServerClient();
    const { data: list } = await supabase
      .from("shopping_lists")
      .select("*")
      .eq("household_id", householdId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!list) return null;

    const { data: items } = await supabase
      .from("shopping_list_items")
      .select("*")
      .eq("list_id", list.id)
      .order("category")
      .order("position");

    const itemRows = items ?? [];

    // Batch-fetch the source recipe titles so the UI can show "from
    // <Recipe>" badges without N+1 fetches. RLS scopes to household
    // membership; a recipe deleted after the list was generated simply
    // returns nothing and that row gets a "(recipe removed)" fallback.
    const sourceIds = Array.from(
      new Set(
        itemRows.flatMap((it) =>
          Array.isArray(it.source_recipe_ids) ? it.source_recipe_ids : [],
        ),
      ),
    );
    const sourceRecipeTitles: Record<string, string> = {};
    if (sourceIds.length > 0) {
      const { data: recipes } = await supabase
        .from("recipes")
        .select("id, title")
        .in("id", sourceIds);
      for (const r of recipes ?? []) sourceRecipeTitles[r.id] = r.title;
    }

    return { list, items: itemRows, sourceRecipeTitles };
  },

  async createList(args: { householdId: string; name?: string }): Promise<string> {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // Default name is the date so lists are self-describing in the sidebar
    // without users having to type one in. Format mirrors the planner-
    // generated lists (which already use `Mon DD` via Postgres `to_char`),
    // so manual + auto lists sit alongside each other cleanly.
    const defaultName = formatDateName(new Date());

    // Switching active: a new list becomes active and the previous active
    // list flips off. Cheaper than two app-side trips.
    await supabase
      .from("shopping_lists")
      .update({ is_active: false })
      .eq("household_id", args.householdId)
      .eq("is_active", true);

    const { data, error } = await supabase
      .from("shopping_lists")
      .insert({
        household_id: args.householdId,
        name: args.name ?? defaultName,
        created_by: user.id,
        is_active: true,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Failed to create list");
    return data.id;
  },

  /**
   * Switch the active list within a household. Unsets is_active on whatever
   * was previously active and flips it on for the target. RLS scopes both
   * updates to the household membership.
   */
  async setActive(listId: string): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { data: list, error: lookupErr } = await supabase
      .from("shopping_lists")
      .select("household_id")
      .eq("id", listId)
      .single();
    if (lookupErr || !list) throw lookupErr ?? new Error("List not found");
    await supabase
      .from("shopping_lists")
      .update({ is_active: false })
      .eq("household_id", list.household_id)
      .eq("is_active", true);
    const { error } = await supabase
      .from("shopping_lists")
      .update({ is_active: true })
      .eq("id", listId);
    if (error) throw error;
  },

  async renameList(listId: string, name: string): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name can't be empty");
    const { error } = await supabase
      .from("shopping_lists")
      .update({ name: trimmed.slice(0, 100) })
      .eq("id", listId);
    if (error) throw error;
  },

  async deleteList(listId: string): Promise<void> {
    const supabase = await createSupabaseServerClient();
    // Items cascade via FK on shopping_list_items.list_id.
    const { error } = await supabase.from("shopping_lists").delete().eq("id", listId);
    if (error) throw error;
  },

  async addItem(args: {
    listId: string;
    ingredient: string;
    quantity?: number | null;
    unit?: string | null;
    category?: string | null;
  }) {
    const supabase = await createSupabaseServerClient();
    const { data: existing } = await supabase
      .from("shopping_list_items")
      .select("position")
      .eq("list_id", args.listId)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos = (existing?.[0]?.position ?? -1) + 1;

    const { error } = await supabase.from("shopping_list_items").insert({
      list_id: args.listId,
      ingredient: args.ingredient,
      quantity: args.quantity ?? null,
      unit: args.unit ?? null,
      category: args.category ?? null,
      custom: true,
      position: nextPos,
    });
    if (error) throw error;
  },

  async toggleChecked(itemId: string, checked: boolean) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("shopping_list_items")
      .update({ is_checked: checked })
      .eq("id", itemId);
    if (error) throw error;
  },

  /** Bulk-toggle every item in a list. Returns how many rows were affected. */
  async setAllChecked(listId: string, checked: boolean): Promise<number> {
    const supabase = await createSupabaseServerClient();
    const { error, count } = await supabase
      .from("shopping_list_items")
      .update({ is_checked: checked }, { count: "exact" })
      .eq("list_id", listId);
    if (error) throw error;
    return count ?? 0;
  },

  /** Hard-delete every item in a list, keeping the list itself. */
  async clearList(listId: string): Promise<number> {
    const supabase = await createSupabaseServerClient();
    const { error, count } = await supabase
      .from("shopping_list_items")
      .delete({ count: "exact" })
      .eq("list_id", listId);
    if (error) throw error;
    return count ?? 0;
  },

  async updateItem(
    itemId: string,
    patch: Partial<{ ingredient: string; quantity: number | null; unit: string | null; category: string | null }>,
  ) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("shopping_list_items").update(patch).eq("id", itemId);
    if (error) throw error;
  },

  async removeItem(itemId: string) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("shopping_list_items").delete().eq("id", itemId);
    if (error) throw error;
  },
};
