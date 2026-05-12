"use server";

import { householdService } from "@/lib/services/household-service";
import { setActiveHouseholdCookie } from "@/lib/services/active-household";
import { logger } from "@/lib/logger";

export async function createHouseholdAction(
  name: string,
): Promise<{ ok: true; householdId: string } | { ok: false; error: string }> {
  try {
    const id = await householdService.create(name);
    await setActiveHouseholdCookie(id);
    return { ok: true, householdId: id };
  } catch (err) {
    logger.error({ err }, "createHouseholdAction failed");
    return { ok: false, error: (err as Error).message };
  }
}
