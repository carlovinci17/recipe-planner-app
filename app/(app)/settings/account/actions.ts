"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { updateMyDisplayName } from "@/lib/services/profile-service";

const Schema = z.object({
  displayName: z.string().min(1).max(100),
});

export async function updateProfileAction(input: z.infer<typeof Schema>) {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await updateMyDisplayName(parsed.data.displayName);
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Update failed" };
  }
  revalidatePath("/settings/account");
  return { ok: true as const };
}
