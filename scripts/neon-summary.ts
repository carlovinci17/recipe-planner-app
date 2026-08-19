import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
import postgres from "postgres";

/**
 * Cutover-prep data peek (P1 Step 2): lists the households on Neon and the row
 * counts that matter, so we can tell real migrated prod data apart from
 * dev/test rows created while running the app on Neon — and decide whether to
 * re-migrate fresh or keep Neon as-is. Read-only.
 */
const url = process.env.NEON_DATABASE_URL;
if (!url) throw new Error("NEON_DATABASE_URL not set in .env.local");
const sql = postgres(url, { ssl: "require" });

async function main(): Promise<void> {
  const households = await sql<
    { id: string; name: string; created: string; members: number; recipes: number }[]
  >`
    select h.id, h.name, to_char(h.created_at, 'YYYY-MM-DD') as created,
      (select count(*) from household_members m where m.household_id = h.id)::int as members,
      (select count(*) from recipes r where r.household_id = h.id)::int as recipes
    from households h
    order by h.created_at`;

  console.log(`\nHouseholds (${households.length}):`);
  for (const h of households) {
    console.log(
      `  • ${h.name.padEnd(20)} ${String(h.recipes).padStart(4)} recipes · ${h.members} member(s) · created ${h.created} · ${h.id}`,
    );
  }

  const tables = [
    "profiles",
    "recipes",
    "recipe_ingredients",
    "recipe_instructions",
    "planner_entries",
    "shopping_lists",
    "shopping_list_items",
    "ingestion_jobs",
  ] as const;
  console.log("\nTotal row counts:");
  for (const t of tables) {
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(t)}`;
    console.log(`  ${t.padEnd(22)} ${row!.n}`);
  }
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌", (e as Error).message);
    process.exit(1);
  });
