import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { householdService } from "./household-service";

const COOKIE = "active_household";

/**
 * Resolve the current user's active household, falling back to their first
 * membership. Sets the cookie if not present so subsequent calls are O(1).
 *
 * Wrapped with React.cache() so repeated calls within the same request
 * (layout + child page) share a single DB round-trip.
 */
export const getActiveHousehold = cache(async function getActiveHousehold(): Promise<{ id: string; name: string; role: "owner" | "member" }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE)?.value;

  const memberships = await householdService.listForCurrentUser();
  if (memberships.length === 0) redirect("/onboarding");

  const chosen =
    memberships.find((m) => m.household.id === cookieValue) ?? memberships[0]!;

  if (cookieValue !== chosen.household.id) {
    try {
      cookieStore.set(COOKIE, chosen.household.id, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    } catch {
      // Server Components cannot set cookies — middleware or the next
      // Server Action will persist it.
    }
  }

  return { id: chosen.household.id, name: chosen.household.name, role: chosen.role };
});

export async function setActiveHouseholdCookie(householdId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, householdId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
