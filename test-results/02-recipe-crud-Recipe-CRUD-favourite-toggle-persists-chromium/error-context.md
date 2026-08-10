# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 02-recipe-crud.spec.ts >> Recipe CRUD >> favourite toggle persists
- Location: tests/e2e/02-recipe-crud.spec.ts:57:7

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/dashboard/
Received string:  "http://localhost:3000/recipes"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    6 × unexpected value "http://localhost:3000/onboarding"
    3 × unexpected value "http://localhost:3000/recipes"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - link "BiteBuddy" [ref=e5] [cursor=pointer]:
        - /url: /recipes
        - img [ref=e6]
        - text: BiteBuddy
      - button "TU" [ref=e7] [cursor=pointer]:
        - generic [ref=e9]: TU
    - generic [ref=e10]:
      - complementary [ref=e11]:
        - navigation [ref=e12]:
          - link "Recipes" [ref=e13] [cursor=pointer]:
            - /url: /recipes
            - img [ref=e14]
            - text: Recipes
          - link "Planner" [ref=e16] [cursor=pointer]:
            - /url: /planner
            - img [ref=e17]
            - text: Planner
          - link "Shopping" [ref=e19] [cursor=pointer]:
            - /url: /shopping
            - img [ref=e20]
            - text: Shopping
          - link "Import" [ref=e26] [cursor=pointer]:
            - /url: /recipes/import
            - img [ref=e27]
            - text: Import
        - paragraph [ref=e31]: v0.1.0
      - main [ref=e32]:
        - generic [ref=e33]:
          - generic [ref=e34]:
            - heading "Recipes" [level=1] [ref=e35]
            - paragraph [ref=e36]: 0 in your household
          - generic [ref=e37]:
            - generic [ref=e38]:
              - img
              - textbox "Search recipes, ingredients, descriptions…" [ref=e39]
            - generic [ref=e40]:
              - generic [ref=e42]:
                - button "All" [ref=e43] [cursor=pointer]
                - button "breakfast" [ref=e44] [cursor=pointer]
                - button "lunch" [ref=e45] [cursor=pointer]
                - button "dinner" [ref=e46] [cursor=pointer]
                - button "snack" [ref=e47] [cursor=pointer]
                - button "dessert" [ref=e48] [cursor=pointer]
              - generic [ref=e49]:
                - button "Favourites" [ref=e50] [cursor=pointer]:
                  - img [ref=e51]
                  - text: Favourites
                - button "Diet" [ref=e53] [cursor=pointer]:
                  - text: Diet
                  - img [ref=e54]
                - button "Cuisine" [disabled]:
                  - text: Cuisine
                  - img
                - button "Tags" [disabled]:
                  - text: Tags
                  - img
                - button "Source" [disabled]:
                  - text: Source
                  - img
            - generic [ref=e56]:
              - generic [ref=e57]: 0 of 0 recipes
              - button "Select" [ref=e59] [cursor=pointer]:
                - img [ref=e60]
                - text: Select
            - generic [ref=e63]:
              - generic [ref=e64]: No matching recipes
              - paragraph [ref=e65]: Try clearing filters, or import your first recipe.
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=e71] [cursor=pointer]:
    - img [ref=e72]
  - alert [ref=e75]: Recipes · BiteBuddy
```

# Test source

```ts
  1   | import type { Page } from "@playwright/test";
  2   | import { expect } from "@playwright/test";
  3   | 
  4   | /**
  5   |  * Page Object Models — keep selector logic here so spec files stay readable.
  6   |  * Each method does one user-visible thing and ends in a state assertion.
  7   |  */
  8   | 
  9   | export class LoginPage {
  10  |   constructor(private readonly page: Page) {}
  11  | 
  12  |   async go() {
  13  |     await this.page.goto("/login");
  14  |     await expect(this.page.getByLabel("Email")).toBeVisible();
  15  |   }
  16  | 
  17  |   async loginWithPassword(email: string, password: string) {
  18  |     await this.page.getByLabel("Email").fill(email);
  19  |     await this.page.getByLabel("Password").fill(password);
  20  |     await this.page.getByRole("button", { name: /^log in$/i }).click();
  21  |   }
  22  | }
  23  | 
  24  | export class OnboardingPage {
  25  |   constructor(private readonly page: Page) {}
  26  | 
  27  |   async createHousehold(name: string) {
  28  |     await expect(this.page).toHaveURL(/\/onboarding/);
  29  |     await this.page.getByLabel(/household name/i).fill(name);
  30  |     await this.page.getByRole("button", { name: /create household/i }).click();
> 31  |     await expect(this.page).toHaveURL(/\/dashboard/);
      |                             ^ Error: expect(page).toHaveURL(expected) failed
  32  |   }
  33  | }
  34  | 
  35  | export class RecipesPage {
  36  |   constructor(private readonly page: Page) {}
  37  | 
  38  |   async go() {
  39  |     await this.page.goto("/recipes");
  40  |   }
  41  | 
  42  |   async openImport() {
  43  |     await this.page.goto("/recipes/import");
  44  |     await expect(this.page.getByRole("heading", { name: /import a recipe/i })).toBeVisible();
  45  |   }
  46  | 
  47  |   async createManual() {
  48  |     // /recipes/new redirects to the review form for a draft recipe
  49  |     await this.page.goto("/recipes/new");
  50  |     await expect(this.page).toHaveURL(/\/recipes\/.+\/review/);
  51  |   }
  52  | 
  53  |   async fillReviewForm(args: {
  54  |     title: string;
  55  |     description?: string;
  56  |     servings?: number;
  57  |     ingredients?: string[];
  58  |     instructions?: string[];
  59  |   }) {
  60  |     const titleInput = this.page.getByLabel("Title");
  61  |     await titleInput.fill(args.title);
  62  |     if (args.description) {
  63  |       await this.page.getByLabel("Description").fill(args.description);
  64  |     }
  65  |     if (args.servings) {
  66  |       await this.page.getByLabel("Servings").fill(String(args.servings));
  67  |     }
  68  |     for (const ing of args.ingredients ?? []) {
  69  |       await this.page
  70  |         .getByRole("button", { name: /^add$/i })
  71  |         .first()
  72  |         .click();
  73  |       const inputs = this.page.locator('input[placeholder*="1 cup flour"]');
  74  |       await inputs.last().fill(ing);
  75  |     }
  76  |     for (const step of args.instructions ?? []) {
  77  |       const buttons = this.page.getByRole("button", { name: /^add$/i });
  78  |       await buttons.nth(1).click();
  79  |       const textareas = this.page.locator("textarea");
  80  |       await textareas.last().fill(step);
  81  |     }
  82  |   }
  83  | 
  84  |   async save() {
  85  |     await this.page.getByRole("button", { name: /save recipe/i }).click();
  86  |     await expect(this.page).toHaveURL(/\/recipes\/[^/]+$/, { timeout: 15_000 });
  87  |   }
  88  | }
  89  | 
  90  | export class PlannerPage {
  91  |   constructor(private readonly page: Page) {}
  92  | 
  93  |   async go() {
  94  |     await this.page.goto("/planner");
  95  |     await expect(this.page.getByRole("heading", { name: /weekly planner/i })).toBeVisible();
  96  |   }
  97  | 
  98  |   async addEntryToFirstCell(recipeTitle: string) {
  99  |     // First "Add" button under the planner grid (top-left cell)
  100 |     const addButtons = this.page.getByRole("button", { name: /^add$/i });
  101 |     await addButtons.first().click();
  102 |     await expect(this.page.getByText(/add a meal/i)).toBeVisible();
  103 | 
  104 |     await this.page.getByPlaceholder(/search your recipes/i).fill(recipeTitle);
  105 |     await this.page.getByRole("button", { name: new RegExp(recipeTitle, "i") }).first().click();
  106 |     await expect(this.page.getByText(/add a meal/i)).toBeHidden();
  107 |   }
  108 | 
  109 |   async openShoppingDialog() {
  110 |     await this.page.getByRole("button", { name: /build shopping list/i }).click();
  111 |     await expect(this.page.getByText(/build a shopping list/i)).toBeVisible();
  112 |   }
  113 | 
  114 |   async confirmBuildList() {
  115 |     await this.page.getByRole("button", { name: /^build list$/i }).click();
  116 |     await expect(this.page).toHaveURL(/\/shopping/);
  117 |   }
  118 | }
  119 | 
  120 | export class ShoppingPage {
  121 |   constructor(private readonly page: Page) {}
  122 | 
  123 |   async go() {
  124 |     await this.page.goto("/shopping");
  125 |   }
  126 | }
  127 | 
```