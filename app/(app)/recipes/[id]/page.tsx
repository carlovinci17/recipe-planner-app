import { notFound, redirect } from "next/navigation";
import {
  Beef,
  Candy,
  Clock,
  Droplet,
  Edit,
  Flame,
  Grip,
  Leaf,
  Star,
  Users,
  Wheat,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { recipeService } from "@/lib/services/recipe-service";
import { ratingService } from "@/lib/services/rating-service";
import { getRecipePermissions } from "@/lib/services/permissions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { cn, formatMinutes } from "@/lib/utils";
import { FavoriteButton } from "./favorite-button";
import { RecipeGallery } from "@/components/recipes/recipe-gallery";
import { SourcePill } from "@/components/recipes/source-pill";
import { RecipeDates } from "@/components/recipes/recipe-dates";
import { DeleteRecipeButton } from "./delete-recipe-button";
import { RecipeRatings } from "./recipe-ratings";
import { BackLink } from "@/components/ui/back-link";
import { AddToPlannerButton } from "./add-to-planner-button";
import { ScaledIngredients } from "@/components/recipes/scaled-ingredients";

/**
 * One column per nutrient, so the panel is a single row whatever the recipe
 * happens to record. Written out rather than built as `md:grid-cols-${n}`:
 * Tailwind generates classes by scanning the source for literal strings, so an
 * interpolated name produces no CSS at all and the grid silently collapses to
 * one column.
 *
 * In this database 151 recipes carry 5 nutrients, 20 carry 4 (no carbs) and a
 * single one carries all 7 — hence 7 being tight but present rather than
 * wrapped onto a second row.
 */
const NUTRITION_COLS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
  6: "md:grid-cols-6",
  7: "md:grid-cols-7",
};

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let bundle;
  try {
    bundle = await recipeService.getById(id);
  } catch {
    notFound();
  }

  const { recipe, ingredients, instructions } = bundle;
  if (!recipe) notFound();

  // Auto-redirect a draft into the review flow.
  if (recipe.status === "needs_review") redirect(`/recipes/${recipe.id}/review`);

  const totalMin = (recipe.prep_time_min ?? 0) + (recipe.cook_time_min ?? 0);
  const [perms, ratings, currentUser] = await Promise.all([
    getRecipePermissions({
      recipeId: recipe.id,
      recipeCreatedBy: recipe.created_by,
      recipeHouseholdId: recipe.household_id,
    }),
    ratingService.listForRecipe(recipe.id),
    getCurrentUser(),
  ]);
  const plannerEntryCount = perms.canDelete
    ? await recipeService.countPlannerEntries(recipe.id)
    : 0;

  return (
    <div className="container max-w-4xl space-y-6 py-6">
      <BackLink href="/recipes" label="Recipes" />
      <RecipeGallery
        recipe={recipe}
        title={recipe.title}
        heroOverlay={<SourcePill recipe={recipe} variant="overlay" />}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">{recipe.title}</h1>
          {recipe.description ? (
            <p className="mt-1 max-w-2xl text-muted-foreground">{recipe.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <AddToPlannerButton recipeId={recipe.id} householdId={recipe.household_id} />
          <FavoriteButton recipeId={recipe.id} initial={recipe.is_favorite} />
          {perms.canEdit ? (
            <Button variant="outline" asChild>
              <Link href={`/recipes/${recipe.id}/edit`}>
                <Edit className="mr-2 h-4 w-4" /> Edit
              </Link>
            </Button>
          ) : null}
          {perms.canDelete ? (
            <DeleteRecipeButton
              recipeId={recipe.id}
              recipeTitle={recipe.title}
              plannerEntryCount={plannerEntryCount}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        {totalMin > 0 ? (
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4" /> {formatMinutes(totalMin)}
          </span>
        ) : null}
        {recipe.servings ? (
          <span className="flex items-center gap-1">
            <Users className="h-4 w-4" /> Makes {recipe.servings}
          </span>
        ) : null}
        {ratings.length > 0 ? (
          <span className="flex items-center gap-1">
            <Star className="h-4 w-4 fill-current text-amber-500" />
            {(ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)} (
            {ratings.length})
          </span>
        ) : null}
        <SourcePill recipe={recipe} />
      </div>

      <RecipeDates createdAt={recipe.created_at} updatedAt={recipe.updated_at} />

      {(() => {
        // Dedupe across cuisines / meal_types / diet_types / tags — the AI
        // tagger or hand-entry can produce overlap (e.g. "mexican" in both
        // cuisines and tags), which would otherwise cause duplicate React keys.
        const labels = Array.from(
          new Set([...recipe.cuisines, ...recipe.meal_types, ...recipe.diet_types, ...recipe.tags]),
        );
        return labels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {labels.map((t) => (
              <Badge key={t} variant="secondary" className="font-normal">
                {t}
              </Badge>
            ))}
          </div>
        ) : null;
      })()}

      <RecipeRatings
        recipeId={recipe.id}
        ratings={ratings}
        currentUserId={currentUser?.id ?? null}
      />

      {/* Notes sit ABOVE the method: a note is usually something you need to
          know before you start cooking ("halve the chilli", "needs an
          overnight soak"), not an afterthought. Hidden entirely when empty. */}
      {recipe.notes && recipe.notes.trim().length > 0 ? (
        <>
          <Separator />
          <section>
            <h2 className="mb-2 font-display text-lg font-semibold">Notes</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{recipe.notes}</p>
          </section>
        </>
      ) : null}

      <Separator />

      <div className="grid gap-8 md:grid-cols-[280px_1fr]">
        <ScaledIngredients ingredients={ingredients} recipeServings={recipe.servings} />

        <section>
          <h2 className="mb-3 font-display text-lg font-semibold">Instructions</h2>
          <ol className="space-y-4 text-sm">
            {instructions.map((step, idx) => (
              <li key={step.id} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent font-medium text-accent-foreground">
                  {idx + 1}
                </span>
                <span className="leading-relaxed">{step.text}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {(() => {
        const n = (recipe.nutrition ?? {}) as Record<string, number | null>;
        // Icon per nutrient so the row is scannable at a glance rather than a
        // wall of numbers. Sodium uses Grip — the dot grid reads as salt grains.
        const fields = [
          { key: "calories", label: "Calories", unit: "kcal", Icon: Flame },
          { key: "protein_g", label: "Protein", unit: "g", Icon: Beef },
          { key: "carbs_g", label: "Carbs", unit: "g", Icon: Wheat },
          { key: "fat_g", label: "Fat", unit: "g", Icon: Droplet },
          { key: "fiber_g", label: "Fiber", unit: "g", Icon: Leaf },
          { key: "sugar_g", label: "Sugar", unit: "g", Icon: Candy },
          { key: "sodium_mg", label: "Sodium", unit: "mg", Icon: Grip },
        ];
        const present = fields.filter((f) => typeof n[f.key] === "number" && n[f.key] !== null);
        if (present.length === 0) return null;
        return (
          <>
            <Separator />
            <section>
              <h2 className="mb-3 font-display text-lg font-semibold">
                Nutrition{" "}
                <span className="text-sm font-normal text-muted-foreground">(per serving)</span>
              </h2>
              {/* Two presentations of the same markup.
                  Phone / small tablet: a plain list — label left, value right,
                  no boxes. Seven bordered tiles two-up is a wall of cards on a
                  narrow screen, and the numbers stop lining up.
                  md and wider: one row of tiles, one column per nutrient, so
                  the whole panel reads at a glance. The column count follows
                  the data (5 for almost every recipe here, 4 when carbs are
                  missing) instead of being fixed, which is what forced a
                  second row before. md rather than sm so a 640px tablet gets
                  the list, not five squashed columns. */}
              <div
                className={cn(
                  "flex flex-col divide-y md:grid md:gap-3 md:divide-y-0",
                  NUTRITION_COLS[present.length] ?? "md:grid-cols-5",
                )}
              >
                {present.map((f) => (
                  <div
                    key={f.key}
                    className="flex items-center justify-between gap-3 py-2 md:flex-col md:items-center md:justify-center md:gap-0 md:rounded-lg md:border md:bg-card md:p-3 md:text-center"
                  >
                    <span className="flex items-center gap-2 text-xs text-muted-foreground md:flex-col md:gap-0">
                      <f.Icon className="h-3.5 w-3.5 shrink-0 md:mb-1 md:h-4 md:w-4" aria-hidden />
                      <span>{f.label}</span>
                    </span>
                    <span className="text-sm font-medium tabular-nums md:font-display md:text-lg md:font-semibold">
                      {n[f.key]}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {f.unit}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        );
      })()}
    </div>
  );
}
