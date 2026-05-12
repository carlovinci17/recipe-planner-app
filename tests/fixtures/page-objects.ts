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
  }
}

export class OnboardingPage {
  constructor(private readonly page: Page) {}

  async createHousehold(name: string) {
    await expect(this.page).toHaveURL(/\/onboarding/);
    await this.page.getByLabel(/household name/i).fill(name);
    await this.page.getByRole("button", { name: /create household/i }).click();
    await expect(this.page).toHaveURL(/\/dashboard/);
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
