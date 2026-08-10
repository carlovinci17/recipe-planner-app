import { test, expect } from "../fixtures/test-user";
import {
  LoginPage,
  OnboardingPage,
  PlannerPage,
  RecipesPage,
} from "../fixtures/page-objects";

test.describe("Planner + shopping list", () => {
  test.beforeEach(async ({ page, testUser }) => {
    await new LoginPage(page).go();
    await new LoginPage(page).loginWithPassword(testUser.email, testUser.password);
    await new OnboardingPage(page).createHousehold("Planner test");
  });

  test("adds a recipe to the planner and removes it", async ({ page }) => {
    // Create a recipe to plan
    const recipes = new RecipesPage(page);
    await recipes.createManual();
    await recipes.fillReviewForm({
      title: "Planner Pasta",
      servings: 2,
      ingredients: ["spaghetti", "tomato sauce"],
      instructions: ["boil", "mix"],
    });
    await recipes.save();

    // Add to planner
    const planner = new PlannerPage(page);
    await planner.go();
    await planner.addEntryToFirstCell("Planner Pasta");
    await expect(planner.entry("Planner Pasta")).toBeVisible();

    // Remove (the trash button is opacity-0 until hover, so force the click).
    // Scope to the visible desktop grid — the mobile grid's copy is display:none.
    await planner.removeFirstEntry();
    await expect(planner.entry("Planner Pasta")).toBeHidden();
  });

  test("builds a shopping list from a 7-day range", async ({ page }) => {
    // Create + plan a recipe
    const recipes = new RecipesPage(page);
    await recipes.createManual();
    await recipes.fillReviewForm({
      title: "Shopping Test Soup",
      servings: 4,
      ingredients: ["onion", "carrot", "broth"],
      instructions: ["chop", "simmer"],
    });
    await recipes.save();

    const planner = new PlannerPage(page);
    await planner.go();
    await planner.addEntryToFirstCell("Shopping Test Soup");

    // Build list (default 7 days)
    await planner.openShoppingDialog();
    await planner.confirmBuildList();

    // Shopping list contains the ingredients (deduped, may be in any order)
    await expect(page.getByText(/onion/i)).toBeVisible();
    await expect(page.getByText(/carrot/i)).toBeVisible();
    await expect(page.getByText(/broth/i)).toBeVisible();
  });

  test("builds a shopping list from a custom 3-day range", async ({ page }) => {
    const recipes = new RecipesPage(page);
    await recipes.createManual();
    await recipes.fillReviewForm({
      title: "Three Day Soup",
      servings: 2,
      ingredients: ["potato", "leek"],
      instructions: ["boil"],
    });
    await recipes.save();

    const planner = new PlannerPage(page);
    await planner.go();
    await planner.addEntryToFirstCell("Three Day Soup");

    await planner.openShoppingDialog();
    await page.getByRole("button", { name: /^3 days$/i }).click();
    await planner.confirmBuildList();

    await expect(page.getByText(/potato/i)).toBeVisible();
    await expect(page.getByText(/leek/i)).toBeVisible();
  });

  test("shopping list checkboxes toggle", async ({ page }) => {
    const recipes = new RecipesPage(page);
    await recipes.createManual();
    await recipes.fillReviewForm({
      title: "Check Test Recipe",
      servings: 2,
      ingredients: ["test-ingredient-A"],
      instructions: ["x"],
    });
    await recipes.save();

    const planner = new PlannerPage(page);
    await planner.go();
    await planner.addEntryToFirstCell("Check Test Recipe");
    await planner.openShoppingDialog();
    await planner.confirmBuildList();

    // Find the row and click its checkbox
    const row = page.getByText(/test-ingredient-A/i).first();
    await expect(row).toBeVisible();
    await row.locator("..").locator("..").locator('button[role="checkbox"]').click();

    // Row should show as checked (line-through styling)
    await expect(row).toHaveClass(/line-through/);
  });
});
