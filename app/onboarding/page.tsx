import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { householdService } from "@/lib/services/household-service";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const memberships = await householdService.listForCurrentUser();
  if (memberships.length > 0) redirect("/recipes");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-2xl font-semibold">Create your household</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A household is the shared space where your recipes, planner, and shopping list live.
          </p>
        </div>
        <OnboardingForm />
      </div>
    </div>
  );
}
