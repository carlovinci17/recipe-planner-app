import { notFound } from "next/navigation";
import { recipeService } from "@/lib/services/recipe-service";
import { getRecipePermissions } from "@/lib/services/permissions";
import { logger } from "@/lib/logger";
import { ReviewForm } from "./review-form";
import { BackLink } from "@/components/ui/back-link";

export const metadata = { title: "Review recipe" };

export default async function RecipeReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let bundle;
  try {
    bundle = await recipeService.getById(id);
  } catch {
    notFound();
  }
  if (!bundle.recipe) notFound();

  const perms = await getRecipePermissions({
    recipeId: bundle.recipe.id,
    recipeCreatedBy: bundle.recipe.created_by,
    recipeHouseholdId: bundle.recipe.household_id,
  });
  const plannerEntryCount = perms.canDelete
    ? await recipeService.countPlannerEntries(bundle.recipe.id)
    : 0;

  // Published recipes in the same household with the same title — catches the
  // common case where one recipe is extracted from two different files.
  let duplicates: Array<{ id: string; title: string }> = [];
  try {
    duplicates = await recipeService.findPublishedDuplicates({
      householdId: bundle.recipe.household_id,
      title: bundle.recipe.title,
      excludeRecipeId: bundle.recipe.id,
    });
  } catch (err) {
    logger.error({ err }, "review page: duplicate lookup failed");
  }

  // The /review route is shared between AI-extracted recipes (PDF/image/URL/Drive)
  // and freshly-created blank ones from /recipes/new. Different headings keep
  // the framing right.
  const isManualBlank = bundle.recipe.source_kind === "manual";
  const heading = isManualBlank ? "New recipe" : "Review extracted recipe";
  const description = isManualBlank
    ? "Fill in your recipe and save it to your library."
    : "We pulled this from your file. Edit anything that looks off, then save it to your library.";

  return (
    <div className="container max-w-5xl space-y-6 py-6">
      {/* A needs_review recipe's detail page redirects straight back here, so
          "back to recipe" would loop. Send the user to the library instead. */}
      <BackLink href="/recipes" label="Back to recipes" />
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold">{heading}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <ReviewForm
        recipe={bundle.recipe}
        ingredients={bundle.ingredients}
        instructions={bundle.instructions}
        canDelete={perms.canDelete}
        plannerEntryCount={plannerEntryCount}
        duplicates={duplicates ?? []}
      />
    </div>
  );
}
