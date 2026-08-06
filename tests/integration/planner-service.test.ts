import { addDays, format, startOfWeek } from "date-fns";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminClient,
  authedClientFor,
  createTestUser,
  deleteTestUser,
  seedHousehold,
  seedIngredient,
  seedPlannerEntry,
  seedRecipe,
  type SeededUser,
} from "./helpers";

// Same seam as the recipe-service tests: the service calls
// createSupabaseServerClient() internally; we hand it a client authed as our user.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { plannerService } from "@/lib/services/planner-service";

/**
 * CHARACTERIZATION test — the `generate_shopping_list_from_planner` RPC (plpgsql),
 * one of the three RPCs ported in Lesson 3.4. It creates a shopping list for the
 * week and aggregates ingredients from every recipe-backed planner entry in it.
 */
describe("plannerService.generateShoppingList — current behaviour (RPC)", () => {
  let user: SeededUser;
  let householdId: string;
  let listId: string;

  const weekStart = new Date("2026-06-15T12:00:00Z");
  const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
  const mondayIso = format(monday, "yyyy-MM-dd");
  // The CURRENT RPC (redefined in migration 20260509000200) names lists
  // "Shopping <start>-<end>", not the original "Week of ...". Characterize reality.
  const expectedName = `Shopping ${format(monday, "MMM dd")}-${format(addDays(monday, 6), "MMM dd")}`;

  beforeAll(async () => {
    user = await createTestUser();
    const authed = await authedClientFor(user);
    householdId = await seedHousehold(authed);

    const recipeId = await seedRecipe(authed, { householdId, createdBy: user.id, title: "Cake" });
    await seedIngredient(authed, { recipeId, position: 0, ingredient: "flour", unit: "g", quantity: 200 });
    await seedIngredient(authed, { recipeId, position: 1, ingredient: "sugar", unit: "g", quantity: 100 });
    await seedPlannerEntry(authed, {
      householdId,
      createdBy: user.id,
      recipeId,
      date: mondayIso,
      slot: "dinner",
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    listId = await plannerService.generateShoppingList({ householdId, weekStart });
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("creates a shopping list for the week, scoped to the household", async () => {
    expect(listId).toEqual(expect.any(String));
    const { data: list } = await adminClient()
      .from("shopping_lists")
      .select("*")
      .eq("id", listId)
      .single();
    expect(list?.household_id).toBe(householdId);
    expect(list?.week_start).toBe(mondayIso);
    expect(list?.name).toBe(expectedName);
  });

  it("aggregates the planned recipe's ingredients into list items", async () => {
    const { data: items } = await adminClient()
      .from("shopping_list_items")
      .select("ingredient, unit, quantity")
      .eq("list_id", listId);
    const names = (items ?? []).map((i) => i.ingredient).sort();
    expect(names).toContain("flour");
    expect(names).toContain("sugar");
  });
});
