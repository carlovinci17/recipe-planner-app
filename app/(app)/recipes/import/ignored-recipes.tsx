"use client";

import { useTransition } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { IgnoredRecipe } from "@/lib/services/import-ignore-service";
import { undoIgnoredRecipeAction } from "./actions";

/**
 * The "Don't import again" tab of Recent imports: recipes the household chose
 * that for in the recipe picker. The skim hides these from every later picker;
 * Undo takes one off the list so it is offered again the next time a file
 * containing it is read.
 */
export function IgnoredRecipes({
  householdId,
  recipes,
}: {
  householdId: string;
  recipes: IgnoredRecipe[];
}) {
  const [pending, start] = useTransition();

  function undo(r: IgnoredRecipe) {
    start(async () => {
      const result = await undoIgnoredRecipeAction({ householdId, id: r.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`“${r.title}” will be offered again next time it's found.`);
    });
  }

  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs text-muted-foreground">
        Recipes you turned down for good. They&apos;re hidden whenever an import finds them. Undo to
        have them offered again.
      </p>
      {recipes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Choose &ldquo;Don&apos;t import again&rdquo; for a recipe in the import
          picker and it appears here.
        </p>
      ) : (
        <ul className="divide-y">
          {recipes.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.sourceLabel ? `From ${r.sourceLabel} · ` : ""}
                  {new Date(r.createdAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => undo(r)}
                disabled={pending}
                className="shrink-0"
              >
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
