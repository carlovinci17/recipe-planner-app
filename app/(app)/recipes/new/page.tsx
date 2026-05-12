import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveHousehold } from "@/lib/services/active-household";

/**
 * Creating a manual recipe is just inserting a draft and redirecting into
 * the review screen, where editing UI already exists.
 */
export default async function NewRecipePage() {
  const supabase = await createSupabaseServerClient();
  const household = await getActiveHousehold();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("recipes")
    .insert({
      household_id: household.id,
      created_by: user.id,
      title: "Untitled recipe",
      source_kind: "manual",
      status: "needs_review",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to create recipe");

  redirect(`/recipes/${data.id}/review`);
}
