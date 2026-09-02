import { notFound, redirect } from "next/navigation";
import { recipeService } from "@/lib/services/recipe-service";
import { getRecipePermissions } from "@/lib/services/permissions";
import { ingestionStore } from "@/lib/ingestion/store";
import { logger } from "@/lib/logger";
import { ReviewForm } from "../review/review-form";
import { BackLink } from "@/components/ui/back-link";

export const metadata = { title: "Edit recipe" };

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
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
  if (!perms.canEdit) redirect(`/recipes/${id}`);

  const plannerEntryCount = perms.canDelete
    ? await recipeService.countPlannerEntries(bundle.recipe.id)
    : 0;

  // Same lookup as the review page — fetches the originating ingestion job's
  // rasterized pages so the CoverPicker can offer them as cover candidates
  // (and the FocalPointPicker can work on the picked page). For non-AI
  // recipes (manual creates) ingestion_job_id is null, sourcePages is empty,
  // and the CoverPicker renders nothing.
  let sourcePages: string[] = [];
  if (bundle.recipe.ingestion_job_id) {
    try {
      const job = await ingestionStore.getJob(bundle.recipe.ingestion_job_id);
      sourcePages = job?.page_image_paths ?? [];
    } catch (err) {
      logger.error({ err }, "edit page: source-page lookup failed");
    }
  }

  return (
    <div className="container max-w-5xl space-y-6 py-6">
      <BackLink href={`/recipes/${id}`} label="Back to recipe" />
      <h1 className="font-display text-2xl font-semibold">Edit recipe</h1>
      <ReviewForm
        recipe={bundle.recipe}
        ingredients={bundle.ingredients}
        instructions={bundle.instructions}
        canDelete={perms.canDelete}
        plannerEntryCount={plannerEntryCount}
        sourcePages={sourcePages}
      />
    </div>
  );
}
