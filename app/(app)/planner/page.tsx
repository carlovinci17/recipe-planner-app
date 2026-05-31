import { addDays, format, startOfWeek } from "date-fns";
import { getActiveHousehold } from "@/lib/services/active-household";
import { plannerService } from "@/lib/services/planner-service";
import { recipeService } from "@/lib/services/recipe-service";
import { PlannerGrid } from "./planner-grid";

export const metadata = { title: "Planner" };

function parseWeek(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
}

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const household = await getActiveHousehold();
  const weekStart = startOfWeek(parseWeek(week), { weekStartsOn: 1 });

  const [planner, recipes] = await Promise.all([
    plannerService.getWeek({ householdId: household.id, weekStart }),
    recipeService.list({ householdId: household.id, limit: 200 }),
  ]);

  return (
    <PlannerGrid
      key={format(weekStart, "yyyy-MM-dd")}
      householdId={household.id}
      weekStartIso={format(weekStart, "yyyy-MM-dd")}
      previousWeekIso={format(addDays(weekStart, -7), "yyyy-MM-dd")}
      nextWeekIso={format(addDays(weekStart, 7), "yyyy-MM-dd")}
      dates={planner.dates}
      initialEntries={planner.entries}
      recipes={recipes}
    />
  );
}
