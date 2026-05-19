import { getActiveHousehold } from "@/lib/services/active-household";
import { householdService } from "@/lib/services/household-service";
import { ratingService } from "@/lib/services/rating-service";
import { recipeService } from "@/lib/services/recipe-service";
import { RecipesBrowser } from "./recipes-browser";

export const metadata = { title: "Recipes" };

type SearchParams = {
  q?: string;
};

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const household = await getActiveHousehold();

  // Fetch in parallel: recipes for the grid, and the caller's role in this
  // household (owners get the bulk-delete affordance, members don't).
  const [recipes, memberships] = await Promise.all([
    // Only the text search hits the server (uses Postgres FTS via search_tsv).
    // Tag/meal/diet/cuisine/favourite filters happen client-side on the
    // already-fetched list — instant feedback, no round-trip.
    recipeService.list({
      householdId: household.id,
      filters: { query: params.q },
      limit: 500,
    }),
    householdService.listForCurrentUser(),
  ]);

  const myMembership = memberships.find((m) => m.household.id === household.id);
  const isOwner = myMembership?.role === "owner";

  // Per-recipe rating aggregates for the listing cards. Single round trip
  // for all visible recipes (vs N+1 per-card). Map → record so it ships
  // through the client component cleanly.
  const aggregatesMap = await ratingService.getAggregatesForRecipes(
    recipes.map((r) => r.id),
  );
  const ratingAggregates: Record<string, { avg: number; count: number }> = {};
  for (const [id, agg] of aggregatesMap) ratingAggregates[id] = agg;

  return (
    <div className="container space-y-5 py-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Recipes</h1>
        <p className="text-sm text-muted-foreground">{recipes.length} in your household</p>
      </div>

      <RecipesBrowser
        householdId={household.id}
        initialRecipes={recipes}
        initialQuery={params.q ?? ""}
        isOwner={isOwner}
        ratingAggregates={ratingAggregates}
      />
    </div>
  );
}
