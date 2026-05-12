"use server";

import { z } from "zod";
import { householdService } from "@/lib/services/household-service";
import { logger } from "@/lib/logger";

const InviteSchema = z.object({
  householdId: z.string().uuid(),
  email: z.string().email(),
});

export async function inviteAction(input: z.infer<typeof InviteSchema>) {
  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid email" };
  try {
    const invite = await householdService.invite(parsed.data);
    return { ok: true as const, token: invite.token };
  } catch (err) {
    logger.error({ err }, "inviteAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}
