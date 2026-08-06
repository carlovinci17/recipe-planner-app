import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminClient,
  authedClientFor,
  createTestUser,
  deleteTestUser,
  seedHousehold,
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
