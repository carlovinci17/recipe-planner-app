import Link from "next/link";
import { Suspense } from "react";
import { Calendar, ChefHat, ShoppingBasket, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveHousehold } from "@/lib/services/active-household";
import { recipeService } from "@/lib/services/recipe-service";
import { plannerService } from "@/lib/services/planner-service";
import { shoppingService } from "@/lib/services/shopping-service";
import { RecipeCard } from "@/components/recipes/recipe-card";

export const metadata = { title: "Home" };

export default async function DashboardPage() {
  const household = await getActiveHousehold();

  const [recentRecipes, planner, shopping] = await Promise.all([
    recipeService.list({ householdId: household.id, limit: 6 }),
    plannerService.getWeek({ householdId: household.id, weekStart: new Date() }),
    shoppingService.getActive(household.id),
  ]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const todaysMeals = planner.entries.filter((e) => e.date === todayIso);
  const openItems = shopping?.items.filter((i) => !i.is_checked).length ?? 0;

  return (
    <div className="container space-y-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Welcome to {household.name}</h1>
          <p className="text-sm text-muted-foreground">Your kitchen at a glance.</p>
        </div>
        <Button asChild>
          <Link href="/recipes/import">
            <Upload className="mr-2 h-4 w-4" /> Import a recipe
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={ChefHat} label="Recipes" value={recentRecipes.length} href="/recipes" />
        <StatCard icon={Calendar} label="Today's meals" value={todaysMeals.length} href="/planner" />
        <StatCard icon={ShoppingBasket} label="Shopping items" value={openItems} href="/shopping" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recently added</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense>
            {recentRecipes.length === 0 ? (
              <EmptyRecipes />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recentRecipes.map((r) => (
                  <RecipeCard key={r.id} recipe={r} />
                ))}
              </div>
            )}
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl border bg-card p-5 shadow-sm transition-colors hover:bg-accent"
    >
      <div>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="font-display text-2xl font-semibold">{value}</div>
      </div>
      <Icon className="h-6 w-6 text-muted-foreground" />
    </Link>
  );
}

function EmptyRecipes() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <ChefHat className="h-8 w-8 text-muted-foreground" />
      <div className="font-medium">No recipes yet</div>
      <p className="max-w-sm text-sm text-muted-foreground">
        Drop in a PDF, paste a URL, or snap a photo of a cookbook page to get started.
      </p>
      <Button asChild>
        <Link href="/recipes/import">
          <Upload className="mr-2 h-4 w-4" /> Import your first recipe
        </Link>
      </Button>
    </div>
  );
}
