"use server";

import { setActiveHouseholdCookie } from "@/lib/services/active-household";
import { householdService } from "@/lib/services/household-service";

export async function switchHouseholdAction(householdId: string) {
  const memberships = await householdService.listForCurrentUser();
  const ok = memberships.some((m) => m.household.id === householdId);
  if (!ok) throw new Error("Not a member of this household");
  await setActiveHouseholdCookie(householdId);
}
