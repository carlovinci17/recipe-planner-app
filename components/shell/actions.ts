"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { setActiveHouseholdCookie } from "@/lib/services/active-household";
import { householdService } from "@/lib/services/household-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function switchHouseholdAction(householdId: string) {
  const memberships = await householdService.listForCurrentUser();
  const ok = memberships.some((m) => m.household.id === householdId);
  if (!ok) throw new Error("Not a member of this household");
  await setActiveHouseholdCookie(householdId);
}

/**
 * Sign out of the ACTIVE session. Dual-dispatch: under Entra the live session is
 * Auth.js (calling supabase.auth.signOut() there was a no-op — you were never
 * actually signed out, so the middleware bounced you back to /recipes). Auth.js
 * signOut clears its cookie and redirects; trustHost builds the URL from the
 * request host, so the port is preserved on localhost.
 */
export async function signOutAction() {
  if (env.AUTH_PROVIDER === "entra") {
    await signOut({ redirectTo: "/login" });
    return;
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
