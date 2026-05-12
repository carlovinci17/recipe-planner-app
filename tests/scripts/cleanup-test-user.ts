/**
 * Sweep stranded e2e+...@example.test users from Supabase auth.
 * The fixture deletes after each test, but failed runs (process kills,
 * timeouts) leave users behind. Run periodically:
 *   npm run test:cleanup
 */
import { config as dotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv({ path: ".env.test" });
dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SR) {
  console.error("Missing Supabase env. Aborting.");
  process.exit(1);
}

const admin = createClient(URL, SR, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  let page = 1;
  let deleted = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    if (!data.users.length) break;
    for (const u of data.users) {
      if (u.email?.startsWith("e2e+") && u.email.endsWith("@example.test")) {
        await admin.auth.admin.deleteUser(u.id);
        deleted++;
        console.log(`✓ deleted ${u.email}`);
      }
    }
    if (data.users.length < 200) break;
    page++;
  }
  console.log(`\nDone. Deleted ${deleted} test users.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
