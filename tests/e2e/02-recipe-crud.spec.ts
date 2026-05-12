import { test, expect } from "../fixtures/test-user";
import { LoginPage, OnboardingPage, RecipesPage } from "../fixtures/page-objects";

test.describe("Recipe CRUD", () => {
  test.beforeEach(async ({ page, testUser }) => {
    await new LoginPage(page).go();
    await new LoginPage(page).loginWithPassword(testUser.email, testUser.password);
    await new OnboardingPage(page).createHousehold("Recipes test");
  });

  test("creates a recipe manually, edits it, then deletes it", async ({ page }) => {
    const recipes = new RecipesPage(page);
    await recipes.createManual();

    // Create
    await recipes.fillReviewForm({
      title: "E2E Test Pancakes",
      description: "Auto-test",
      servings: 4,
      ingredients: ["1 cup flour", "1 tbsp sugar", "2 eggs"],
      instructions: ["Mix dry", "Add wet", "Cook on griddle"],
    });
    await recipes.save();

    // Detail page should show the title
    await expect(page.getByRole("heading", { name: "E2E Test Pancakes" })).toBeVisible();

    // Edit
    await page.getByRole("link", { name: /^edit$/i }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await page.getByLabel("Title").fill("E2E Edited Pancakes");
    await page.getByRole("button", { name: /save recipe/i }).click();
    await expect(page.getByRole("heading", { name: "E2E Edited Pancakes" })).toBeVisible();

    // Delete (creator + owner can delete)
    await page.getByRole("button", { name: /^delete$/i }).click();
    await expect(page.getByText(/delete recipe\?/i)).toBeVisible();
    await page.getByRole("button", { name: /^delete$/i }).last().click();
    await expect(page).toHaveURL(/\/recipes$/);
    await expect(page.getByRole("heading", { name: "E2E Edited Pancakes" })).toBeHidden();
  });

  test("recipe shows on the list after creation", async ({ page }) => {
    const recipes = new RecipesPage(page);
    await recipes.createManual();
    await recipes.fillReviewForm({
      title: "List Test Recipe",
      ingredients: ["water"],
      instructions: ["boil"],
    });
    await recipes.save();

    await page.goto("/recipes");
    await expect(page.getByText("List Test Recipe")).toBeVisible();
  });

  test("favourite toggle persists", async ({ page }) => {
    const recipes = new RecipesPage(page);
    await recipes.createManual();
    await recipes.fillReviewForm({ title: "Favourite Me" });
    await recipes.save();

    const favBtn = page.getByRole("button", { name: /favorite|favourite/i });
    await favBtn.click();
    await expect(favBtn).toHaveText(/favorited|favourited/i);
    await page.reload();
    await expect(page.getByRole("button", { name: /favorited|favourited/i })).toBeVisible();
  });
});
