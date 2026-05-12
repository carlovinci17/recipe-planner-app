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

  const memberships = await householdService.listForCurrentUser();
  if (memberships.length === 0) redirect("/onboarding");

  const active = await getActiveHousehold();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, email, avatar_url")
    .eq("id", user.id)
    .single();

  return (
    <AppShell
      user={{
        email: user.email ?? "",
        displayName: profile?.display_name ?? user.email ?? "",
        avatarUrl: profile?.avatar_url ?? null,
      }}
      activeHousehold={active}
      households={memberships.map((m) => ({
        id: m.household.id,
        name: m.household.name,
        role: m.role,
      }))}
    >
      {children}
    </AppShell>
  );
}
