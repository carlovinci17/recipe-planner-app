import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addMember, cleanup, createTestUser, seedHousehold, seedRecipe, type SeededUser } from "./helpers";

const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => (currentUser.id ? { id: currentUser.id, email: null, name: null, oid: null } : null),
}));

const { ratingService } = await import("@/lib/services/rating-service");

describe("ratingService", () => {
  let owner: SeededUser;
  let member: SeededUser;
  let outsider: SeededUser;
  let householdId: string;
  let recipeId: string;

  beforeAll(async () => {
    owner = await createTestUser();
    member = await createTestUser();
    outsider = await createTestUser();
    householdId = await seedHousehold(owner, "Rating Home");
    await addMember(householdId, member, "member");
    recipeId = await seedRecipe({ householdId, createdBy: owner.id, title: "Rated" });
  });

  afterAll(async () => {
    await cleanup({ householdIds: [householdId], userIds: [owner.id, member.id, outsider.id] });
  });

  it("stores one rating per user, upserting on repeat", async () => {
    currentUser.id = owner.id;
    await ratingService.setMyRating({ recipeId, rating: 3 });
    await ratingService.setMyRating({ recipeId, rating: 5 });
    const rows = await ratingService.listForRecipe(recipeId);
    const mine = rows.filter((r) => r.user_id === owner.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.rating).toBe(5);
  });

  it("keeps each household member's rating separate", async () => {
    currentUser.id = member.id;
    await ratingService.setMyRating({ recipeId, rating: 2 });
    currentUser.id = owner.id;
    const rows = await ratingService.listForRecipe(recipeId);
    expect(rows.map((r) => r.rating).sort()).toEqual([2, 5]);
  });

  it("averages across the household", async () => {
    currentUser.id = owner.id;
    const agg = await ratingService.getAggregatesForRecipes([recipeId]);
    const entry = agg.get(recipeId);
    expect(entry?.count).toBe(2);
    expect(entry?.avg).toBeCloseTo(3.5, 5);
  });

  it("rejects a rating outside 1-5 before touching the database", async () => {
    currentUser.id = owner.id;
    await expect(ratingService.setMyRating({ recipeId, rating: 9 })).rejects.toThrow(/between 1 and 5/);
    await expect(ratingService.setMyRating({ recipeId, rating: 0 })).rejects.toThrow(/between 1 and 5/);
  });

  it("clearMyRating removes only the caller's own", async () => {
    currentUser.id = owner.id;
    await ratingService.clearMyRating(recipeId);
    const rows = await ratingService.listForRecipe(recipeId);
    expect(rows.map((r) => r.user_id)).toEqual([member.id]);
  });

  it("shows an outsider nothing — RLS scopes ratings by household", async () => {
    currentUser.id = outsider.id;
    const rows = await ratingService.listForRecipe(recipeId);
    expect(rows).toEqual([]);
  });

  it("returns an empty map for an empty id list without querying", async () => {
    currentUser.id = owner.id;
    expect(await ratingService.getAggregatesForRecipes([])).toEqual(new Map());
  });
});
