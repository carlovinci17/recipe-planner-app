import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, createTestUser, seedHousehold, seedIngredient, seedInstruction, seedRecipe, type SeededUser } from "./helpers";

/**
 * recipeService against real Postgres and real RLS. The identity seam is the
 * only mock; `runInUserTx` drops to the `authenticated` role, so every
 * assertion here is also an assertion about the policies.
 */
const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => (currentUser.id ? { id: currentUser.id, email: null, name: null, oid: null } : null),
}));

const { recipeService } = await import("@/lib/services/recipe-service");

describe("recipeService", () => {
  let owner: SeededUser;
  let outsider: SeededUser;
  let householdId: string;
  let otherHouseholdId: string;
  let published: string;

  beforeAll(async () => {
    owner = await createTestUser();
    outsider = await createTestUser();
    householdId = await seedHousehold(owner, "Recipe Home");
    otherHouseholdId = await seedHousehold(outsider, "Outsider Home");
    published = await seedRecipe({ householdId, createdBy: owner.id, title: "Roast Pumpkin Soup" });
    await seedIngredient(published, "1 pumpkin");
    await seedInstruction(published, "Roast it.");
    currentUser.id = owner.id;
  });

  afterAll(async () => {
    await cleanup({
      householdIds: [householdId, otherHouseholdId],
      userIds: [owner.id, outsider.id],
    });
  });

  describe("list", () => {
    it("returns the household's recipes", async () => {
      currentUser.id = owner.id;
      const rows = await recipeService.list({ householdId });
      expect(rows.map((r) => r.id)).toContain(published);
    });

    it("does NOT leak another household's recipes — this is RLS, not a WHERE clause", async () => {
      currentUser.id = outsider.id;
      // Asking for a household the caller does not belong to.
      const rows = await recipeService.list({ householdId });
      expect(rows).toEqual([]);
    });

    it("filters by favourite", async () => {
      currentUser.id = owner.id;
      const fav = await seedRecipe({ householdId, createdBy: owner.id, title: "Fav", isFavorite: true });
      const rows = await recipeService.list({ householdId, filters: { favoriteOnly: true } });
      expect(rows.map((r) => r.id)).toEqual([fav]);
    });

    it("filters by meal type", async () => {
      currentUser.id = owner.id;
      const dinner = await seedRecipe({
        householdId, createdBy: owner.id, title: "Dinner only", mealTypes: ["dinner"],
      });
      const rows = await recipeService.list({ householdId, filters: { mealTypes: ["dinner"] } });
      expect(rows.map((r) => r.id)).toContain(dinner);
      expect(rows.map((r) => r.id)).not.toContain(published);
    });

    it("excludes archived recipes", async () => {
      currentUser.id = owner.id;
      const doomed = await seedRecipe({ householdId, createdBy: owner.id, title: "Archive me" });
      await recipeService.archive(doomed);
      const rows = await recipeService.list({ householdId });
      expect(rows.map((r) => r.id)).not.toContain(doomed);
    });
  });

  describe("getById", () => {
    it("returns the recipe with its ingredients and instructions", async () => {
      currentUser.id = owner.id;
      const bundle = await recipeService.getById(published);
      expect(bundle.recipe.title).toBe("Roast Pumpkin Soup");
      expect(bundle.ingredients.map((i) => i.raw_text)).toEqual(["1 pumpkin"]);
      expect(bundle.instructions.map((s) => s.text)).toEqual(["Roast it."]);
    });
  });

  describe("mutations", () => {
    it("createDraft lands in needs_review so it shows in the review queue", async () => {
      currentUser.id = owner.id;
      const id = await recipeService.createDraft({ householdId });
      const { recipe } = await recipeService.getById(id);
      expect(recipe.status).toBe("needs_review");
      expect(recipe.title).toBe("Untitled recipe");
    });

    it("setFavorite and setRating round-trip", async () => {
      currentUser.id = owner.id;
      await recipeService.setFavorite(published, true);
      await recipeService.setRating(published, 4);
      const { recipe } = await recipeService.getById(published);
      expect(recipe.is_favorite).toBe(true);
      expect(recipe.rating).toBe(4);
    });

    it("replaceIngredients swaps the whole list rather than appending", async () => {
      currentUser.id = owner.id;
      const id = await seedRecipe({ householdId, createdBy: owner.id });
      await seedIngredient(id, "old one");
      await recipeService.replaceIngredients(id, [
        { raw_text: "new one", ingredient: "new one" },
        { raw_text: "new two", ingredient: "new two" },
      ]);
      const { ingredients } = await recipeService.getById(id);
      expect(ingredients.map((i) => i.raw_text)).toEqual(["new one", "new two"]);
    });

    it("publish flips needs_review to published", async () => {
      currentUser.id = owner.id;
      const id = await seedRecipe({ householdId, createdBy: owner.id, status: "needs_review" });
      await recipeService.publish(id);
      const { recipe } = await recipeService.getById(id);
      expect(recipe.status).toBe("published");
    });

    it("an outsider's delete is a no-op — RLS matches no row", async () => {
      const id = await seedRecipe({ householdId, createdBy: owner.id, title: "Protected" });
      currentUser.id = outsider.id;
      await recipeService.delete(id).catch(() => undefined);
      currentUser.id = owner.id;
      const { recipe } = await recipeService.getById(id);
      expect(recipe.title).toBe("Protected");
    });
  });
});
