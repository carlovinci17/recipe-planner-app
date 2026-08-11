import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getMyProfile } from "@/lib/services/profile-service";
import { householdService } from "@/lib/services/household-service";
import { getActiveHousehold } from "@/lib/services/active-household";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Run in parallel: getActiveHousehold (handles onboarding redirect) + profile fetch
  const [active, profile] = await Promise.all([getActiveHousehold(), getMyProfile()]);

  // listForCurrentUser is cached by React.cache() — no extra DB round-trip
  const memberships = await householdService.listForCurrentUser();

  return (
    <AppShell
      user={{
        email: profile?.email ?? user.email ?? "",
        displayName: profile?.display_name ?? user.name ?? user.email ?? "",
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
