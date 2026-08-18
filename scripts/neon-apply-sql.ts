import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
import { readFileSync } from "node:fs";
import postgres from "postgres";

/**
 * Apply a .sql file to Neon without needing the `psql` CLI (P1 cutover prep).
 * Runs the whole file as one multi-statement batch via the `postgres` library.
 *
 *   npx tsx scripts/neon-apply-sql.ts scripts/neon-prelude.sql
 *   npx tsx scripts/neon-apply-sql.ts scripts/neon-roles.sql
 *
 * Target is NEON_DATABASE_URL (the DIRECT string) from .env.local. Idempotent
 * files (create ... if not exists / create or replace) are safe to re-run.
 */
const url = process.env.NEON_DATABASE_URL;
if (!url) throw new Error("NEON_DATABASE_URL not set in .env.local");

const file = process.argv[2];
if (!file) throw new Error("usage: tsx scripts/neon-apply-sql.ts <path-to.sql>");

const sqlText = readFileSync(file, "utf8");
const sql = postgres(url, { ssl: "require" });

async function main(): Promise<void> {
  console.log(`applying ${file} to Neon…`);
  await sql.unsafe(sqlText); // trusted, repo-authored SQL only
  console.log("✓ applied");
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌", (e as Error).message);
    process.exit(1);
  });
