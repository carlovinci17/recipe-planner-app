import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { householdService } from "@/lib/services/household-service";
import { getActiveHousehold } from "@/lib/services/active-household";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Run in parallel: getActiveHousehold (handles onboarding redirect) + profile fetch
  const [active, { data: profile }] = await Promise.all([
    getActiveHousehold(),
    supabase.from("profiles").select("display_name, email, avatar_url").eq("id", user.id).single(),
  ]);

  // listForCurrentUser is cached by React.cache() — no extra DB round-trip
  const memberships = await householdService.listForCurrentUser();

  return (
    <AppShell
      user={{
        email: user.email ?? "",
        displayName: profile?.display_name ?? user.email ?? "",
        avatarUrl: profile?.avatar_url ?? null,
      }}
      activeHousehold={active}
      households={Array.from(
        new Map(memberships.map((m) => [m.household.id, m])).values()
      ).map((m) => ({
        id: m.household.id,
        name: m.household.name,
        role: m.role,
      }))}
    >
      {children}
    </AppShell>
  );
}
