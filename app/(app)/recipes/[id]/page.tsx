import { notFound, redirect } from "next/navigation";
import { Clock, Edit, Star, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { recipeService } from "@/lib/services/recipe-service";
import { ratingService } from "@/lib/services/rating-service";
import { getRecipePermissions } from "@/lib/services/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatMinutes } from "@/lib/utils";
import { FavoriteButton } from "./favorite-button";
import { RecipeGallery } from "@/components/recipes/recipe-gallery";
import { SourcePill } from "@/components/recipes/source-pill";
import { DeleteRecipeButton } from "./delete-recipe-button";
import { RecipeRatings } from "./recipe-ratings";

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
  const perms = await getRecipePermissions({
    recipeId: recipe.id,
    recipeCreatedBy: recipe.created_by,
    recipeHouseholdId: recipe.household_id,
  });
  const plannerEntryCount = perms.canDelete
    ? await recipeService.countPlannerEntries(recipe.id)
    : 0;

  // Per-user ratings — load alongside the recipe so the panel renders
  // server-side. Realtime keeps it fresh when household-mates rate.
  const [ratings, currentUser] = await Promise.all([
    ratingService.listForRecipe(recipe.id),
    (async () => {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    })(),
  ]);

  return (
    <div className="container max-w-4xl space-y-6 py-6">
      <RecipeGallery
        recipe={recipe}
        title={recipe.title}
        heroOverlay={<SourcePill recipe={recipe} variant="overlay" />}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">{recipe.title}</h1>
          {recipe.description ? (
            <p className="mt-1 max-w-2xl text-muted-foreground">{recipe.description}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
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
            <Users className="h-4 w-4" /> {recipe.servings} servings
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

      {(() => {
        // Dedupe across cuisines / meal_types / diet_types / tags — the AI
        // tagger or hand-entry can produce overlap (e.g. "mexican" in both
        // cuisines and tags), which would otherwise cause duplicate React keys.
        const labels = Array.from(
          new Set([
            ...recipe.cuisines,
            ...recipe.meal_types,
            ...recipe.diet_types,
            ...recipe.tags,
          ]),
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

      <Separator />

      <div className="grid gap-8 md:grid-cols-[280px_1fr]">
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold">Ingredients</h2>
          <ul className="space-y-2 text-sm">
            {ingredients.map((ing) => (
              <li key={ing.id} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{ing.raw_text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-display text-lg font-semibold">Instructions</h2>
          <ol className="space-y-4 text-sm">
            {instructions.map((step, idx) => (
              <li key={step.id} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground font-medium">
                  {idx + 1}
                </span>
                <span className="leading-relaxed">{step.text}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {recipe.notes ? (
        <>
          <Separator />
          <section>
            <h2 className="mb-2 font-display text-lg font-semibold">Notes</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{recipe.notes}</p>
          </section>
        </>
      ) : null}
    </div>
  );
}
