import "server-only";
import { addDays, format, startOfWeek } from "date-fns";
import { sql } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { runInUserTx } from "./user-tx";
import type { MealSlot } from "@/types/database.types";

export const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export const plannerService = {
  weekDates(weekStart: Date): string[] {
    const start = startOfWeek(weekStart, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)));
  },

  async getWeek(args: { householdId: string; weekStart: Date }) {
    const supabase = await createSupabaseServerClient();
    const dates = this.weekDates(args.weekStart);

    const { data, error } = await supabase
      .from("planner_entries")
      .select(
        `id, date, slot, position, servings, notes, custom_title, recipe_id,
         recipe:recipes(id, title, cover_image_path, image_paths, prep_time_min, cook_time_min, cover_focal_x, cover_focal_y)`,
      )
      .eq("household_id", args.householdId)
      .in("date", dates)
      .order("date")
      .order("slot")
      .order("position");

    if (error) throw error;
    return { dates, entries: data ?? [] };
  },

  async addEntry(args: {
    householdId: string;
    date: string;
    slot: MealSlot;
    recipeId?: string | null;
    customTitle?: string | null;
    servings?: number | null;
    notes?: string | null;
  }) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data: existing } = await supabase
      .from("planner_entries")
      .select("position")
      .eq("household_id", args.householdId)
      .eq("date", args.date)
      .eq("slot", args.slot)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos = (existing?.[0]?.position ?? -1) + 1;

    const { data, error } = await supabase
      .from("planner_entries")
      .insert({
        household_id: args.householdId,
        date: args.date,
        slot: args.slot,
        recipe_id: args.recipeId ?? null,
        custom_title: args.customTitle ?? null,
        servings: args.servings ?? null,
        notes: args.notes ?? null,
        position: nextPos,
        created_by: user.id,
      })
      .select(
        `id, date, slot, position, servings, notes, custom_title, recipe_id,
         recipe:recipes(id, title, cover_image_path, image_paths, prep_time_min, cook_time_min, cover_focal_x, cover_focal_y)`,
      )
      .single();
    if (error) throw error;
    return data;
  },

  async moveEntry(args: { entryId: string; date: string; slot: MealSlot; position: number }) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("planner_entries")
      .update({ date: args.date, slot: args.slot, position: args.position })
      .eq("id", args.entryId);
    if (error) throw error;
  },

  async removeEntry(entryId: string) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("planner_entries").delete().eq("id", entryId);
    if (error) throw error;
  },

  async generateShoppingList(args: { householdId: string; weekStart: Date }): Promise<string> {
    const weekStart = isoDate(startOfWeek(args.weekStart, { weekStartsOn: 1 }));
    if (env.DATABASE_URL) {
      return runInUserTx(async (tx) => {
        const rows = (await tx.execute(
          sql`select public.generate_shopping_list_from_planner(${args.householdId}, ${weekStart}) as id`,
        )) as unknown as Array<{ id: string }>;
        const id = rows[0]?.id;
        if (!id) throw new Error("Generation failed");
        return id;
      });
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("generate_shopping_list_from_planner", {
      _household_id: args.householdId,
      _week_start: weekStart,
    });
    if (error || !data) throw error ?? new Error("Generation failed");
    return data;
  },

  /**
   * Build a shopping list from any date range. `numDays` is 1-31.
   * Aggregates ingredients across all recipe-backed planner entries in
   * [startDate, startDate + numDays). Returns the new list id and item count
   * so callers can surface "list is empty because nothing's planned" to the
   * user instead of silently producing a useless list.
   */
  async generateShoppingListRange(args: {
    householdId: string;
    startDate: Date;
    numDays: number;
  }): Promise<{ listId: string; itemCount: number }> {
    const supabase = await createSupabaseServerClient();
    const { data: listId, error } = await supabase.rpc(
      "generate_shopping_list_from_planner_range",
      {
        _household_id: args.householdId,
        _start_date: isoDate(args.startDate),
        _num_days: args.numDays,
      },
    );
    if (error || !listId) throw error ?? new Error("Generation failed");

    const { count } = await supabase
      .from("shopping_list_items")
      .select("id", { count: "exact", head: true })
      .eq("list_id", listId);

    return { listId, itemCount: count ?? 0 };
  },
};
