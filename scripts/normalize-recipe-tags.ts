/**
 * One-time cleanup: normalize + dedupe recipe tags, cuisines, and source names
 * so the recipe browser's filters are short and consistent.
 *
 * Uses the SAME `lib/recipes/normalize` util as the write path, so "clean" means
 * the same thing here as for new imports:
 *   - tags/cuisines → lowercased, whitespace-collapsed, de-duped, time-only tags dropped
 *   - source_name   → case/whitespace variants merged to one canonical display
 *
 * SAFE BY DEFAULT: dry-run (prints a diff, writes nothing). Pass --apply to write
 * (with a YES confirmation). Idempotent — re-running after an apply is a no-op.
 *
 * Usage:
 *   npx tsx scripts/normalize-recipe-tags.ts                 # dry-run (preview)
 *   npx tsx scripts/normalize-recipe-tags.ts --apply         # write changes
 *   npx tsx scripts/normalize-recipe-tags.ts --household <id># scope to one household
 *
 * Point it at PRODUCTION by putting the prod Supabase URL + service-role key in
 * .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Snapshot first.
 */

import { config as dotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  normalizeList,
  normalizeSourceName,
  canonicalSourceName,
} from "../lib/recipes/normalize";

if (typeof globalThis.WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = class {};
}

dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Aborting.");
  process.exit(1);
}
try {
  new URL(SUPABASE_URL);
} catch {
  console.error(
    `Invalid NEXT_PUBLIC_SUPABASE_URL: "${SUPABASE_URL}" — looks like an unfilled placeholder.\n` +
      "Your .env already has real creds, so just run:  npx tsx scripts/normalize-recipe-tags.ts",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const APPLY = process.argv.includes("--apply");
const hhIdx = process.argv.indexOf("--household");
const HOUSEHOLD = hhIdx >= 0 ? process.argv[hhIdx + 1] : undefined;
const PAGE = 1000;

type Row = { id: string; household_id: string; tags: string[]; cuisines: string[]; source_name: string | null };

const eqArr = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

async function fetchAll(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("recipes").select("id, household_id, tags, cuisines, source_name").range(from, from + PAGE - 1);
    if (HOUSEHOLD) q = q.eq("household_id", HOUSEHOLD);
    const { data, error } = await q;
    if (error) throw new Error(`Fetch failed: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  console.log(`\n🧹 Recipe metadata cleanup — ${APPLY ? "APPLY (will write)" : "DRY RUN (no writes)"}${HOUSEHOLD ? ` · household ${HOUSEHOLD}` : ""}`);
  console.log(`   target: ${SUPABASE_URL}\n`);

  const rows = await fetchAll();
  console.log(`Fetched ${rows.length} recipes.\n`);

  // Canonical source-name map across the whole set (merges casing/whitespace variants).
  const sourceCanon = canonicalSourceName(rows.map((r) => r.source_name));

  const changes: { id: string; before: Row; after: { tags: string[]; cuisines: string[]; source_name: string | null } }[] = [];
  const tagsBefore = new Set<string>();
  const tagsAfter = new Set<string>();
  const sourceMerges = new Map<string, string>(); // "raw" -> "canonical" where they differ

  for (const r of rows) {
    (r.tags ?? []).forEach((t) => tagsBefore.add(t));
    const newTags = normalizeList(r.tags);
    const newCuisines = normalizeList(r.cuisines);
    newTags.forEach((t) => tagsAfter.add(t));

    const normSrc = normalizeSourceName(r.source_name);
    const newSource = normSrc ? (sourceCanon.get(normSrc) ?? normSrc) : null;
    if (r.source_name && newSource && r.source_name !== newSource) sourceMerges.set(r.source_name, newSource);

    if (!eqArr(newTags, r.tags ?? []) || !eqArr(newCuisines, r.cuisines ?? []) || newSource !== r.source_name) {
      changes.push({ id: r.id, before: r, after: { tags: newTags, cuisines: newCuisines, source_name: newSource } });
    }
  }

  // ── Summary ──
  console.log(`Tags:    ${tagsBefore.size} distinct → ${tagsAfter.size} distinct  (${tagsBefore.size - tagsAfter.size} fewer)`);
  console.log(`Recipes changed: ${changes.length} / ${rows.length}`);
  if (sourceMerges.size) {
    console.log(`\nSource merges:`);
    for (const [raw, canon] of sourceMerges) console.log(`  "${raw}"  →  "${canon}"`);
  }
  console.log(`\nSample changes (first 15):`);
  for (const c of changes.slice(0, 15)) {
    const b = c.before;
    if (!eqArr(c.after.tags, b.tags ?? [])) console.log(`  ${b.id.slice(0, 8)} tags:     [${(b.tags ?? []).join(", ")}]  →  [${c.after.tags.join(", ")}]`);
    if (!eqArr(c.after.cuisines, b.cuisines ?? [])) console.log(`  ${b.id.slice(0, 8)} cuisines: [${(b.cuisines ?? []).join(", ")}]  →  [${c.after.cuisines.join(", ")}]`);
    if (c.after.source_name !== b.source_name) console.log(`  ${b.id.slice(0, 8)} source:   "${b.source_name}"  →  "${c.after.source_name}"`);
  }

  if (!APPLY) {
    console.log(`\n👀 Dry run only — nothing written. Re-run with --apply to write ${changes.length} rows.\n`);
    return;
  }
  if (changes.length === 0) {
    console.log(`\n✅ Nothing to change.\n`);
    return;
  }

  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question(`\nType YES to write ${changes.length} rows to ${SUPABASE_URL}: `, (a: string) => {
      rl.close();
      if (a.trim() !== "YES") { console.log("Aborted."); process.exit(0); }
      resolve();
    });
  });

  let written = 0;
  for (const c of changes) {
    const { error } = await supabase
      .from("recipes")
      .update({ tags: c.after.tags, cuisines: c.after.cuisines, source_name: c.after.source_name })
      .eq("id", c.id);
    if (error) console.warn(`  ⚠  ${c.id}: ${error.message}`);
    else written++;
  }
  console.log(`\n✅ Updated ${written}/${changes.length} recipes.\n`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
