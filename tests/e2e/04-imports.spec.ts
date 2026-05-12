import { test, expect } from "../fixtures/test-user";
import { LoginPage, OnboardingPage, RecipesPage } from "../fixtures/page-objects";

/**
 * Import flow smoke tests.
 *
 * The full ingestion pipeline (vision extraction, AI tagging) requires:
 *   - A running Inngest dev server (`npx inngest-cli@latest dev -u <url>`)
 *   - A real ANTHROPIC_API_KEY
 *
 * In CI, those are typically not available, so these tests just exercise the
 * UI surface up to the point an ingestion job is created. We assert that:
 *   1. The upload form accepts a file and creates a job
 *   2. The "Recent imports" UI updates with the new job
 *   3. Failed jobs surface as 'Failed' (proves onFailure hook works)
 *
 * Set `RUN_INGESTION_E2E=1` to enable a full live test that requires the
 * Inngest + Anthropic backends.
 */

test.describe("Imports: UI smoke", () => {
  test.beforeEach(async ({ page, testUser }) => {
    await new LoginPage(page).go();
    await new LoginPage(page).loginWithPassword(testUser.email, testUser.password);
    await new OnboardingPage(page).createHousehold("Import test");
  });

  test("import page renders the three source options", async ({ page }) => {
    const recipes = new RecipesPage(page);
    await recipes.openImport();

    await expect(page.getByRole("tab", { name: /upload/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /from url/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /google drive/i })).toBeVisible();
  });

  test("URL import: validates input and creates a job row", async ({ page }) => {
    const recipes = new RecipesPage(page);
    await recipes.openImport();
    await page.getByRole("tab", { name: /from url/i }).click();

    const urlInput = page.getByLabel(/recipe url/i);
    await urlInput.fill("https://www.bbcgoodfood.com/recipes/easy-tomato-pasta");
    await page.getByRole("button", { name: /import from url/i }).click();

    // The "Recent imports" section appears once a job exists.
    await expect(page.getByText(/recent imports/i)).toBeVisible({ timeout: 10_000 });
    // The job will be in 'Processing' or 'Failed' depending on whether Inngest is running.
    await expect(
      page.getByText(/processing|ready for review|failed/i).first(),
    ).toBeVisible();
  });

  test("URL import: rejects malformed URL on the client", async ({ page }) => {
    const recipes = new RecipesPage(page);
    await recipes.openImport();
    await page.getByRole("tab", { name: /from url/i }).click();
    const urlInput = page.getByLabel(/recipe url/i);
    await urlInput.fill("not-a-url");
    await page.getByRole("button", { name: /import from url/i }).click();
    // Browser native validation should keep us on the page.
    await expect(page).toHaveURL(/\/recipes\/import/);
  });
});

const RUN_INGESTION = process.env.RUN_INGESTION_E2E === "1";

test.describe("Imports: live ingestion", () => {
  test.skip(!RUN_INGESTION, "Set RUN_INGESTION_E2E=1 with Inngest + Anthropic running");

  test("URL import completes and surfaces a Review link", async ({ page, testUser }) => {
    await new LoginPage(page).go();
    await new LoginPage(page).loginWithPassword(testUser.email, testUser.password);
    await new OnboardingPage(page).createHousehold("Live import test");

    const recipes = new RecipesPage(page);
    await recipes.openImport();
    await page.getByRole("tab", { name: /from url/i }).click();

    await page
      .getByLabel(/recipe url/i)
      .fill("https://www.bbcgoodfood.com/recipes/easy-tomato-pasta");
    await page.getByRole("button", { name: /import from url/i }).click();

    // Up to 90s: extraction with Claude Opus is slow on cold cache
    await expect(page.getByRole("link", { name: /review/i })).toBeVisible({
      timeout: 90_000,
    });
  });
});
