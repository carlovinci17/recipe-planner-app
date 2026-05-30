/**
 * Bulk PDF import — feeds local PDF files into the existing processUpload pipeline.
 *
 * Usage:
 *   npx tsx scripts/bulk-import.ts <pdf-directory> \
 *     --household-id=<uuid> \
 *     --created-by=<user-uuid> \
 *     [--port=3333]
 *
 * Opens a browser window with real-time progress (file names, status, errors).
 *
 * What it does per PDF:
 *   1. Skips if an ingestion_jobs row with external_file_id = filename already exists
 *   2. Uploads the raw PDF to Supabase Storage (recipe-uploads bucket)
 *   3. Creates an ingestion_jobs row (source_kind='pdf')
 *   4. Fires ingestion/file.uploaded → processUpload Inngest function takes over
 *      (skim → extract → normalize → persist → tag — identical to browser upload)
 *   5. Inserts a drive_file_index placeholder so Drive re-scans skip this file
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
import * as http from "http";
import { exec } from "child_process";
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
      const [k, ...rest] = a.slice(2).split("=");
      return [k, rest.join("=")];
    }),
);

const pdfDirArg = positional[0];
const householdIdArg = flags["household-id"];
const createdByArg = flags["created-by"];
const port = parseInt(flags["port"] ?? "3333", 10);

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

// ── SSE broadcaster ───────────────────────────────────────────────────────────

type ImportEvent =
  | { type: "start"; total: number; directory: string; household: string }
  | { type: "file-start"; index: number; file: string }
  | { type: "file-queued"; index: number; file: string; jobId: string }
  | { type: "file-skipped"; index: number; file: string; existingJobId: string; existingStatus: string }
  | { type: "file-failed"; index: number; file: string; stage: string; error: string }
  | { type: "complete"; queued: number; skipped: number; failed: number; durationMs: number };

const sseClients = new Set<http.ServerResponse>();

function broadcast(event: ImportEvent) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ── HTML progress page ────────────────────────────────────────────────────────

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bulk PDF Import</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin { animation: spin 1s linear infinite; display: inline-block; }
    .fade-in { animation: fadeIn 0.2s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  </style>
</head>
<body class="bg-gray-50 min-h-screen text-gray-900">
  <div class="max-w-3xl mx-auto py-10 px-4 space-y-6">

    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Bulk PDF Import</h1>
      <p id="subtitle" class="text-sm text-gray-500 mt-1">Connecting…</p>
    </div>

    <!-- Progress bar + stats -->
    <div id="progress-section" class="hidden space-y-3">
      <div class="flex items-center justify-between text-sm font-medium">
        <span id="progress-label">0 / 0 files</span>
        <span id="pct-label" class="text-gray-500">0%</span>
      </div>
      <div class="h-2 rounded-full bg-gray-200 overflow-hidden">
        <div id="progress-bar" class="h-full rounded-full bg-blue-500 transition-all duration-300" style="width:0%"></div>
      </div>
      <div class="flex gap-4 text-xs text-gray-500">
        <span>✓ Queued: <b id="stat-queued" class="text-gray-800">0</b></span>
        <span>↷ Skipped: <b id="stat-skipped" class="text-gray-800">0</b></span>
        <span>✗ Failed: <b id="stat-failed" class="text-red-600">0</b></span>
      </div>
    </div>

    <!-- Complete banner -->
    <div id="complete-banner" class="hidden rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
      <b>Import complete.</b> Recipes are being extracted by Inngest in the background.
      Open your app's Import page to monitor Inngest progress.
    </div>

    <!-- File list -->
    <div id="file-list" class="space-y-1.5 text-sm"></div>

  </div>

  <script>
    let total = 0;
    let done = 0;
    let stats = { queued: 0, skipped: 0, failed: 0 };
    const rows = {};

    const $id = (id) => document.getElementById(id);
    const progressSection = $id('progress-section');
    const fileList = $id('file-list');

    function updateProgress() {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      $id('progress-bar').style.width = pct + '%';
      $id('progress-label').textContent = done + ' / ' + total + ' files';
      $id('pct-label').textContent = pct + '%';
      $id('stat-queued').textContent = stats.queued;
      $id('stat-skipped').textContent = stats.skipped;
      $id('stat-failed').textContent = stats.failed;
    }

    function statusIcon(state) {
      if (state === 'processing') return '<span class="spin text-blue-500">↻</span>';
      if (state === 'queued')     return '<span class="text-green-500">✓</span>';
      if (state === 'skipped')    return '<span class="text-yellow-500">↷</span>';
      if (state === 'failed')     return '<span class="text-red-500">✗</span>';
      return '';
    }

    function statusColor(state) {
      if (state === 'queued')  return 'bg-green-50 border-green-200';
      if (state === 'skipped') return 'bg-yellow-50 border-yellow-200';
      if (state === 'failed')  return 'bg-red-50 border-red-200';
      return 'bg-white border-gray-200';
    }

    function renderRow(index, file, state, detail) {
      const existing = rows[index];
      const el = existing || document.createElement('div');
      el.className = 'fade-in rounded-lg border px-3 py-2 flex items-start gap-2.5 ' + statusColor(state);
      el.innerHTML =
        '<div class="mt-0.5 w-5 text-base text-center shrink-0">' + statusIcon(state) + '</div>' +
        '<div class="min-w-0 flex-1">' +
          '<p class="font-medium truncate" title="' + file + '">' + file + '</p>' +
          (detail ? '<p class="text-xs text-gray-500 mt-0.5">' + detail + '</p>' : '') +
        '</div>';
      if (!existing) {
        rows[index] = el;
        fileList.appendChild(el);
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const source = new EventSource('/events');

    source.onmessage = (e) => {
      const ev = JSON.parse(e.data);

      if (ev.type === 'start') {
        total = ev.total;
        progressSection.classList.remove('hidden');
        $id('subtitle').textContent = ev.total + ' PDF files in ' + ev.directory;
        updateProgress();
      }

      if (ev.type === 'file-start') {
        renderRow(ev.index, ev.file, 'processing', 'Uploading & queuing…');
      }

      if (ev.type === 'file-queued') {
        done++;
        stats.queued++;
        renderRow(ev.index, ev.file, 'queued', 'Queued → job ' + ev.jobId);
        updateProgress();
      }

      if (ev.type === 'file-skipped') {
        done++;
        stats.skipped++;
        renderRow(ev.index, ev.file, 'skipped', 'Already imported (job ' + ev.existingJobId + ', ' + ev.existingStatus + ')');
        updateProgress();
      }

      if (ev.type === 'file-failed') {
        done++;
        stats.failed++;
        renderRow(ev.index, ev.file, 'failed', ev.stage + ': ' + ev.error);
        updateProgress();
      }

      if (ev.type === 'complete') {
        $id('complete-banner').classList.remove('hidden');
        $id('subtitle').textContent =
          'Finished in ' + (ev.durationMs / 1000).toFixed(1) + 's — ' +
          ev.queued + ' queued, ' + ev.skipped + ' skipped, ' + ev.failed + ' failed';
        source.close();
      }
    };

    source.onerror = () => {
      $id('subtitle').textContent = 'Connection lost. Import may have finished.';
    };
  </script>
</body>
</html>`;

// ── HTTP server ───────────────────────────────────────────────────────────────

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        res.write(": connected\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML_PAGE);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const url = `http://localhost:${port}`;
      console.log(`\nProgress UI → ${url}`);
      // Open browser — macOS: open, Linux: xdg-open, Windows: start
      const cmd =
        process.platform === "win32"
          ? `start ${url}`
          : process.platform === "darwin"
          ? `open ${url}`
          : `xdg-open ${url}`;
      exec(cmd, (err) => {
        if (err) console.log(`(Could not auto-open browser — visit ${url} manually)`);
      });
      // Give browser a moment to connect before starting import
      setTimeout(resolve, 800);
    });
  });
}

// ── Per-file processing ───────────────────────────────────────────────────────

let queued = 0;
let skipped = 0;
let failed = 0;

async function processPdf(filePath: string, index: number, batchPrefix: string): Promise<void> {
  const filename = path.basename(filePath);
  // Show relative subfolder path in the UI so user can tell files apart across folders
  const relPath = path.relative(PDF_DIR, filePath);

  broadcast({ type: "file-start", index, file: relPath });

  // ── Dedup: skip if already queued or processed ──────────────────────────
  const { data: existing } = await supabase
    .from("ingestion_jobs")
    .select("id, status")
    .eq("household_id", HOUSEHOLD_ID)
    .eq("external_file_id", filename)
    .maybeSingle();

  if (existing && existing.status !== "failed") {
    broadcast({
      type: "file-skipped",
      index,
      file: relPath,
      existingJobId: existing.id,
      existingStatus: existing.status,
    });
    skipped++;
    return;
  }
  // Failed jobs are re-queued — delete the old row so the new upload can proceed.
  if (existing?.status === "failed") {
    await supabase.from("ingestion_jobs").delete().eq("id", existing.id);
  }

  // ── Upload PDF to Storage ────────────────────────────────────────────────
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    broadcast({ type: "file-failed", index, file: relPath, stage: "read", error: (err as Error).message });
    failed++;
    return;
  }

  const storagePath = `${HOUSEHOLD_ID}/${batchPrefix}/${filename}`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

  if (uploadErr) {
    broadcast({ type: "file-failed", index, file: relPath, stage: "upload", error: uploadErr.message });
    failed++;
    return;
  }

  // ── Create ingestion_jobs row ────────────────────────────────────────────
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
    await supabase.storage.from(BUCKET).remove([storagePath]);
    broadcast({ type: "file-failed", index, file: relPath, stage: "job-create", error: jobErr?.message ?? "no row returned" });
    failed++;
    return;
  }

  // ── Fire Inngest event ───────────────────────────────────────────────────
  try {
    await inngest.send({
      name: "ingestion/file.uploaded" as const,
      data: { jobId: job.id, householdId: HOUSEHOLD_ID, sourceKind: "pdf" as const, bulkMode: true, maxPages: 25 },
    });
  } catch (err) {
    broadcast({ type: "file-failed", index, file: relPath, stage: "inngest", error: (err as Error).message });
    failed++;
    return;
  }

  // ── Insert drive_file_index placeholder ──────────────────────────────────
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

  broadcast({ type: "file-queued", index, file: relPath, jobId: job.id });
  queued++;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  function collectPdfs(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...collectPdfs(full));
      else if (entry.name.toLowerCase().endsWith(".pdf")) results.push(full);
    }
    return results;
  }

  const allFiles = collectPdfs(PDF_DIR).sort();

  if (allFiles.length === 0) {
    console.error(`No PDF files found in ${PDF_DIR}`);
    process.exit(1);
  }

  console.log(`\nBulk PDF import`);
  console.log(`  Directory : ${path.resolve(PDF_DIR)}`);
  console.log(`  PDFs found: ${allFiles.length}`);
  console.log(`  Household : ${HOUSEHOLD_ID}`);

  await startServer();

  const batchPrefix = `bulk-${Date.now()}`;
  const startTime = Date.now();

  broadcast({
    type: "start",
    total: allFiles.length,
    directory: path.resolve(PDF_DIR),
    household: HOUSEHOLD_ID,
  });

  for (let i = 0; i < allFiles.length; i += CONCURRENCY) {
    const batch = allFiles.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((f, j) => processPdf(f, i + j, batchPrefix)));
  }

  const durationMs = Date.now() - startTime;
  broadcast({ type: "complete", queued, skipped, failed, durationMs });

  console.log(`\nDone in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Queued : ${queued}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed : ${failed}`);
  console.log(`\nKeeping progress server alive — press Ctrl+C to exit.`);
  // Keep process alive so the browser can still view the results
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
