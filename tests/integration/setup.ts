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

// Drizzle write/delete tests flow through DATABASE_URL — guard it too, or a
// hosted DB there would be mutated even while the REST URL looks local.
const dbUrl = process.env.DATABASE_URL ?? "";
if (dbUrl && !/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) {
  throw new Error(
    `[integration setup] Refusing to run: DATABASE_URL is not local ("${dbUrl}"). ` +
      "Point it at your local Postgres (postgresql://…@127.0.0.1:54322/postgres).",
  );
}
