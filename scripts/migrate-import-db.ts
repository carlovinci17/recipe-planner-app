/**
 * Module 9 / Lesson 9.1 — load the exported JSON into Neon.
 *
 * Uses Postgres's `jsonb_populate_recordset(null::<table>, <json>)` so every column
 * (jsonb, text[], vector, uuid[], timestamps) is coerced by the table's own types
 * — no hand-written serialisation. Generated columns (recipes.total_time_min) are
 * excluded automatically. Loads in FK-safe order and verifies each table's count,
 * halting + surfacing on any mismatch (see [[migration-human-in-loop]]).
 *
 *   npx tsx scripts/migrate-import-db.ts            # dry-run (row counts to load)
 *   npx tsx scripts/migrate-import-db.ts --apply    # load into Neon
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
import postgres from "postgres";
import { readFileSync } from "node:fs";
import path from "node:path";

const url = process.env.NEON_DATABASE_URL;
if (!url) throw new Error("NEON_DATABASE_URL not set in .env.local");
const APPLY = process.argv.includes("--apply");
const DIR = path.resolve(process.cwd(), "migration/db");

const TABLES = [
  "profiles",
  "households",
  "household_members",
  "household_invites",
  "integration_accounts",
  "drive_watched_folders",
  "drive_file_index",
  "ingestion_jobs",
  "recipes",
  "recipe_ingredients",
  "recipe_instructions",
  "recipe_ratings",
  "planner_entries",
  "shopping_lists",
  "shopping_list_items",
  "ingestion_events",
] as const;

const sql = postgres(url, { ssl: "require" });

async function insertableCols(table: string): Promise<string[]> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table} and is_generated <> 'ALWAYS'
    order by ordinal_position`;
  return rows.map((r) => r.column_name);
}

async function main(): Promise<void> {
  console.log(`Target: Neon   Mode: ${APPLY ? "APPLY" : "DRY-RUN (counts only)"}\n`);
  let ok = true;

  for (const t of TABLES) {
    const rows = JSON.parse(readFileSync(path.join(DIR, `${t}.json`), "utf8")) as Record<
      string,
      unknown
    >[];
    if (!APPLY) {
      console.log(`  ${t.padEnd(24)} ${String(rows.length).padStart(5)} rows (would load)`);
      continue;
    }
    if (rows.length === 0) {
      console.log(`  ${t.padEnd(24)}     0 rows`);
      continue;
    }
    const cols = sql(await insertableCols(t));
    try {
      await sql`
        insert into ${sql(t)} (${cols})
        select ${cols} from jsonb_populate_recordset(null::${sql(t)}, ${sql.json(rows as never)})`;
      const [c] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(t)}`;
      const match = c!.n === rows.length;
      console.log(`  ${t.padEnd(24)} src ${String(rows.length).padStart(5)} → neon ${String(c!.n).padStart(5)} ${match ? "✓" : "⚠️ MISMATCH"}`);
      if (!match) ok = false;
    } catch (e) {
      console.error(`  ${t.padEnd(24)} ❌ ${(e as Error).message}`);
      ok = false;
      break; // surface for manual review rather than pressing on
    }
  }

  await sql.end();
  if (!ok) {
    console.error("\n⚠️ Issue above — stopping for manual review (migration-human-in-loop).");
    process.exit(1);
  }
  console.log(APPLY ? "\n✅ all tables loaded; counts match prod" : "\n(dry-run — pass --apply to load)");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
