"use server";

import { householdService } from "@/lib/services/household-service";
import { setActiveHouseholdCookie } from "@/lib/services/active-household";

export async function acceptInviteAction(token: string) {
  const householdId = await householdService.acceptInvite(token);
  await setActiveHouseholdCookie(householdId);
  return { householdId };
}
