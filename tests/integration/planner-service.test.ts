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

/**
 * CHARACTERIZATION — planner writes: moveEntry (update date/slot/position),
 * removeEntry (delete).
 */
describe("plannerService moveEntry / removeEntry — current behaviour", () => {
  let user: SeededUser;
  let householdId: string;
  let authed: Awaited<ReturnType<typeof authedClientFor>>;
  let recipeId: string;

  beforeAll(async () => {
    user = await createTestUser();
    authed = await authedClientFor(user);
    householdId = await seedHousehold(authed);
    recipeId = await seedRecipe(authed, { householdId, createdBy: user.id });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("moveEntry updates date/slot/position", async () => {
    const entryId = await seedPlannerEntry(authed, {
      householdId,
      createdBy: user.id,
      recipeId,
      date: "2026-06-15",
      slot: "lunch",
    });
    await plannerService.moveEntry({ entryId, date: "2026-06-20", slot: "dinner", position: 3 });
    const { data } = await adminClient()
      .from("planner_entries")
      .select("date, slot, position")
      .eq("id", entryId)
      .single();
    expect(data?.date).toBe("2026-06-20");
    expect(data?.slot).toBe("dinner");
    expect(data?.position).toBe(3);
  });

  it("removeEntry deletes the entry", async () => {
    const entryId = await seedPlannerEntry(authed, {
      householdId,
      createdBy: user.id,
      recipeId,
      date: "2026-06-21",
    });
    await plannerService.removeEntry(entryId);
    const { data } = await adminClient()
      .from("planner_entries")
      .select("id")
      .eq("id", entryId)
      .maybeSingle();
    expect(data).toBeNull();
  });
});

/**
 * CHARACTERIZATION — the planner reads/insert: getWeek (planner_entries ⟕ recipes,
 * ordered date/slot/position) and addEntry (max-position + insert, embedded return).
 */
describe("plannerService getWeek / addEntry — current behaviour", () => {
  let user: SeededUser;
  let householdId: string;
  let authed: Awaited<ReturnType<typeof authedClientFor>>;
  let recipeId: string;

  // Monday of the week we plan into.
  const weekStart = new Date("2026-07-06T12:00:00Z");
  const monday = format(startOfWeek(weekStart, { weekStartsOn: 1 }), "yyyy-MM-dd");

  beforeAll(async () => {
    user = await createTestUser();
    authed = await authedClientFor(user);
    householdId = await seedHousehold(authed);
    recipeId = await seedRecipe(authed, { householdId, createdBy: user.id, title: "Roast" });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("getWeek returns entries with the embedded recipe (and null for custom entries)", async () => {
    await seedPlannerEntry(authed, {
      householdId,
      createdBy: user.id,
      recipeId,
      date: monday,
      slot: "dinner",
    });
    await seedPlannerEntry(authed, {
      householdId,
      createdBy: user.id,
      customTitle: "Leftovers",
      date: monday,
      slot: "lunch",
    });

    const { dates, entries } = await plannerService.getWeek({ householdId, weekStart });
    expect(dates).toContain(monday);

    const withRecipe = entries.find((e) => e.recipe_id === recipeId);
    expect(withRecipe?.recipe?.title).toBe("Roast");

    const custom = entries.find((e) => e.custom_title === "Leftovers");
    expect(custom?.recipe).toBeNull();
  });

  it("addEntry inserts at the next position and returns the embedded shape", async () => {
    const first = await plannerService.addEntry({
      householdId,
      date: "2026-07-08",
      slot: "breakfast",
      recipeId,
    });
    expect(first.position).toBe(0);
    expect(first.recipe?.title).toBe("Roast");

    const second = await plannerService.addEntry({
      householdId,
      date: "2026-07-08",
      slot: "breakfast",
      customTitle: "Toast",
    });
    expect(second.position).toBe(1);
    expect(second.recipe).toBeNull();

    const { data } = await adminClient()
      .from("planner_entries")
      .select("id")
      .eq("id", first.id)
      .single();
    expect(data?.id).toBe(first.id);
  });
});

/**
 * CHARACTERIZATION — generateShoppingListRange: the range RPC + item count.
 */
describe("plannerService.generateShoppingListRange — current behaviour", () => {
  let user: SeededUser;
  let householdId: string;
  let authed: Awaited<ReturnType<typeof authedClientFor>>;

  const startDate = new Date("2026-08-03T12:00:00Z");

  beforeAll(async () => {
    user = await createTestUser();
    authed = await authedClientFor(user);
    householdId = await seedHousehold(authed);
    const recipeId = await seedRecipe(authed, { householdId, createdBy: user.id, title: "Stew" });
    // Parsed ingredient (AI-style) …
    await seedIngredient(authed, { recipeId, position: 0, ingredient: "carrot", unit: "g", quantity: 100 });
    // … and a raw_text-only ingredient (manual entry: parsed `ingredient` is null).
    // Both must aggregate via coalesce(ingredient, raw_text) — migration 20260806250000.
    await seedIngredient(authed, { recipeId, position: 1, rawText: "onion" });
    await seedPlannerEntry(authed, {
      householdId,
      createdBy: user.id,
      recipeId,
      date: format(startDate, "yyyy-MM-dd"),
      slot: "dinner",
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("creates a list and returns the aggregated item count", async () => {
    const { listId, itemCount } = await plannerService.generateShoppingListRange({
      householdId,
      startDate,
      numDays: 7,
    });
    expect(listId).toEqual(expect.any(String));
    expect(itemCount).toBeGreaterThan(0);

    const { data: items } = await adminClient()
      .from("shopping_list_items")
      .select("ingredient")
      .eq("list_id", listId);
    const names = (items ?? []).map((i) => i.ingredient);
    expect(names).toContain("carrot"); // parsed ingredient
    expect(names).toContain("onion"); // raw_text fallback
  });
});
