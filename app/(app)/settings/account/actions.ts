"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const Schema = z.object({
  displayName: z.string().min(1).max(100),
});

export async function updateProfileAction(input: z.infer<typeof Schema>) {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not authenticated" };
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName })
    .eq("id", user.id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/settings/account");
  return { ok: true as const };
}
