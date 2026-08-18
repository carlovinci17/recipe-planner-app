/**
 * Module 9 / Lesson 9.3 — migrate referenced images to Azure Blob as optimized WebP.
 *
 * The user photos are mostly PNG (lossless → huge). Real optimization means
 * converting to WebP, which changes the extension — so we upload each referenced
 * blob to Azure at a `.webp` path and rewrite its reference in Neon
 * (image_paths / cover_image_path). resolveCoverImage keeps working; the
 * /api/images route serves .webp with image/webp. A cover whose source blob is
 * missing (the 10 dangling refs from 9.2) has its cover_image_path NULLed.
 *
 *   npx tsx scripts/migrate-assets-upload.ts            # dry-run (plan + savings + missing)
 *   npx tsx scripts/migrate-assets-upload.ts --apply    # convert+upload+rewrite paths+null dangling
 *
 * Reads: .env.prod (Supabase download) + .env.local (NEON_DATABASE_URL, AZURE_STORAGE_ACCOUNT).
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.prod" });
dotenv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import postgres from "postgres";
import sharp from "sharp";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const neonUrl = process.env.NEON_DATABASE_URL;
const account = process.env.AZURE_STORAGE_ACCOUNT;
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase prod creds missing (.env.prod)");
if (!neonUrl) throw new Error("NEON_DATABASE_URL missing (.env.local)");
if (!account) throw new Error("AZURE_STORAGE_ACCOUNT missing (.env.local)");

const APPLY = process.argv.includes("--apply");
const MAX_EDGE = 1200;

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const sql = postgres(neonUrl, { ssl: "require" });
const blobService = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());

type Bucket = "recipe-images" | "recipe-uploads";
const toWebpPath = (p: string): string => (/\.[^./]+$/.test(p) ? p.replace(/\.[^./]+$/, ".webp") : `${p}.webp`);

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? "APPLY (convert→upload→rewrite paths→null dangling)" : "DRY-RUN"}\n`);

  const recipes = await sql<{ id: string; image_paths: string[] | null; cover_image_path: string | null }[]>`
    select id, image_paths, cover_image_path from recipes`;

  const imageRefs = new Set<string>();
  const coverRefs = new Map<string, string>(); // path -> a recipe id (for null-on-missing)
  for (const r of recipes) {
    for (const p of r.image_paths ?? []) if (p && p !== r.cover_image_path) imageRefs.add(p);
    if (r.cover_image_path) coverRefs.set(r.cover_image_path, r.id);
  }
  const work: { bucket: Bucket; path: string; recipeId?: string }[] = [
    ...[...imageRefs].map((path): { bucket: Bucket; path: string } => ({ bucket: "recipe-images", path })),
    ...[...coverRefs].map(([path, recipeId]): { bucket: Bucket; path: string; recipeId: string } => ({
      bucket: "recipe-uploads",
      path,
      recipeId,
    })),
  ];
  console.log(`Referenced: ${work.length} (recipe-images ${imageRefs.size}, recipe-uploads ${coverRefs.size})\n`);

  let uploaded = 0;
  let origBytes = 0;
  let optBytes = 0;
  let nulled = 0;
  const missing: string[] = [];

  for (const w of work) {
    const { data, error } = await supabase.storage.from(w.bucket).download(w.path);
    if (error || !data) {
      missing.push(`${w.bucket}/${w.path}`);
      if (w.recipeId && APPLY) {
        await sql`update recipes set cover_image_path = null where id = ${w.recipeId} and cover_image_path = ${w.path}`;
        nulled += 1;
      }
      continue;
    }
    const orig = Buffer.from(await data.arrayBuffer());
    // WebP q80, ≤1200px longest edge; sharp strips EXIF by default.
    const webp = await sharp(orig)
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    origBytes += orig.length;
    optBytes += webp.length;
    uploaded += 1;

    if (APPLY) {
      const newPath = toWebpPath(w.path);
      await blobService
        .getContainerClient(w.bucket)
        .getBlockBlobClient(newPath)
        .uploadData(webp, { blobHTTPHeaders: { blobContentType: "image/webp" } });
      // Rewrite every reference to the old path (in either column) to the new .webp path.
      await sql`
        update recipes set
          image_paths = array_replace(image_paths, ${w.path}, ${newPath}),
          cover_image_path = case when cover_image_path = ${w.path} then ${newPath} else cover_image_path end
        where ${w.path} = any(image_paths) or cover_image_path = ${w.path}`;
    }
  }

  const mb = (b: number) => (b / 1_048_576).toFixed(1);
  await sql.end();
  console.log(
    `${APPLY ? "Uploaded" : "Would upload"}: ${uploaded} WebP blobs — ${mb(origBytes)} MB → ${mb(optBytes)} MB${origBytes ? ` (−${Math.round((1 - optBytes / origBytes) * 100)}%)` : ""}`,
  );
  console.log(`Dangling covers ${APPLY ? "nulled" : "to null"}: ${missing.length}`);
  if (!APPLY && missing.length) console.log(`  (run with --apply to upload + rewrite paths + null the ${missing.length} dangling)`);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
