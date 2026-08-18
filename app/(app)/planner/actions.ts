"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { plannerService } from "@/lib/services/planner-service";
import { recipeService } from "@/lib/services/recipe-service";
import { householdService } from "@/lib/services/household-service";
import { ai } from "@/lib/ai";
import { MealPlanSchema } from "@/lib/ai/schemas";
import { MEAL_PLAN_SYSTEM } from "@/lib/ai/prompts";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getActiveHousehold } from "@/lib/services/active-household";
import { publishToHousehold } from "@/lib/realtime/publish";

async function assertMembership(householdId: string) {
  const memberships = await householdService.listForCurrentUser();
  if (!memberships.some((m) => m.household.id === householdId)) {
    throw new Error("Not a member of this household");
  }
}

/**
 * Signal a planner change over realtime (Module 8 / ADR-0009). Best-effort and a
 * no-op unless REALTIME_PROVIDER=azure. When the input carries the household id we
 * use it; otherwise (move/remove operate by entry id) we resolve the active one.
 */
async function notifyPlanner(householdId?: string) {
  const id = householdId ?? (await getActiveHousehold()).id;
  await publishToHousehold(id, { type: "planner.changed" });
}

const AddSchema = z.object({
  householdId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  recipeId: z.string().uuid().nullable(),
  customTitle: z.string().min(1).max(200).nullable(),
});

export async function addEntryAction(input: z.infer<typeof AddSchema>) {
  const parsed = AddSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  if (!parsed.data.recipeId && !parsed.data.customTitle) {
    return { ok: false as const, error: "Need a recipe or a title" };
  }
  try {
    const entry = await plannerService.addEntry(parsed.data);
    revalidatePath("/planner");
    await notifyPlanner(parsed.data.householdId);
    return { ok: true as const, entry };
  } catch (err) {
    logger.error({ err }, "addEntryAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const MoveSchema = z.object({
  entryId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  position: z.number().int().min(0),
});

export async function moveEntryAction(input: z.infer<typeof MoveSchema>) {
  const parsed = MoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await plannerService.moveEntry(parsed.data);
    revalidatePath("/planner");
    await notifyPlanner();
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "moveEntryAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

export async function removeEntryAction(entryId: string) {
  try {
    await plannerService.removeEntry(entryId);
    revalidatePath("/planner");
    await notifyPlanner();
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "removeEntryAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const GenerateSchema = z.object({
  householdId: z.string().uuid(),
  weekStartIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function generateShoppingListAction(input: z.infer<typeof GenerateSchema>) {
  const parsed = GenerateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    const id = await plannerService.generateShoppingList({
      householdId: parsed.data.householdId,
      weekStart: new Date(parsed.data.weekStartIso),
    });
    revalidatePath("/shopping");
    return { ok: true as const, listId: id };
  } catch (err) {
    logger.error({ err }, "generateShoppingListAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const GenerateRangeSchema = z.object({
  householdId: z.string().uuid(),
  startDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  numDays: z.number().int().min(1).max(31),
});

export async function generateShoppingListRangeAction(input: z.infer<typeof GenerateRangeSchema>) {
  const parsed = GenerateRangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    const result = await plannerService.generateShoppingListRange({
      householdId: parsed.data.householdId,
      startDate: new Date(parsed.data.startDateIso),
      numDays: parsed.data.numDays,
    });
    revalidatePath("/shopping");
    return {
      ok: true as const,
      listId: result.listId,
      itemCount: result.itemCount,
    };
  } catch (err) {
    logger.error({ err }, "generateShoppingListRangeAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

// =====================================================================
// AI Chef — auto-fill the planner from preferences
// =====================================================================

const SLOT_VALUES = ["breakfast", "lunch", "dinner", "snack"] as const;

const PlanWithAISchema = z.object({
  householdId: z.string().uuid(),
  weekStartIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slots: z.array(z.enum(SLOT_VALUES)).min(1).max(4),
  favoritesOnly: z.boolean().default(false),
  cuisines: z.array(z.string().min(1).max(40)).max(10).default([]),
  dietTypes: z.array(z.string().min(1).max(40)).max(10).default([]),
  /** Total cook+prep budget in minutes. Null = no time constraint. */
  maxTimeMin: z.number().int().min(5).max(480).nullable().default(null),
  avoidRepeats: z.boolean().default(true),
  freeText: z.string().max(500).nullable().default(null),
});

export type PlanWithAIInput = z.infer<typeof PlanWithAISchema>;

/**
 * Generates a draft meal plan for the given week using the user's recipe
 * library + their stated preferences. Returns assignments for the user to
 * preview and selectively apply — does NOT mutate planner_entries directly,
 * so the user can reject suggestions before they hit the schedule.
 */
export async function planWithAIAction(input: PlanWithAIInput) {
  const parsed = PlanWithAISchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await assertMembership(parsed.data.householdId);

    // Pull a candidate pool the user has access to. We pre-filter on the
    // database side where supported (favorites, cuisines, diets) and finish
    // any non-DB filters (time budget) in JS.
    const recipes = await recipeService.list({
      householdId: parsed.data.householdId,
      filters: {
        favoriteOnly: parsed.data.favoritesOnly,
        cuisines: parsed.data.cuisines.length ? parsed.data.cuisines : undefined,
        dietTypes: parsed.data.dietTypes.length ? parsed.data.dietTypes : undefined,
      },
      limit: 100,
    });

    let pool = recipes;
    if (parsed.data.maxTimeMin != null) {
      const budget = parsed.data.maxTimeMin;
      pool = pool.filter((r) => {
        const total = (r.prep_time_min ?? 0) + (r.cook_time_min ?? 0);
        // Recipes with no time data fall through the filter — better to
        // surface them than discard for missing metadata.
        if (total === 0) return true;
        return total <= budget;
      });
    }

    if (pool.length === 0) {
      return {
        ok: false as const,
        error: "No recipes match those constraints — try loosening the filters.",
      };
    }

    // Find unfilled cells in the visible week. We don't overwrite anything
    // the user has already planned.
    const weekStart = new Date(parsed.data.weekStartIso);
    const week = await plannerService.getWeek({
      householdId: parsed.data.householdId,
      weekStart,
    });

    const taken = new Set(
      (week.entries as Array<{ date: string; slot: string }>).map(
        (e) => `${e.date}|${e.slot}`,
      ),
    );
    const cells: Array<{ date: string; slot: (typeof SLOT_VALUES)[number] }> = [];
    for (const date of week.dates) {
      for (const slot of parsed.data.slots) {
        if (!taken.has(`${date}|${slot}`)) cells.push({ date, slot });
      }
    }

    if (cells.length === 0) {
      return {
        ok: false as const,
        error: "All selected slots in this week are already filled.",
      };
    }

    // Compact the pool down to the fields the model actually needs, both to
    // keep the context window small and to discourage it from guessing about
    // anything not provided.
    const slimPool = pool.slice(0, 60).map((r) => ({
      id: r.id,
      title: r.title,
      meal_types: r.meal_types,
      cuisines: r.cuisines,
      diet_types: r.diet_types,
      tags: r.tags.slice(0, 8),
      prep_min: r.prep_time_min,
      cook_min: r.cook_time_min,
      is_favorite: r.is_favorite,
    }));

    const result = await ai.callStructured({
      schema: MealPlanSchema,
      schemaName: "meal_plan",
      // Haiku 4.5: cheap and quick for this lookup-and-pick task. The pool
      // is constrained, the schema is tight, and the task is essentially
      // matchmaking — Opus would be wasteful.
      model: env.ANTHROPIC_MODEL_FAST,
      maxOutputTokens: 4000,
      messages: [
        { role: "system", content: MEAL_PLAN_SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            cells,
            pool: slimPool,
            constraints: {
              favoritesOnly: parsed.data.favoritesOnly,
              cuisines: parsed.data.cuisines,
              dietTypes: parsed.data.dietTypes,
              maxTimeMin: parsed.data.maxTimeMin,
              avoidRepeats: parsed.data.avoidRepeats,
              note: parsed.data.freeText,
            },
          }),
        },
      ],
    });

    // Defensive: drop any assignment whose recipeId isn't in our pool, or
    // whose (date, slot) isn't a cell we asked about. The model is told not
    // to invent IDs but we don't trust it blindly.
    const poolIds = new Set(pool.map((r) => r.id));
    const cellKeys = new Set(cells.map((c) => `${c.date}|${c.slot}`));
    const valid = result.data.assignments.filter(
      (a) => poolIds.has(a.recipeId) && cellKeys.has(`${a.date}|${a.slot}`),
    );

    // Resolve to titles so the preview can render without another fetch.
    const titlesById = new Map(pool.map((r) => [r.id, r.title]));
    const enriched = valid.map((a) => ({
      ...a,
      title: titlesById.get(a.recipeId) ?? "Recipe",
    }));

    return {
      ok: true as const,
      assignments: enriched,
      notes: result.data.notes,
      poolSize: pool.length,
      cellCount: cells.length,
    };
  } catch (err) {
    logger.error({ err }, "planWithAIAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}
