import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Page Object Models — keep selector logic here so spec files stay readable.
 * Each method does one user-visible thing and ends in a state assertion.
 */

export class LoginPage {
  constructor(private readonly page: Page) {}

  async go() {
    await this.page.goto("/login");
    await expect(this.page.getByLabel("Email")).toBeVisible();
  }

  async loginWithPassword(email: string, password: string) {
    await this.page.getByLabel("Email").fill(email);
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("button", { name: /^log in$/i }).click();
    // Sign-in is client-side (supabase.auth.signInWithPassword) followed by a
    // router.push away from /login. Wait for that redirect so the session cookie
    // is set before the caller navigates on — otherwise the next request races
    // the cookie, the middleware sees no user, and bounces it to /login.
    await expect(this.page).not.toHaveURL(/\/login(\?|$)/);
  }
}

export class OnboardingPage {
  constructor(private readonly page: Page) {}

  async createHousehold(name: string) {
    await expect(this.page).toHaveURL(/\/onboarding/);
    await this.page.getByLabel(/household name/i).fill(name);
    await this.page.getByRole("button", { name: /create household/i }).click();
    // Onboarding lands on /recipes (the old /dashboard route was renamed in
    // 4407447, 2026-05-30); this fixture was missed in that rename.
    await expect(this.page).toHaveURL(/\/recipes/);
  }
}

export class RecipesPage {
  constructor(private readonly page: Page) {}

  async go() {
    await this.page.goto("/recipes");
  }

  async openImport() {
    await this.page.goto("/recipes/import");
    await expect(this.page.getByRole("heading", { name: /import a recipe/i })).toBeVisible();
  }

  async createManual() {
    // /recipes/new redirects to the review form for a draft recipe
    await this.page.goto("/recipes/new");
    await expect(this.page).toHaveURL(/\/recipes\/.+\/review/);
  }

  async fillReviewForm(args: {
    title: string;
    description?: string;
    servings?: number;
    ingredients?: string[];
    instructions?: string[];
  }) {
    const titleInput = this.page.getByLabel("Title");
    await titleInput.fill(args.title);
    if (args.description) {
      await this.page.getByLabel("Description").fill(args.description);
    }
    if (args.servings) {
      await this.page.getByLabel("Servings").fill(String(args.servings));
    }
    for (const ing of args.ingredients ?? []) {
      await this.page
        .getByRole("button", { name: /^add$/i })
        .first()
        .click();
      const inputs = this.page.locator('input[placeholder*="1 cup flour"]');
      await inputs.last().fill(ing);
    }
    for (const step of args.instructions ?? []) {
      const buttons = this.page.getByRole("button", { name: /^add$/i });
      await buttons.nth(1).click();
      const textareas = this.page.locator("textarea");
      await textareas.last().fill(step);
    }
  }

  async save() {
    await this.page.getByRole("button", { name: /save recipe/i }).click();
    await expect(this.page).toHaveURL(/\/recipes\/[^/]+$/, { timeout: 15_000 });
  }
}

export class PlannerPage {
  constructor(private readonly page: Page) {}

  async go() {
    await this.page.goto("/planner");
    await expect(this.page.getByRole("heading", { name: /weekly planner/i })).toBeVisible();
  }

  /**
   * A planned entry by title, scoped to the visible desktop grid. The planner
   * renders two grids (mobile + desktop) that coexist in the DOM and are toggled
   * by CSS, so an unscoped getByText matches both and trips Playwright strict mode.
   */
  entry(title: string) {
    return this.page.getByTestId("planner-grid-desktop").getByText(title);
  }

  /** Remove the first planned entry in the visible desktop grid. */
  async removeFirstEntry() {
    await this.page
      .getByTestId("planner-grid-desktop")
      .getByRole("button", { name: "Remove" })
      .first()
      .click({ force: true });
  }

  async addEntryToFirstCell(recipeTitle: string) {
    // First "Add" button under the planner grid (top-left cell)
    const addButtons = this.page.getByRole("button", { name: /^add$/i });
    await addButtons.first().click();
    await expect(this.page.getByText(/add a meal/i)).toBeVisible();

    await this.page.getByPlaceholder(/search your recipes/i).fill(recipeTitle);
    await this.page.getByRole("button", { name: new RegExp(recipeTitle, "i") }).first().click();
    await expect(this.page.getByText(/add a meal/i)).toBeHidden();
  }

  async openShoppingDialog() {
    await this.page.getByRole("button", { name: /build shopping list/i }).click();
    await expect(this.page.getByText(/build a shopping list/i)).toBeVisible();
  }

  async confirmBuildList() {
    await this.page.getByRole("button", { name: /^build list$/i }).click();
    await expect(this.page).toHaveURL(/\/shopping/);
  }
}

export class ShoppingPage {
  constructor(private readonly page: Page) {}

  async go() {
    await this.page.goto("/shopping");
  }
}
