/**
 * Module 9 / Lesson 9.2 — asset inventory + sharp-optimisation dry-run.
 *
 * Computes the REFERENCED image set (what actually renders) and measures the
 * WebP-optimised size, so we can (a) skip the unreferenced ~2 GB of
 * recipe-uploads intermediates and (b) quantify the shrink on what we keep.
 *
 * Referenced set (per resolveCoverImage in lib/recipes/cover-image.ts):
 *   - recipe-images  : every `image_paths` entry (user photos)
 *   - recipe-uploads : every `cover_image_path` (AI page previews used as covers)
 *
 *   npx tsx scripts/migrate-assets.ts             # dry-run report (all referenced)
 *   npx tsx scripts/migrate-assets.ts --limit 40  # sample N blobs for a quick ratio
 *   npx tsx scripts/migrate-assets.ts --write      # also write optimised files to migration/assets/<bucket>/<path>.webp
 *
 * READ-ONLY against Supabase. Prod creds from .env.prod. migration/ is gitignored.
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.prod" });

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.prod");

const WRITE = process.argv.includes("--write");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const OUT = path.resolve(process.cwd(), "migration/assets");
const MAX_EDGE = 1200;

const supabase = createClient(url, key, { auth: { persistSession: false } });

type Ref = { bucket: "recipe-images" | "recipe-uploads"; path: string };

async function referencedBlobs(): Promise<Ref[]> {
  const rows: { image_paths: string[] | null; cover_image_path: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("recipes")
      .select("image_paths, cover_image_path")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const images = new Set<string>();
  const uploads = new Set<string>();
  for (const r of rows) {
    for (const p of r.image_paths ?? []) if (p && p !== r.cover_image_path) images.add(p);
    if (r.cover_image_path) uploads.add(r.cover_image_path);
  }
  return [
    ...[...images].map((path): Ref => ({ bucket: "recipe-images", path })),
    ...[...uploads].map((path): Ref => ({ bucket: "recipe-uploads", path })),
  ];
}

async function main(): Promise<void> {
  console.log(`Source: ${url}`);
  console.log(`Mode:   ${WRITE ? "WRITE optimised → migration/assets/" : "DRY-RUN"}${Number.isFinite(LIMIT) ? `  (sample ${LIMIT})` : ""}\n`);

  const refs = await referencedBlobs();
  const byBucket = {
    "recipe-images": refs.filter((r) => r.bucket === "recipe-images").length,
    "recipe-uploads": refs.filter((r) => r.bucket === "recipe-uploads").length,
  };
  console.log(
    `Referenced blobs: ${refs.length} total — recipe-images ${byBucket["recipe-images"]}, recipe-uploads ${byBucket["recipe-uploads"]}\n`,
  );

  const stats = {
    "recipe-images": { n: 0, orig: 0, opt: 0 },
    "recipe-uploads": { n: 0, orig: 0, opt: 0 },
  };
  const sample = Number.isFinite(LIMIT) ? refs.slice(0, LIMIT) : refs;

  for (const ref of sample) {
    const { data, error } = await supabase.storage.from(ref.bucket).download(ref.path);
    if (error || !data) {
      console.warn(`  ⚠️ missing: ${ref.bucket}/${ref.path} (${error?.message ?? "no data"})`);
      continue;
    }
    const orig = Buffer.from(await data.arrayBuffer());
    // sharp strips EXIF by default (metadata is not copied unless withMetadata()).
    const opt = await sharp(orig)
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const s = stats[ref.bucket];
    s.n += 1;
    s.orig += orig.length;
    s.opt += opt.length;
    if (WRITE) {
      const dest = path.join(OUT, ref.bucket, `${ref.path}.webp`);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, opt);
    }
  }

  const mb = (b: number) => (b / 1_048_576).toFixed(1);
  console.log("Processed (optimised WebP @ ≤1200px):");
  for (const b of ["recipe-images", "recipe-uploads"] as const) {
    const s = stats[b];
    if (s.n === 0) continue;
    const pct = s.orig ? Math.round((1 - s.opt / s.orig) * 100) : 0;
    console.log(`  ${b.padEnd(16)} ${s.n} files: ${mb(s.orig)} MB → ${mb(s.opt)} MB  (−${pct}%)`);
  }
  const tot = stats["recipe-images"];
  const tu = stats["recipe-uploads"];
  const origAll = tot.orig + tu.orig;
  const optAll = tot.opt + tu.opt;
  console.log(
    `\n  TOTAL processed ${tot.n + tu.n} files: ${mb(origAll)} MB → ${mb(optAll)} MB` +
      (origAll ? `  (−${Math.round((1 - optAll / origAll) * 100)}%)` : ""),
  );
  console.log(
    `\n  Skipped (unreferenced recipe-uploads intermediates): the bulk of the ~2 GB is NOT migrated.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  });
