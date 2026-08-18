/**
 * Module 9 / Lesson 9.1 — read-only export of the prod Supabase DB.
 *
 * Reads every public app table (the 16 in lib/db/schema.ts) via the service-role
 * REST client and writes one JSON file per table, in FK-safe order, ready to load
 * into Neon. READ-ONLY — never writes to Supabase.
 *
 *   npx tsx scripts/migrate-export-db.ts            # dry-run: row counts only
 *   npx tsx scripts/migrate-export-db.ts --write    # write migration/db/<table>.json
 *
 * Reads prod creds from .env.prod (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * Output dir migration/ is gitignored — prod data never lands in the repo.
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.prod" });

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.prod");
}

const WRITE = process.argv.includes("--write");
const OUT = path.resolve(process.cwd(), "migration/db");

// Parents first, so a later Neon import satisfies foreign keys as it goes.
const TABLES = [
  "profiles",
  "households",
  "household_members",
  "household_invites",
  "integration_accounts",
  "drive_watched_folders",
  "drive_file_index",
  "recipes",
  "recipe_ingredients",
  "recipe_instructions",
  "recipe_ratings",
  "planner_entries",
  "shopping_lists",
  "shopping_list_items",
  "ingestion_jobs",
  "ingestion_events",
] as const;

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function fetchAll(table: string): Promise<unknown[]> {
  const pageSize = 1000; // Supabase caps a single response at 1000 rows
  const rows: unknown[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main(): Promise<void> {
  console.log(`Source: ${url}`);
  console.log(`Mode:   ${WRITE ? `WRITE → ${OUT}/` : "DRY-RUN (counts only)"}\n`);
  if (WRITE) mkdirSync(OUT, { recursive: true });

  let total = 0;
  for (const t of TABLES) {
    const rows = await fetchAll(t);
    total += rows.length;
    if (WRITE) writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(rows, null, 2));
    console.log(`  ${t.padEnd(24)} ${String(rows.length).padStart(6)} rows`);
  }
  console.log(`\n  TOTAL ${total} rows${WRITE ? ` → ${OUT}` : ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  });
