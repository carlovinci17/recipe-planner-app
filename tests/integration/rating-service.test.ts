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

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ratingService } from "@/lib/services/rating-service";

/**
 * CHARACTERIZATION — recipe_ratings: setMyRating (upsert), listForRecipe
 * (⋈ profiles, newest first), getAggregatesForRecipes (avg/count), clearMyRating.
 */
describe("ratingService — current behaviour", () => {
  let user: SeededUser;
  let householdId: string;
  let authed: Awaited<ReturnType<typeof authedClientFor>>;
  let recipeId: string;

  beforeAll(async () => {
    user = await createTestUser();
    authed = await authedClientFor(user);
    householdId = await seedHousehold(authed);
    recipeId = await seedRecipe(authed, { householdId, createdBy: user.id, title: "Rated" });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("setMyRating upserts, and a second call updates in place", async () => {
    await ratingService.setMyRating({ recipeId, rating: 3 });
    let ratings = await ratingService.listForRecipe(recipeId);
    expect(ratings).toHaveLength(1);
    expect(ratings[0]?.rating).toBe(3);
    expect(ratings[0]?.user_id).toBe(user.id);
    expect(ratings[0]?.user?.email).toBe(user.email);

    // Upsert (same recipe+user) updates rather than inserting a duplicate.
    await ratingService.setMyRating({ recipeId, rating: 5 });
    ratings = await ratingService.listForRecipe(recipeId);
    expect(ratings).toHaveLength(1);
    expect(ratings[0]?.rating).toBe(5);
  });

  it("getAggregatesForRecipes returns avg + count", async () => {
    const agg = await ratingService.getAggregatesForRecipes([recipeId]);
    expect(agg.get(recipeId)).toEqual({ avg: 5, count: 1 });
  });

  it("clearMyRating removes the caller's rating", async () => {
    await ratingService.clearMyRating(recipeId);
    const ratings = await ratingService.listForRecipe(recipeId);
    expect(ratings).toHaveLength(0);
    expect(await ratingService.getAggregatesForRecipes([recipeId])).toEqual(new Map());
  });
});
