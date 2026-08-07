import "server-only";
import { addDays, format, startOfWeek } from "date-fns";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { plannerEntries, recipes } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { runInUserTx } from "./user-tx";
import type { MealSlot } from "@/types/database.types";

export const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

// Column set + mapper shared by getWeek and addEntry — mirrors the PostgREST
// `recipe:recipes(...)` embedded select (a LEFT join; recipe is null for
// custom-title entries) and aliases every column back to snake_case.
const plannerRowColumns = {
  id: plannerEntries.id,
  date: plannerEntries.date,
  slot: plannerEntries.slot,
  position: plannerEntries.position,
  servings: plannerEntries.servings,
  notes: plannerEntries.notes,
  custom_title: plannerEntries.customTitle,
  recipe_id: plannerEntries.recipeId,
  r_id: recipes.id,
  r_title: recipes.title,
  r_cover_image_path: recipes.coverImagePath,
  r_image_paths: recipes.imagePaths,
  r_prep_time_min: recipes.prepTimeMin,
  r_cook_time_min: recipes.cookTimeMin,
  r_cover_focal_x: recipes.coverFocalX,
  r_cover_focal_y: recipes.coverFocalY,
} as const;

type PlannerJoinRow = {
  id: string;
  date: string;
  slot: MealSlot;
  position: number;
  servings: number | null;
  notes: string | null;
  custom_title: string | null;
  recipe_id: string | null;
  r_id: string | null;
  r_title: string | null;
  r_cover_image_path: string | null;
  r_image_paths: string[] | null;
  r_prep_time_min: number | null;
  r_cook_time_min: number | null;
  r_cover_focal_x: number | null;
  r_cover_focal_y: number | null;
};

function mapPlannerRow(row: PlannerJoinRow) {
  return {
    id: row.id,
    date: row.date,
    slot: row.slot,
    position: row.position,
    servings: row.servings,
    notes: row.notes,
    custom_title: row.custom_title,
    recipe_id: row.recipe_id,
    recipe: row.r_id
      ? {
          id: row.r_id,
          title: row.r_title,
          cover_image_path: row.r_cover_image_path,
          image_paths: row.r_image_paths,
          prep_time_min: row.r_prep_time_min,
          cook_time_min: row.r_cook_time_min,
          cover_focal_x: row.r_cover_focal_x,
          cover_focal_y: row.r_cover_focal_y,
        }
      : null,
  };
}

export type PlannerWeekEntry = ReturnType<typeof mapPlannerRow>;

export const plannerService = {
  weekDates(weekStart: Date): string[] {
    const start = startOfWeek(weekStart, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)));
  },

  async getWeek(args: {
    householdId: string;
    weekStart: Date;
  }): Promise<{ dates: string[]; entries: PlannerWeekEntry[] }> {
    const dates = this.weekDates(args.weekStart);

    if (env.DATABASE_URL) {
      const entries = await runInUserTx(async (tx) => {
        const rows = await tx
          .select(plannerRowColumns)
          .from(plannerEntries)
          .leftJoin(recipes, eq(recipes.id, plannerEntries.recipeId))
          .where(and(eq(plannerEntries.householdId, args.householdId), inArray(plannerEntries.date, dates)))
          .orderBy(asc(plannerEntries.date), asc(plannerEntries.slot), asc(plannerEntries.position));
        return rows.map(mapPlannerRow);
      });
      return { dates, entries };
    }

    const supabase = await createSupabaseServerClient();
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
    // Embedded recipe:recipes(...) isn't statically typed (no declared FK
    // Relationships in the hand-authored Database type); runtime shape matches.
    return { dates, entries: (data ?? []) as unknown as PlannerWeekEntry[] };
  },

  async addEntry(args: {
    householdId: string;
    date: string;
    slot: MealSlot;
    recipeId?: string | null;
    customTitle?: string | null;
    servings?: number | null;
    notes?: string | null;
  }): Promise<PlannerWeekEntry> {
    if (env.DATABASE_URL) {
      return runInUserTx(async (tx, userId) => {
        const posRows = await tx
          .select({ position: plannerEntries.position })
          .from(plannerEntries)
          .where(
            and(
              eq(plannerEntries.householdId, args.householdId),
              eq(plannerEntries.date, args.date),
              eq(plannerEntries.slot, args.slot),
            ),
          )
          .orderBy(desc(plannerEntries.position))
          .limit(1);
        const nextPos = (posRows[0]?.position ?? -1) + 1;

        const inserted = await tx
          .insert(plannerEntries)
          .values({
            householdId: args.householdId,
            date: args.date,
            slot: args.slot,
            recipeId: args.recipeId ?? null,
            customTitle: args.customTitle ?? null,
            servings: args.servings ?? null,
            notes: args.notes ?? null,
            position: nextPos,
            createdBy: userId,
          })
          .returning({ id: plannerEntries.id });
        const newId = inserted[0]?.id;
        if (!newId) throw new Error("Insert failed");

        const rows = await tx
          .select(plannerRowColumns)
          .from(plannerEntries)
          .leftJoin(recipes, eq(recipes.id, plannerEntries.recipeId))
          .where(eq(plannerEntries.id, newId))
          .limit(1);
        const row = rows[0];
        if (!row) throw new Error("Insert failed");
        return mapPlannerRow(row);
      });
    }

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
    // Embedded recipe:recipes(...) isn't statically typed; runtime shape matches.
    return data as unknown as PlannerWeekEntry;
  },

  async moveEntry(args: { entryId: string; date: string; slot: MealSlot; position: number }) {
    if (env.DATABASE_URL) {
      await runInUserTx((tx) =>
        tx
          .update(plannerEntries)
          .set({ date: args.date, slot: args.slot, position: args.position })
          .where(eq(plannerEntries.id, args.entryId)),
      );
      return;
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("planner_entries")
      .update({ date: args.date, slot: args.slot, position: args.position })
      .eq("id", args.entryId);
    if (error) throw error;
  },

  async removeEntry(entryId: string) {
    if (env.DATABASE_URL) {
      await runInUserTx((tx) => tx.delete(plannerEntries).where(eq(plannerEntries.id, entryId)));
      return;
    }
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
    if (env.DATABASE_URL) {
      return runInUserTx(async (tx) => {
        const listRows = (await tx.execute(
          sql`select public.generate_shopping_list_from_planner_range(${args.householdId}, ${isoDate(args.startDate)}, ${args.numDays}) as id`,
        )) as unknown as Array<{ id: string }>;
        const listId = listRows[0]?.id;
        if (!listId) throw new Error("Generation failed");

        const countRows = (await tx.execute(
          sql`select count(*)::int as n from public.shopping_list_items where list_id = ${listId}`,
        )) as unknown as Array<{ n: number }>;
        return { listId, itemCount: countRows[0]?.n ?? 0 };
      });
    }
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
