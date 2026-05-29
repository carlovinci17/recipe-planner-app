/**
 * Bulk PDF import — feeds local PDF files into the existing processUpload pipeline.
 *
 * Usage:
 *   npx tsx scripts/bulk-import.ts <pdf-directory> \
 *     --household-id=<uuid> \
 *     --created-by=<user-uuid>
 *
 * What it does per PDF:
 *   1. Skips if an ingestion_jobs row with external_file_id = filename already exists
 *   2. Uploads the raw PDF to Supabase Storage (recipe-uploads bucket)
 *   3. Creates an ingestion_jobs row (source_kind='pdf')
 *   4. Fires ingestion/file.uploaded → processUpload Inngest function takes over
 *      (skim → extract → normalize → persist → tag — identical to browser upload)
 *   5. Inserts a drive_file_index placeholder row so the Drive re-scan knows
 *      this file has been imported and won't re-process it
 *
 * Env required (loaded from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   INNGEST_EVENT_KEY
 */

import { config as dotenv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { Inngest } from "inngest";

dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INNGEST_EVENT_KEY = process.env.INNGEST_EVENT_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — check .env.local");
  process.exit(1);
}
if (!INNGEST_EVENT_KEY) {
  console.error("Missing INNGEST_EVENT_KEY — find it in Inngest dashboard → Event Keys");
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v];
    }),
);

const pdfDirArg = positional[0];
const householdIdArg = flags["household-id"];
const createdByArg = flags["created-by"];

if (!pdfDirArg || !householdIdArg || !createdByArg) {
  console.error(
    "Usage: npx tsx scripts/bulk-import.ts <pdf-dir> --household-id=<uuid> --created-by=<user-uuid>",
  );
  process.exit(1);
}

const PDF_DIR = pdfDirArg;
const HOUSEHOLD_ID = householdIdArg;
const CREATED_BY = createdByArg;

if (!fs.existsSync(PDF_DIR) || !fs.statSync(PDF_DIR).isDirectory()) {
  console.error(`Directory not found: ${PDF_DIR}`);
  process.exit(1);
}

// ── Clients ───────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE!);
const inngest = new Inngest({ id: "recipe-planner", eventKey: INNGEST_EVENT_KEY });

const BUCKET = "recipe-uploads";
const CONCURRENCY = 3;

// ── Per-file processing ───────────────────────────────────────────────────────

let queued = 0;
let skipped = 0;
let failed = 0;

async function processPdf(
  filePath: string,
  index: number,
  total: number,
  batchPrefix: string,
): Promise<void> {
  const filename = path.basename(filePath);
  const tag = `[${String(index + 1).padStart(String(total).length, " ")}/${total}]`;

  // ── Dedup: skip if already queued or processed ────────────────────────────
  const { data: existing } = await supabase
    .from("ingestion_jobs")
    .select("id, status")
    .eq("household_id", HOUSEHOLD_ID)
    .eq("external_file_id", filename)
    .maybeSingle();

  if (existing) {
    console.log(`${tag} ${filename} → SKIP (already imported, job ${existing.id}, status=${existing.status})`);
    skipped++;
    return;
  }

  // ── Upload PDF to Storage ─────────────────────────────────────────────────
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    console.error(`${tag} ${filename} → FAIL (read): ${(err as Error).message}`);
    failed++;
    return;
  }

  const storagePath = `${HOUSEHOLD_ID}/${batchPrefix}/${filename}`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

  if (uploadErr) {
    console.error(`${tag} ${filename} → FAIL (upload): ${uploadErr.message}`);
    failed++;
    return;
  }

  // ── Create ingestion_jobs row ─────────────────────────────────────────────
  const { data: job, error: jobErr } = await supabase
    .from("ingestion_jobs")
    .insert({
      household_id: HOUSEHOLD_ID,
      created_by: CREATED_BY,
      source_kind: "pdf" as const,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      external_file_id: filename,
      status: "draft" as const,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    console.error(`${tag} ${filename} → FAIL (job): ${jobErr?.message}`);
    // Clean up the uploaded file
    await supabase.storage.from(BUCKET).remove([storagePath]);
    failed++;
    return;
  }

  // ── Fire Inngest event → processUpload takes over ─────────────────────────
  try {
    await inngest.send({
      name: "ingestion/file.uploaded" as const,
      data: { jobId: job.id, HOUSEHOLD_ID, sourceKind: "pdf" as const },
    });
  } catch (err) {
    console.error(`${tag} ${filename} → FAIL (inngest): ${(err as Error).message}`);
    failed++;
    return;
  }

  // ── Insert drive_file_index placeholder for Drive dedup ───────────────────
  // Uses a sentinel drive_file_id (sha1 of filename) since we don't have
  // the actual Drive file ID. startDriveIndexAction matches by file_name
  // and upgrades this to the real ID when it finds the file on Drive.
  const sentinelId = `bulk:${crypto.createHash("sha1").update(filename).digest("hex")}`;
  await supabase.from("drive_file_index").upsert(
    {
      household_id: HOUSEHOLD_ID,
      drive_file_id: sentinelId,
      file_name: filename,
      folder_path: "",
      mime_type: "application/pdf",
      index_status: "pending",
    },
    { onConflict: "household_id,drive_file_id" },
  );

  console.log(`${tag} ${filename} → job ${job.id} → queued ✓`);
  queued++;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const allFiles = fs
    .readdirSync(PDF_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort()
    .map((f) => path.join(PDF_DIR, f));

  if (allFiles.length === 0) {
    console.error(`No PDF files found in ${PDF_DIR}`);
    process.exit(1);
  }

  const batchPrefix = `bulk-${Date.now()}`;

  console.log(`\nBulk PDF import`);
  console.log(`  Directory : ${path.resolve(PDF_DIR)}`);
  console.log(`  PDFs found: ${allFiles.length}`);
  console.log(`  Household : ${HOUSEHOLD_ID}`);
  console.log(`  Created by: ${CREATED_BY}`);
  console.log(`  Batch ID  : ${batchPrefix}`);
  console.log(`  Bucket    : ${BUCKET}/${HOUSEHOLD_ID}/${batchPrefix}/\n`);

  // Process in concurrent batches
  for (let i = 0; i < allFiles.length; i += CONCURRENCY) {
    const batch = allFiles.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map((f, j) => processPdf(f, i + j, allFiles.length, batchPrefix)),
    );
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Queued : ${queued}`);
  console.log(`Skipped: ${skipped} (already imported)`);
  console.log(`Failed : ${failed}`);
  console.log(`\nMonitor in Inngest dashboard → Functions → "Process file upload"`);
  console.log(`Recipes will appear in the review queue as Inngest processes them.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
