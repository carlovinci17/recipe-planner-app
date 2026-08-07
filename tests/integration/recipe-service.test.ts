import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminClient,
  authedClientFor,
  createTestUser,
  deleteTestUser,
  seedHousehold,
  seedIngredient,
  seedInstruction,
  seedPlannerEntry,
  seedRecipe,
  type SeededUser,
} from "./helpers";

// The service calls `createSupabaseServerClient()` internally (cookie-bound in
// prod). We mock that factory and hand it a client authenticated as our seeded
// user, so the query runs under real RLS — no cookies/next-headers needed.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recipeService } from "@/lib/services/recipe-service";

/**
 * CHARACTERIZATION test — this pins the *current* Supabase behaviour of
 * recipeService.list. When the internals are rewired to Drizzle (Module 3),
 * these assertions must still pass unchanged. That's the whole safety net.
 */
describe("recipeService.list — current behaviour", () => {
  let user: SeededUser;
  let householdId: string;

  beforeAll(async () => {
    user = await createTestUser();
    const authed = await authedClientFor(user);
    householdId = await seedHousehold(authed);

    // Route the service's internal client to our authed one.
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    // Seed three recipes that exercise the default filter (published + non-archived).
    await seedRecipe(authed, { householdId, createdBy: user.id, title: "Published One", status: "published" });
    await seedRecipe(authed, { householdId, createdBy: user.id, title: "A Draft", status: "draft" });
    await seedRecipe(authed, {
      householdId,
      createdBy: user.id,
      title: "Archived One",
      status: "published",
      archived: true,
    });
  }, 30_000);

  afterAll(async () => {
    // Delete the household first (cascades recipes + members), then the user.
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("returns published, non-archived recipes for the household", async () => {
    const rows = await recipeService.list({ householdId });
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("Published One");
    expect(titles).not.toContain("A Draft"); // default status filter excludes draft
    expect(titles).not.toContain("Archived One"); // archived_at rows are filtered out
  });

  it("scopes results to the given household id", async () => {
    const rows = await recipeService.list({ householdId });
    expect(rows.every((r) => r.household_id === householdId)).toBe(true);
  });

  it("returns the documented RecipeListItem shape", async () => {
    const [row] = await recipeService.list({ householdId });
    expect(row).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        household_id: householdId,
        status: expect.any(String),
        is_favorite: expect.any(Boolean),
        created_at: expect.any(String),
      }),
    );
  });
});

/**
 * CHARACTERIZATION test — the security guarantee. RLS scopes every read to the
 * caller's households; a member of one household must never see another's data.
 * The Drizzle + `current_setting` RLS rewrite (ADR-002) must reproduce this exactly.
 */
describe("recipeService.list — cross-household isolation (RLS)", () => {
  let userA: SeededUser, userB: SeededUser;
  let householdA: string, householdB: string;

  beforeAll(async () => {
    // User A + their household + a recipe.
    userA = await createTestUser();
    const authedA = await authedClientFor(userA);
    householdA = await seedHousehold(authedA, "Household A");
    await seedRecipe(authedA, {
      householdId: householdA,
      createdBy: userA.id,
      title: "A's Secret Recipe",
    });

    // User B + their own (empty) household.
    userB = await createTestUser();
    const authedB = await authedClientFor(userB);
    householdB = await seedHousehold(authedB, "Household B");

    // Run the service AS user B.
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authedB as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    const admin = adminClient();
    if (householdA) await admin.from("households").delete().eq("id", householdA);
    if (householdB) await admin.from("households").delete().eq("id", householdB);
    if (userA) await deleteTestUser(userA.id);
    if (userB) await deleteTestUser(userB.id);
  });

  it("does not surface another household's recipes in B's own list", async () => {
    const titles = (await recipeService.list({ householdId: householdB })).map((r) => r.title);
    expect(titles).not.toContain("A's Secret Recipe");
  });

  it("returns nothing when B queries A's household id directly (RLS blocks it)", async () => {
    const rows = await recipeService.list({ householdId: householdA });
    expect(rows).toEqual([]);
  });
});

/**
 * CHARACTERIZATION test — the detail read path. getById fetches the recipe plus
 * its ingredients and instructions, each ordered by `position`, and uses
 * `.single()` (which throws when the row is missing).
 */
describe("recipeService.getById — current behaviour", () => {
  let user: SeededUser;
  let householdId: string;
  let recipeId: string;

  beforeAll(async () => {
    user = await createTestUser();
    const authed = await authedClientFor(user);
    householdId = await seedHousehold(authed);
    recipeId = await seedRecipe(authed, {
      householdId,
      createdBy: user.id,
      title: "Detailed Recipe",
    });

    // Insert out of order to prove the service orders by `position`.
    await seedIngredient(authed, { recipeId, position: 1, ingredient: "sugar", unit: "g", quantity: 50 });
    await seedIngredient(authed, { recipeId, position: 0, ingredient: "flour", unit: "g", quantity: 200 });
    await seedInstruction(authed, { recipeId, position: 1, text: "Bake" });
    await seedInstruction(authed, { recipeId, position: 0, text: "Mix" });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("returns the recipe with ingredients and instructions ordered by position", async () => {
    const { recipe, ingredients, instructions } = await recipeService.getById(recipeId);
    expect(recipe.id).toBe(recipeId);
    expect(ingredients.map((i) => i.position)).toEqual([0, 1]);
    expect(ingredients[0]?.ingredient).toBe("flour");
    expect(instructions.map((s) => s.position)).toEqual([0, 1]);
    expect(instructions[0]?.text).toBe("Mix");
  });

  it("throws when the recipe id does not exist (.single())", async () => {
    await expect(
      recipeService.getById("00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeDefined();
  });
});

/**
 * CHARACTERIZATION test — the write path. These mutate recipes, so they exercise
 * the UPDATE/DELETE RLS policies (creator-or-owner). The Drizzle port must
 * reproduce the same effects under withUserContext.
 */
describe("recipeService writes — current behaviour", () => {
  let user: SeededUser;
  let householdId: string;
  let authed: Awaited<ReturnType<typeof authedClientFor>>;

  const readRecipe = async (id: string) =>
    (await adminClient().from("recipes").select("*").eq("id", id).maybeSingle()).data;

  beforeAll(async () => {
    user = await createTestUser();
    authed = await authedClientFor(user);
    householdId = await seedHousehold(authed);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("setFavorite flips is_favorite", async () => {
    const id = await seedRecipe(authed, { householdId, createdBy: user.id });
    await recipeService.setFavorite(id, true);
    expect((await readRecipe(id))?.is_favorite).toBe(true);
    await recipeService.setFavorite(id, false);
    expect((await readRecipe(id))?.is_favorite).toBe(false);
  });

  it("archive sets archived_at", async () => {
    const id = await seedRecipe(authed, { householdId, createdBy: user.id });
    expect((await readRecipe(id))?.archived_at).toBeNull();
    await recipeService.archive(id);
    expect((await readRecipe(id))?.archived_at).not.toBeNull();
  });

  it("delete removes the recipe", async () => {
    const id = await seedRecipe(authed, { householdId, createdBy: user.id });
    await recipeService.delete(id);
    expect(await readRecipe(id)).toBeNull();
  });
});

/**
 * CHARACTERIZATION — the recipe-edit methods: update (dynamic patch),
 * replaceIngredients (delete + insert child rows), countPlannerEntries (count).
 */
describe("recipeService edit methods — current behaviour", () => {
  let user: SeededUser;
  let householdId: string;
  let authed: Awaited<ReturnType<typeof authedClientFor>>;

  const readRecipe = async (id: string) =>
    (await adminClient().from("recipes").select("*").eq("id", id).maybeSingle()).data;

  beforeAll(async () => {
    user = await createTestUser();
    authed = await authedClientFor(user);
    householdId = await seedHousehold(authed);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("update patches recipe columns", async () => {
    const id = await seedRecipe(authed, { householdId, createdBy: user.id });
    await recipeService.update(id, { description: "Updated desc", servings: 6 });
    const r = await readRecipe(id);
    expect(r?.description).toBe("Updated desc");
    expect(r?.servings).toBe(6);
  });

  it("replaceIngredients swaps the ingredient set (ordered)", async () => {
    const id = await seedRecipe(authed, { householdId, createdBy: user.id });
    await seedIngredient(authed, { recipeId: id, position: 0, ingredient: "old" });
    await recipeService.replaceIngredients(id, [
      { raw_text: "200g flour", ingredient: "flour", unit: "g", quantity: 200 },
      { raw_text: "2 eggs", ingredient: "eggs" },
    ]);
    const { data } = await adminClient()
      .from("recipe_ingredients")
      .select("position, ingredient")
      .eq("recipe_id", id)
      .order("position");
    expect((data ?? []).map((i) => i.ingredient)).toEqual(["flour", "eggs"]);
  });

  it("countPlannerEntries counts entries referencing the recipe", async () => {
    const id = await seedRecipe(authed, { householdId, createdBy: user.id });
    expect(await recipeService.countPlannerEntries(id)).toBe(0);
    await seedPlannerEntry(authed, { householdId, createdBy: user.id, recipeId: id, date: "2026-06-15" });
    await seedPlannerEntry(authed, { householdId, createdBy: user.id, recipeId: id, date: "2026-06-16" });
    expect(await recipeService.countPlannerEntries(id)).toBe(2);
  });
});
