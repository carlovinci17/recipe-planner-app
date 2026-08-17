/**
 * Reset a Supabase Auth user's password (account recovery — the old password is
 * hashed and unrecoverable, so this SETS a new one). Uses the service-role admin
 * API. Targets whatever NEXT_PUBLIC_SUPABASE_URL points at (your prod project).
 *
 * Usage:
 *   npx tsx scripts/set-password.ts <email> '<new-password>'
 */
import { config as dotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

if (typeof globalThis.WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = class {};
}
dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

async function main() {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !SR) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/set-password.ts <email> '<new-password>'");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password must be at least 6 characters.");
    process.exit(1);
  }

  const supabase = createClient(URL, SR, { auth: { persistSession: false } });

  let userId: string | undefined;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error("listUsers failed:", error.message);
      process.exit(1);
    }
    const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) {
      userId = u.id;
      break;
    }
    if (data.users.length < 200) break;
  }
  if (!userId) {
    console.error(`No user found with email ${email}.`);
    process.exit(1);
  }

  const { error } = await supabase.auth.admin.updateUserById(userId, { password });
  if (error) {
    console.error("Update failed:", error.message);
    process.exit(1);
  }
  console.log(`✅ Password set for ${email} on ${URL}. Log in with your new password.`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
