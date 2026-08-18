import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
import postgres from "postgres";

const url = process.env.NEON_DATABASE_URL;
if (!url) throw new Error("NEON_DATABASE_URL not set in .env.local");
const sql = postgres(url, { ssl: "require" });

async function main(): Promise<void> {
  const [v] = await sql<{ version: string }[]>`select version() as version`;
  console.log("✓ connected:", v!.version.split(",")[0]);
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables where table_schema='public' order by table_name`;
  console.log("public tables:", tables.length ? tables.map((t) => t.table_name).join(", ") : "(none — empty DB)");
  const exts = await sql<{ extname: string }[]>`select extname from pg_extension order by extname`;
  console.log("extensions:", exts.map((e) => e.extname).join(", "));
  // Cutover prep (P1): the `authenticated` role must exist — withUserContext
  // does `set local role authenticated`, which Supabase ships but a bare Neon
  // doesn't. Its absence is what breaks RLS-scoped queries after the DB flip.
  const roles = await sql<{ rolname: string }[]>`
    select rolname from pg_roles where rolname in ('authenticated', 'anon', 'service_role') order by rolname`;
  console.log(
    "auth roles:",
    roles.length ? roles.map((r) => r.rolname).join(", ") : "(none — run scripts/neon-roles.sql)",
  );
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌", (e as Error).message);
    process.exit(1);
  });
