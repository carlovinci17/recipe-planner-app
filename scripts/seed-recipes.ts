/**
 * Seed 5 example recipes (with images) into a household.
 *
 * Usage:
 *   npx tsx scripts/seed-recipes.ts <household_id>
 *
 * Or, if you don't pass a household_id, the script picks the first household
 * the service-role client can see and uses that.
 *
 * Idempotent: skips recipes whose title already exists in the household.
 *
 * Images come from loremflickr.com (Flickr CC pool) via deterministic seeds,
 * downloaded once and uploaded to the `recipe-images` bucket. They're food-
 * adjacent but not necessarily exact matches — swap via the UI if it matters.
 */
import { config as dotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Aborting.",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ────────────────────────────────────────────────────────────
// Recipe definitions
// ────────────────────────────────────────────────────────────
type SeedIngredient = {
  raw_text: string;
  quantity?: number | null;
  unit?: string | null;
  ingredient?: string | null;
  notes?: string | null;
  optional?: boolean;
  section?: string | null;
};

type SeedInstruction = {
  text: string;
  duration_min?: number | null;
  section?: string | null;
};

type SeedRecipe = {
  title: string;
  description: string;
  servings: number;
  prep_time_min: number;
  cook_time_min: number;
  cuisines: string[];
  meal_types: string[];
  diet_types: string[];
  cooking_methods: string[];
  difficulty: "easy" | "medium" | "hard";
  occasions: string[];
  tags: string[];
  rating: number;
  nutrition: Record<string, number>;
  imageQuery: string;
  imageSeed: number;
  ingredients: SeedIngredient[];
  instructions: SeedInstruction[];
};

const RECIPES: SeedRecipe[] = [
  {
    title: "Spaghetti Carbonara",
    description:
      "The classic Roman pasta — eggs, pecorino, guanciale, and black pepper. No cream, ever. Move quickly when the pasta hits the pan; the residual heat cooks the eggs into a silky sauce.",
    servings: 4,
    prep_time_min: 10,
    cook_time_min: 15,
    cuisines: ["italian"],
    meal_types: ["dinner"],
    diet_types: [],
    cooking_methods: ["stovetop"],
    difficulty: "medium",
    occasions: ["weeknight", "comfort-food"],
    tags: ["pasta", "eggs", "comfort-food", "30-minute"],
    rating: 5,
    nutrition: { calories: 620, protein_g: 28, carbs_g: 65, fat_g: 26, sodium_mg: 980 },
    imageQuery: "pasta+carbonara",
    imageSeed: 11,
    ingredients: [
      { raw_text: "400g spaghetti", quantity: 400, unit: "g", ingredient: "spaghetti" },
      {
        raw_text: "200g guanciale, cut into 1cm strips",
        quantity: 200,
        unit: "g",
        ingredient: "guanciale",
        notes: "cut into 1cm strips",
      },
      { raw_text: "4 large egg yolks", quantity: 4, unit: null, ingredient: "egg yolks" },
      { raw_text: "1 whole large egg", quantity: 1, unit: null, ingredient: "egg" },
      {
        raw_text: "80g pecorino romano, finely grated",
        quantity: 80,
        unit: "g",
        ingredient: "pecorino romano",
        notes: "finely grated",
      },
      {
        raw_text: "1 tsp freshly ground black pepper, plus more to serve",
        quantity: 1,
        unit: "tsp",
        ingredient: "black pepper",
        notes: "freshly ground",
      },
      { raw_text: "Sea salt for the pasta water", ingredient: "sea salt" },
    ],
    instructions: [
      {
        text: "Bring a large pot of well-salted water to a rolling boil. Drop the spaghetti and cook 2 minutes shy of the package time.",
      },
      {
        text: "While the pasta cooks, render the guanciale in a wide cold skillet over medium heat. It'll take 7–9 minutes to crisp without burning. Remove from heat once golden.",
        duration_min: 9,
      },
      {
        text: "Whisk the yolks, whole egg, pecorino, and black pepper in a bowl until smooth. The mixture should look like a thick paste.",
      },
      {
        text: "Reserve a mug of pasta water. Drain the pasta and immediately tip it into the (off-heat) skillet with the guanciale. Toss to coat in the rendered fat.",
      },
      {
        text: "Add 2 tablespoons of pasta water to the egg mixture and whisk to temper. Pour over the pasta, tossing constantly. The sauce will thicken to a glossy coat — add splashes of pasta water if it tightens too far.",
        duration_min: 1,
      },
      {
        text: "Plate immediately, top with extra pecorino and a generous crack of black pepper. Eat right away.",
      },
    ],
  },
  {
    title: "Thai Green Curry with Chicken",
    description:
      "A bright, fragrant curry that comes together in under 30 minutes once your prep is done. Use a good Thai green curry paste — Maesri or Mae Ploy — and full-fat coconut milk.",
    servings: 4,
    prep_time_min: 15,
    cook_time_min: 20,
    cuisines: ["thai"],
    meal_types: ["dinner"],
    diet_types: ["dairy-free", "gluten-free"],
    cooking_methods: ["stovetop"],
    difficulty: "easy",
    occasions: ["weeknight"],
    tags: ["curry", "chicken", "spicy", "weeknight", "one-pot"],
    rating: 5,
    nutrition: { calories: 540, protein_g: 38, carbs_g: 18, fat_g: 36, sodium_mg: 1100 },
    imageQuery: "thai+green+curry",
    imageSeed: 22,
    ingredients: [
      {
        raw_text: "600g boneless chicken thighs, cut into bite-sized pieces",
        quantity: 600,
        unit: "g",
        ingredient: "chicken thighs",
        notes: "boneless, bite-sized",
      },
      {
        raw_text: "3 tbsp Thai green curry paste",
        quantity: 3,
        unit: "tbsp",
        ingredient: "thai green curry paste",
      },
      {
        raw_text: "1 can (400ml) full-fat coconut milk",
        quantity: 400,
        unit: "ml",
        ingredient: "coconut milk",
        notes: "full-fat",
      },
      { raw_text: "1 tbsp fish sauce", quantity: 1, unit: "tbsp", ingredient: "fish sauce" },
      { raw_text: "2 tsp brown sugar", quantity: 2, unit: "tsp", ingredient: "brown sugar" },
      {
        raw_text: "1 small Thai eggplant, cubed (or 1 zucchini)",
        quantity: 1,
        unit: null,
        ingredient: "thai eggplant",
        notes: "or zucchini",
      },
      {
        raw_text: "1 red bell pepper, sliced",
        quantity: 1,
        unit: null,
        ingredient: "red bell pepper",
        notes: "sliced",
      },
      {
        raw_text: "Handful of Thai basil leaves",
        ingredient: "thai basil",
      },
      {
        raw_text: "1 lime, cut into wedges",
        quantity: 1,
        unit: null,
        ingredient: "lime",
        notes: "cut into wedges",
      },
      { raw_text: "Cooked jasmine rice, to serve", ingredient: "jasmine rice" },
    ],
    instructions: [
      {
        text: "Open the coconut milk without shaking. Spoon the thick cream from the top into a wide pan over medium-high heat. Cook for 2 minutes until the oil starts to separate.",
        duration_min: 2,
      },
      {
        text: "Add the curry paste and stir-fry for 1–2 minutes until deeply fragrant. Don't skip this step — it's where the flavour blooms.",
        duration_min: 2,
      },
      {
        text: "Add the chicken and stir to coat. Cook for 4 minutes, turning to seal all sides.",
        duration_min: 4,
      },
      {
        text: "Pour in the rest of the coconut milk plus 100ml water. Add the fish sauce and sugar. Bring to a gentle simmer.",
      },
      {
        text: "Add the eggplant and pepper. Simmer uncovered for 12–15 minutes until the chicken is cooked through and vegetables are tender.",
        duration_min: 14,
      },
      {
        text: "Tear in the basil leaves. Taste and adjust — more fish sauce for salt, more sugar to balance the heat. Serve over jasmine rice with lime wedges.",
      },
    ],
  },
  {
    title: "Fluffy Banana Pancakes",
    description:
      "Tender, just-sweet-enough pancakes that use up brown bananas. Kid-friendly, freezer-friendly, and forgiving — even a half-asleep cook can nail these.",
    servings: 4,
    prep_time_min: 10,
    cook_time_min: 15,
    cuisines: ["american"],
    meal_types: ["breakfast", "brunch"],
    diet_types: ["vegetarian"],
    cooking_methods: ["stovetop"],
    difficulty: "easy",
    occasions: ["weekend", "kid-friendly"],
    tags: ["pancakes", "banana", "breakfast", "kid-friendly", "easy"],
    rating: 4,
    nutrition: { calories: 340, protein_g: 9, carbs_g: 56, fat_g: 9, sugar_g: 18 },
    imageQuery: "pancakes+breakfast",
    imageSeed: 33,
    ingredients: [
      {
        raw_text: "2 ripe bananas, mashed (about 1 cup)",
        quantity: 2,
        unit: null,
        ingredient: "bananas",
        notes: "ripe, mashed",
      },
      { raw_text: "2 large eggs", quantity: 2, unit: null, ingredient: "eggs" },
      { raw_text: "1 cup milk", quantity: 1, unit: "cup", ingredient: "milk" },
      {
        raw_text: "1 tsp vanilla extract",
        quantity: 1,
        unit: "tsp",
        ingredient: "vanilla extract",
      },
      {
        raw_text: "1.5 cups all-purpose flour",
        quantity: 1.5,
        unit: "cup",
        ingredient: "all-purpose flour",
      },
      {
        raw_text: "2 tsp baking powder",
        quantity: 2,
        unit: "tsp",
        ingredient: "baking powder",
      },
      {
        raw_text: "2 tbsp sugar",
        quantity: 2,
        unit: "tbsp",
        ingredient: "sugar",
      },
      { raw_text: "0.5 tsp salt", quantity: 0.5, unit: "tsp", ingredient: "salt" },
      {
        raw_text: "Butter for the pan",
        ingredient: "butter",
      },
      {
        raw_text: "Maple syrup, to serve",
        ingredient: "maple syrup",
        optional: true,
      },
    ],
    instructions: [
      {
        text: "In a large bowl, mash the bananas. Whisk in the eggs, milk, and vanilla until smooth-ish (a few banana lumps are fine).",
      },
      {
        text: "In a separate bowl, whisk flour, baking powder, sugar, and salt.",
      },
      {
        text: "Pour the dry mix into the wet and fold gently with a spatula. Stop when no flour streaks remain — overmixing makes tough pancakes. The batter should be thick.",
      },
      {
        text: "Heat a non-stick pan over medium-low heat. Melt a small knob of butter. Use a 1/4 cup measure to drop batter into the pan.",
      },
      {
        text: "Cook 2–3 minutes per side. Flip when bubbles rise to the surface and the edges look set. The second side cooks faster.",
        duration_min: 5,
      },
      {
        text: "Stack and serve immediately with maple syrup. To freeze leftovers, layer between baking paper in a freezer bag — reheat in the toaster.",
      },
    ],
  },
  {
    title: "Mediterranean Chickpea Salad",
    description:
      "A zingy, no-cook lunch that gets better as it sits. Pack it for work, eat it cold straight from the fridge, or scoop it onto warm pita.",
    servings: 4,
    prep_time_min: 15,
    cook_time_min: 0,
    cuisines: ["mediterranean"],
    meal_types: ["lunch"],
    diet_types: ["vegan", "vegetarian", "dairy-free"],
    cooking_methods: ["no-cook"],
    difficulty: "easy",
    occasions: ["meal-prep", "healthy"],
    tags: ["salad", "chickpeas", "no-cook", "meal-prep", "vegan", "10-minute"],
    rating: 4,
    nutrition: { calories: 280, protein_g: 11, carbs_g: 38, fat_g: 11, fiber_g: 9 },
    imageQuery: "chickpea+salad+mediterranean",
    imageSeed: 44,
    ingredients: [
      {
        raw_text: "2 cans (15oz each) chickpeas, drained and rinsed",
        quantity: 2,
        unit: null,
        ingredient: "chickpeas",
        notes: "canned, drained and rinsed",
      },
      {
        raw_text: "1 cucumber, diced",
        quantity: 1,
        unit: null,
        ingredient: "cucumber",
        notes: "diced",
      },
      {
        raw_text: "2 cups cherry tomatoes, halved",
        quantity: 2,
        unit: "cup",
        ingredient: "cherry tomatoes",
        notes: "halved",
      },
      {
        raw_text: "0.5 red onion, finely diced",
        quantity: 0.5,
        unit: null,
        ingredient: "red onion",
        notes: "finely diced",
      },
      {
        raw_text: "0.5 cup kalamata olives, pitted and halved",
        quantity: 0.5,
        unit: "cup",
        ingredient: "kalamata olives",
        notes: "pitted and halved",
      },
      {
        raw_text: "1 cup parsley, roughly chopped",
        quantity: 1,
        unit: "cup",
        ingredient: "parsley",
        notes: "roughly chopped",
      },
      {
        raw_text: "1/4 cup extra virgin olive oil",
        quantity: 0.25,
        unit: "cup",
        ingredient: "olive oil",
        notes: "extra virgin",
      },
      {
        raw_text: "Juice of 1 lemon",
        quantity: 1,
        unit: null,
        ingredient: "lemon",
        notes: "juiced",
      },
      {
        raw_text: "1 tsp dried oregano",
        quantity: 1,
        unit: "tsp",
        ingredient: "dried oregano",
      },
      {
        raw_text: "Salt and pepper to taste",
        ingredient: "salt and pepper",
      },
      {
        raw_text: "100g feta cheese, crumbled",
        quantity: 100,
        unit: "g",
        ingredient: "feta cheese",
        notes: "crumbled",
        optional: true,
      },
    ],
    instructions: [
      {
        text: "In a large bowl, combine the chickpeas, cucumber, tomatoes, onion, olives, and parsley.",
      },
      {
        text: "In a small jar, whisk olive oil, lemon juice, oregano, salt, and pepper. Taste — it should be assertively lemony and salted; the chickpeas dilute the dressing.",
      },
      {
        text: "Pour the dressing over the salad and toss. Let it sit for at least 10 minutes — it improves dramatically as the chickpeas absorb the dressing.",
        duration_min: 10,
      },
      {
        text: "Just before serving, scatter the feta on top (skip for vegan). Serve cold or at room temperature with pita, on greens, or on its own.",
      },
    ],
  },
  {
    title: "Weeknight Beef Tacos",
    description:
      "Crowd-pleasing tacos that come together in 25 minutes. Build a taco bar and let everyone load their own. Doubles easily.",
    servings: 4,
    prep_time_min: 10,
    cook_time_min: 15,
    cuisines: ["mexican"],
    meal_types: ["dinner"],
    diet_types: ["dairy-free"],
    cooking_methods: ["stovetop"],
    difficulty: "easy",
    occasions: ["weeknight", "kid-friendly"],
    tags: ["tacos", "beef", "weeknight", "kid-friendly", "30-minute"],
    rating: 4,
    nutrition: { calories: 480, protein_g: 28, carbs_g: 36, fat_g: 22, sodium_mg: 720 },
    imageQuery: "beef+tacos",
    imageSeed: 55,
    ingredients: [
      {
        raw_text: "500g ground beef (80/20)",
        quantity: 500,
        unit: "g",
        ingredient: "ground beef",
        notes: "80/20",
      },
      {
        raw_text: "1 small yellow onion, diced",
        quantity: 1,
        unit: null,
        ingredient: "yellow onion",
        notes: "diced",
      },
      {
        raw_text: "3 garlic cloves, minced",
        quantity: 3,
        unit: "clove",
        ingredient: "garlic",
        notes: "minced",
      },
      {
        raw_text: "2 tbsp tomato paste",
        quantity: 2,
        unit: "tbsp",
        ingredient: "tomato paste",
      },
      {
        raw_text: "1 tbsp chili powder",
        quantity: 1,
        unit: "tbsp",
        ingredient: "chili powder",
      },
      { raw_text: "1 tsp cumin", quantity: 1, unit: "tsp", ingredient: "cumin" },
      { raw_text: "1 tsp smoked paprika", quantity: 1, unit: "tsp", ingredient: "smoked paprika" },
      { raw_text: "0.5 tsp salt", quantity: 0.5, unit: "tsp", ingredient: "salt" },
      {
        raw_text: "12 small corn or flour tortillas, warmed",
        quantity: 12,
        unit: null,
        ingredient: "tortillas",
        notes: "small, warmed",
      },
      {
        raw_text: "Toppings: shredded lettuce, diced tomato, lime wedges, hot sauce, chopped cilantro, avocado",
        ingredient: "taco toppings",
      },
    ],
    instructions: [
      {
        text: "Heat a wide skillet over medium-high. Add the beef and break up with a wooden spoon. Cook 5–6 minutes until no pink remains. Drain off excess fat (leave about a tablespoon).",
        duration_min: 6,
      },
      {
        text: "Add the onion and cook 3 minutes until soft. Stir in the garlic and tomato paste; cook 1 minute until the paste darkens slightly.",
        duration_min: 4,
      },
      {
        text: "Sprinkle in the chili powder, cumin, smoked paprika, and salt. Stir to coat the beef. Add 1/3 cup water and simmer 3–4 minutes until the sauce clings to the meat.",
        duration_min: 4,
      },
      {
        text: "Warm the tortillas in a dry skillet, 30 seconds per side. Stack between a clean tea towel to keep warm.",
        duration_min: 2,
      },
      {
        text: "Assemble: a heaping spoon of beef, then toppings of choice. Squeeze of lime over the top. Eat over a plate — they will leak.",
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────
async function fetchImage(query: string, seed: number): Promise<Buffer> {
  // Deterministic via `lock` param so the same seed returns the same image
  // each run. ~150–300KB JPEGs.
  const url = `https://loremflickr.com/1200/800/${query}?lock=${seed}`;
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "RecipeSeeder/1.0" },
  });
  if (!res.ok) throw new Error(`Image fetch failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function resolveTargetHousehold(argHouseholdId: string | undefined) {
  if (argHouseholdId) {
    const { data, error } = await admin
      .from("households")
      .select("id, name")
      .eq("id", argHouseholdId)
      .single();
    if (error || !data) throw new Error(`Household ${argHouseholdId} not found`);
    return data;
  }
  // No arg — pick the first one we can see
  const { data, error } = await admin
    .from("households")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      "No households found. Create one in the app first, then re-run.",
    );
  }
  return data;
}

async function findOwner(householdId: string): Promise<string> {
  const { data, error } = await admin
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId)
    .eq("role", "owner")
    .limit(1)
    .single();
  if (error || !data) throw new Error(`No owner for household ${householdId}`);
  return data.user_id;
}

async function seedRecipe(householdId: string, ownerId: string, r: SeedRecipe) {
  // Skip if a recipe with the same title already exists in this household
  const { data: existing } = await admin
    .from("recipes")
    .select("id")
    .eq("household_id", householdId)
    .eq("title", r.title)
    .maybeSingle();
  if (existing) {
    console.log(`  ↷ "${r.title}" already exists, skipping`);
    return;
  }

  // 1. Insert the recipe
  const { data: recipe, error } = await admin
    .from("recipes")
    .insert({
      household_id: householdId,
      created_by: ownerId,
      title: r.title,
      description: r.description,
      servings: r.servings,
      prep_time_min: r.prep_time_min,
      cook_time_min: r.cook_time_min,
      cuisines: r.cuisines,
      meal_types: r.meal_types,
      diet_types: r.diet_types,
      cooking_methods: r.cooking_methods,
      difficulty: r.difficulty,
      occasions: r.occasions,
      tags: r.tags,
      rating: r.rating,
      nutrition: r.nutrition,
      source_kind: "manual",
      ai_metadata: { seeded: true, source: "scripts/seed-recipes.ts" },
      status: "published",
    })
    .select("id")
    .single();
  if (error || !recipe) throw new Error(`Insert failed for ${r.title}: ${error?.message}`);

  console.log(`  + ${r.title} (id=${recipe.id})`);

  // 2. Download + upload the cover image
  try {
    const buffer = await fetchImage(r.imageQuery, r.imageSeed);
    const path = `${householdId}/${recipe.id}/cover.jpg`;
    const { error: upErr } = await admin.storage
      .from("recipe-images")
      .upload(path, buffer, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw upErr;
    await admin
      .from("recipes")
      .update({ image_paths: [path] })
      .eq("id", recipe.id);
    console.log(`    ↳ image uploaded to ${path}`);
  } catch (err) {
    console.warn(`    ⚠ image fetch/upload failed: ${(err as Error).message}`);
    // Continue anyway — the recipe still works without an image
  }

  // 3. Ingredients
  await admin.from("recipe_ingredients").insert(
    r.ingredients.map((ing, i) => ({
      recipe_id: recipe.id,
      position: i,
      raw_text: ing.raw_text,
      quantity: ing.quantity ?? null,
      unit: ing.unit ?? null,
      ingredient: ing.ingredient ?? null,
      notes: ing.notes ?? null,
      optional: ing.optional ?? false,
      section: ing.section ?? null,
    })),
  );

  // 4. Instructions
  await admin.from("recipe_instructions").insert(
    r.instructions.map((step, i) => ({
      recipe_id: recipe.id,
      position: i,
      text: step.text,
      duration_min: step.duration_min ?? null,
      section: step.section ?? null,
    })),
  );
}

async function main() {
  const arg = process.argv[2];
  const household = await resolveTargetHousehold(arg);
  console.log(`Seeding into household: ${household.name} (${household.id})`);
  const ownerId = await findOwner(household.id);

  for (const recipe of RECIPES) {
    await seedRecipe(household.id, ownerId, recipe);
  }

  console.log(`\nDone. ${RECIPES.length} recipes processed.`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
