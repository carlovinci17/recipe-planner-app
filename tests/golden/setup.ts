// Load env inside the worker (the config loads it in the main process, but
// vitest workers fork — re-load so `lib/env.ts` sees the keys). No DB guard here:
// the golden set never touches Supabase, so it must not import the integration
// setup that refuses to run against a non-local database.
import { config as dotenv } from "dotenv";

dotenv({ path: ".env.test", override: false });
dotenv({ path: ".env.local", override: false });
dotenv({ path: ".env", override: false });
