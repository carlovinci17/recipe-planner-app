/**
 * One-time cleanup: normalize + dedupe recipe tags, cuisines, source names and
 * meal types so the recipe browser's filters are short, consistent and complete.
 *
 * Uses the SAME `lib/recipes/normalize` util as the write path, so "clean" means
 * the same thing here as for new imports:
 *   - tags/cuisines → lowercased, whitespace-collapsed, de-duped, time-only tags dropped
 *   - source_name   → case/whitespace variants merged to one canonical display,
 *                     including the YouTube channel_name the UI falls back to
 *   - meal_types    → at least one core type (ensureMealTypes), as new imports get
 *
 * SAFE BY DEFAULT: dry-run (prints a diff, writes nothing). Pass --apply to write
 * (with a YES confirmation). Idempotent — re-running after an apply is a no-op.
 *
 * Usage:
 *   npx tsx scripts/normalize-recipe-tags.ts                 # dry-run (preview)
 *   npx tsx scripts/normalize-recipe-tags.ts --apply         # write changes
 *   npx tsx scripts/normalize-recipe-tags.ts --household <id># scope to one household
 *
 * Runs against DATABASE_URL from .env.local, which is production Neon — take a
 * Neon branch snapshot first.
 */

import { config as dotenv } from "dotenv";
import postgres from "postgres";
import {
  ensureMealTypes,
  normalizeList,
  normalizeSourceName,
  canonicalSourceName,
} from "../lib/recipes/normalize";
import { getRecipeSourceName } from "../lib/recipes/source-name";

dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

const DATABASE_URL = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing NEON_DATABASE_URL (or DATABASE_URL). Aborting.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: "require", prepare: false });

/** Host only — never print the connection string, it carries the password. */
function dbLabel(): string {
  try {
    return new URL(DATABASE_URL!).host;
  } catch {
    return "the configured database";
  }
}

const APPLY = process.argv.includes("--apply");
const hhIdx = process.argv.indexOf("--household");
const HOUSEHOLD = hhIdx >= 0 ? process.argv[hhIdx + 1] : undefined;

type Row = {
  id: string;
  household_id: string;
  title: string;
  tags: string[];
  cuisines: string[];
  source_name: string | null;
  source_url: string | null;
  source_metadata: unknown;
  meal_types: string[];
};

const eqArr = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

async function fetchAll(): Promise<Row[]> {
  // One query: 181 recipes is nothing, and the Supabase client's 1000-row
  // default page size was the only reason this paged at all.
  const rows = HOUSEHOLD
    ? await sql<Row[]>`
        select id, household_id, title, tags, cuisines, source_name, source_url, source_metadata, meal_types
        from recipes where household_id = ${HOUSEHOLD}`
    : await sql<Row[]>`
        select id, household_id, title, tags, cuisines, source_name, source_url, source_metadata, meal_types from recipes`;
  return rows;
}

async function main() {
  console.log(
    `\n🧹 Recipe metadata cleanup — ${APPLY ? "APPLY (will write)" : "DRY RUN (no writes)"}${HOUSEHOLD ? ` · household ${HOUSEHOLD}` : ""}`,
  );
  console.log(`   target: ${dbLabel()}\n`);

  const rows = await fetchAll();
  console.log(`Fetched ${rows.length} recipes.\n`);

  // Canonical source-name map across the whole set, built from the DERIVED name
  // the UI shows (source_name → channel_name → domain), so "Health with Bec"
  // typed as source_name and "Health With Bec" from a YouTube channel_name merge.
  const sourceCanon = canonicalSourceName(rows.map((r) => getRecipeSourceName(r)));

  const changes: {
    id: string;
    before: Row;
    after: { tags: string[]; cuisines: string[]; source_name: string | null; meal_types: string[] };
  }[] = [];
  const tagsBefore = new Set<string>();
  const tagsAfter = new Set<string>();
  const sourceMerges = new Map<string, string>(); // "raw" -> "canonical" where they differ

  for (const r of rows) {
    (r.tags ?? []).forEach((t) => tagsBefore.add(t));
    const newTags = normalizeList(r.tags);
    const newCuisines = normalizeList(r.cuisines);
    newTags.forEach((t) => tagsAfter.add(t));

    // An explicit source_name is canonicalised; a channel_name-only recipe gets
    // the canonical name written into source_name, so the two stop diverging.
    // Domain-derived names are left to be computed live — nothing to store.
    const channel = (r.source_metadata as { channel_name?: string } | null)?.channel_name;
    const normSrc = normalizeSourceName(r.source_name) ?? normalizeSourceName(channel);
    const newSource = normSrc ? (sourceCanon.get(normSrc) ?? normSrc) : null;
    if (r.source_name && newSource && r.source_name !== newSource)
      sourceMerges.set(r.source_name, newSource);

    const newMealTypes = ensureMealTypes(r.meal_types, newTags);

    if (
      !eqArr(newTags, r.tags ?? []) ||
      !eqArr(newCuisines, r.cuisines ?? []) ||
      newSource !== r.source_name ||
      !eqArr(newMealTypes, r.meal_types ?? [])
    ) {
      changes.push({
        id: r.id,
        before: r,
        after: {
          tags: newTags,
          cuisines: newCuisines,
          source_name: newSource,
          meal_types: newMealTypes,
        },
      });
    }
  }

  // ── Summary ──
  console.log(
    `Tags:    ${tagsBefore.size} distinct → ${tagsAfter.size} distinct  (${tagsBefore.size - tagsAfter.size} fewer)`,
  );
  console.log(`Recipes changed: ${changes.length} / ${rows.length}`);
  if (sourceMerges.size) {
    console.log(`\nSource merges:`);
    for (const [raw, canon] of sourceMerges) console.log(`  "${raw}"  →  "${canon}"`);
  }
  console.log(`\nChanges:`);
  for (const c of changes) {
    const b = c.before;
    if (!eqArr(c.after.tags, b.tags ?? []))
      console.log(
        `  ${b.id.slice(0, 8)} tags:     [${(b.tags ?? []).join(", ")}]  →  [${c.after.tags.join(", ")}]`,
      );
    if (!eqArr(c.after.cuisines, b.cuisines ?? []))
      console.log(
        `  ${b.id.slice(0, 8)} cuisines: [${(b.cuisines ?? []).join(", ")}]  →  [${c.after.cuisines.join(", ")}]`,
      );
    if (!eqArr(c.after.meal_types, b.meal_types ?? []))
      console.log(
        `  ${b.id.slice(0, 8)} meals:    [${(b.meal_types ?? []).join(", ")}]  →  [${c.after.meal_types.join(", ")}]  ${b.title}`,
      );
    if (c.after.source_name !== b.source_name)
      console.log(
        `  ${b.id.slice(0, 8)} source:   "${b.source_name}"  →  "${c.after.source_name}"`,
      );
  }

  if (!APPLY) {
    console.log(
      `\n👀 Dry run only — nothing written. Re-run with --apply to write ${changes.length} rows.\n`,
    );
    return;
  }
  if (changes.length === 0) {
    console.log(`\n✅ Nothing to change.\n`);
    return;
  }

  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question(`\nType YES to write ${changes.length} rows to ${dbLabel()}: `, (a: string) => {
      rl.close();
      if (a.trim() !== "YES") {
        console.log("Aborted.");
        process.exit(0);
      }
      resolve();
    });
  });

  let written = 0;
  for (const c of changes) {
    try {
      await sql`
        update recipes set
          tags        = ${sql.array(c.after.tags)},
          cuisines    = ${sql.array(c.after.cuisines)},
          source_name = ${c.after.source_name},
          meal_types  = ${sql.array(c.after.meal_types)}
        where id = ${c.id}`;
      written++;
    } catch (err) {
      console.warn(`  !  ${c.id}: ${(err as Error).message}`);
    }
  }
  console.log(`\nUpdated ${written}/${changes.length} recipes.\n`);
}

// `finally` closes the pool on every path — the dry-run and nothing-to-do
// returns used to skip `sql.end()` and leave the process hanging.
main()
  .catch((err) => {
    console.error("Unexpected error:", err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
