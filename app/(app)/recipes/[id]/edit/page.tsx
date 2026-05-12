import { notFound, redirect } from "next/navigation";
import { recipeService } from "@/lib/services/recipe-service";
import { getRecipePermissions } from "@/lib/services/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ReviewForm } from "../review/review-form";

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
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("ingestion_jobs")
      .select("page_image_paths")
      .eq("id", bundle.recipe.ingestion_job_id)
      .maybeSingle();
    sourcePages = data?.page_image_paths ?? [];
  }

  return (
    <div className="container max-w-5xl space-y-6 py-6">
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
