import { config as dotenv } from "dotenv";

// Belt-and-suspenders: also load env inside the worker (config already loaded it
// in the main process, but this keeps the safety check self-contained).
dotenv({ path: ".env.test", override: false });
dotenv({ path: ".env.local", override: false });
dotenv({ path: ".env", override: false });

// SAFETY GUARD — these tests seed and DELETE rows. Refuse to run against
// anything that isn't a local Supabase, so a missing/wrong .env.test fails loud
// instead of mutating a hosted (production) database.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  throw new Error(
    `[integration setup] Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not local ("${url || "unset"}"). ` +
      "Point .env.test at your local Supabase (http://127.0.0.1:54321) before running integration tests.",
  );
}
