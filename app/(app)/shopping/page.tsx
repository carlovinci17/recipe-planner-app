import { ShoppingBasket } from "lucide-react";
import { getActiveHousehold } from "@/lib/services/active-household";
import { shoppingService } from "@/lib/services/shopping-service";
import { ShoppingList } from "./shopping-list";
import { BuildFromPlannerButton } from "./build-from-planner-button";
import { ShoppingListsSidebar } from "./shopping-lists-sidebar";

export const metadata = { title: "Shopping" };

export default async function ShoppingPage() {
  const household = await getActiveHousehold();
  const [active, allLists] = await Promise.all([
    shoppingService.getActive(household.id),
    shoppingService.listLists(household.id),
  ]);

  // Brand-new household with zero lists ever: keep the original empty
  // state so the first-run experience isn't a barren sidebar with no
  // affordance besides "New".
  if (allLists.length === 0) {
    return (
      <div className="container max-w-2xl space-y-4 py-16 text-center">
        <ShoppingBasket className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="font-display text-2xl font-semibold">No shopping lists yet</h1>
        <p className="text-sm text-muted-foreground">
          Build one from the recipes you&apos;ve planned this week, or start with an empty list.
        </p>
        <div className="flex justify-center pt-2">
          <BuildFromPlannerButton householdId={household.id} variant="default" />
        </div>
      </div>
    );
  }

  return (
    <div className="container grid max-w-6xl gap-6 py-6 md:grid-cols-[260px_1fr]">
      <ShoppingListsSidebar
        householdId={household.id}
        lists={allLists}
        activeListId={active?.list.id ?? null}
      />
      <main>
        {active ? (
          <ShoppingList
            // Re-mount when the active list changes so internal `items` state
            // doesn't carry over from the previous list.
            key={active.list.id}
            householdId={household.id}
            list={active.list}
            initialItems={active.items}
            sourceRecipeTitles={active.sourceRecipeTitles}
          />
        ) : (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            Pick a list from the sidebar, or create a new one.
          </div>
        )}
      </main>
    </div>
  );
}
