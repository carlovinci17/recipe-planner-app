import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Sql } from "postgres";
import { embedQuery } from "./embeddings";

/**
 * Kitchen Assistant tools (ADR-0010). Every tool is scoped to one household and
 * given a DB handle by the caller. Reads run free; writes are propose-only here —
 * the app confirms + executes (propose → confirm → execute).
 */
export type ToolDeps = { sql: Sql; householdId: string };

/** Semantic search over the household's own recipes (the finder's core). */
export function recipeSearchTool(deps: ToolDeps) {
  return tool(
    async ({ query, limit }): Promise<string> => {
      const emb = await embedQuery(query);
      const rows = await deps.sql`
        select title,
          coalesce(array_to_string(cuisines, ', '), '')   as cuisines,
          coalesce(array_to_string(meal_types, ', '), '')  as meal_types,
          coalesce(array_to_string(diet_types, ', '), '')  as diets,
          coalesce(prep_time_min, 0) + coalesce(cook_time_min, 0) as total_min,
          servings
        from recipes
        where household_id = ${deps.householdId} and embedding is not null
        order by embedding <=> ${emb}::vector
        limit ${Math.min(limit ?? 5, 10)}`;
      return JSON.stringify(rows);
    },
    {
      name: "search_recipes",
      description:
        "Semantic search the household's OWN saved recipes by a natural-language description " +
        "(e.g. 'quick high-protein dinner', 'warm comforting soup'). Returns matching recipes with " +
        "cuisine, meal type, diet, total time (minutes), and servings.",
      schema: z.object({
        query: z.string().describe("natural-language description of what to cook"),
        limit: z.number().optional().describe("max results (default 5, max 10)"),
      }),
    },
  );
}

/** Read the household's planned meals for a week (planner read). */
export function plannerReadTool(deps: ToolDeps) {
  return tool(
    async ({ weekStartIso }): Promise<string> => {
      const rows = await deps.sql`
        select pe.date, pe.slot, coalesce(r.title, pe.custom_title) as meal
        from planner_entries pe
        left join recipes r on r.id = pe.recipe_id
        where pe.household_id = ${deps.householdId}
          and pe.date >= ${weekStartIso}::date and pe.date < (${weekStartIso}::date + interval '7 days')
        order by pe.date, pe.slot`;
      return JSON.stringify(rows);
    },
    {
      name: "read_planner",
      description: "Read the household's planned meals for the week starting on the given date (YYYY-MM-DD).",
      schema: z.object({ weekStartIso: z.string().describe("week start date, YYYY-MM-DD") }),
    },
  );
}

/**
 * PROPOSE adding a meal to the planner — does NOT write. Returns a structured
 * proposal the UI surfaces for the user to confirm; the app then executes the
 * real write via the existing planner service (propose → confirm → execute).
 */
export function plannerProposeTool() {
  return tool(
    async ({ date, slot, recipeTitle }): Promise<string> =>
      JSON.stringify({ proposal: "add_planner_entry", date, slot, recipeTitle, status: "awaiting_confirmation" }),
    {
      name: "propose_planner_entry",
      description:
        "Propose adding a meal to the planner for the user to confirm. Does NOT write anything — " +
        "use after the user agrees to a suggestion. The app asks the user to confirm before it takes effect.",
      schema: z.object({
        date: z.string().describe("date YYYY-MM-DD"),
        slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
        recipeTitle: z.string().describe("exact recipe title to add"),
      }),
    },
  );
}

/** Read the household's active shopping list. */
export function shoppingReadTool(deps: ToolDeps) {
  return tool(
    async (): Promise<string> => {
      const rows = await deps.sql`
        select sli.ingredient, sli.quantity, sli.unit, sli.category, sli.is_checked
        from shopping_lists sl
        join shopping_list_items sli on sli.list_id = sl.id
        where sl.household_id = ${deps.householdId} and sl.is_active = true
        order by sli.category, sli.position
        limit 80`;
      return JSON.stringify(rows);
    },
    {
      name: "read_shopping_list",
      description: "Read the household's active shopping list (ingredient, quantity, unit, category, checked).",
      schema: z.object({}),
    },
  );
}

/** PROPOSE generating a shopping list from the planner — propose-only, writes nothing. */
export function shoppingProposeTool() {
  return tool(
    async ({ weekStartIso }): Promise<string> =>
      JSON.stringify({ proposal: "generate_shopping_list", weekStartIso, status: "awaiting_confirmation" }),
    {
      name: "propose_shopping_list",
      description:
        "Propose generating a shopping list from the planner for the week starting weekStartIso (YYYY-MM-DD). " +
        "Does NOT write — the app confirms + generates via the RPC.",
      schema: z.object({ weekStartIso: z.string().describe("week start date YYYY-MM-DD") }),
    },
  );
}
