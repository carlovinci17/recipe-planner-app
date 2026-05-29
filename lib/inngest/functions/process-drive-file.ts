import "server-only";
import { NonRetriableError } from "inngest";
import sharp from "sharp";
import { inngest } from "@/lib/inngest/client";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { driveClient } from "@/lib/integrations/google-drive";
import { ingestionStorage } from "@/lib/ingestion/storage";
import { logger } from "@/lib/logger";

/**
 * Normalize a Drive download into something the rest of the pipeline (and
 * Anthropic vision) can actually consume. The Drive list returns the file's
 * native MIME, but:
 *   - Google Docs were already exported as PDF in driveClient.downloadFile,
 *     so the bytes are PDF even though the MIME is "vnd.google-apps.document".
 *   - HEIC isn't supported by Anthropic vision (or most browsers); convert
 *     to PNG via sharp.
 *   - Other supported formats just need the correct file extension + a
 *     truthful Content-Type header.
 *
 * Returns the bytes/MIME/extension to use for storage, plus the source_kind
 * the downstream `processUpload` pipeline branches on.
 */
async function normalizeDriveFile(args: {
  buffer: Buffer;
  originalMime: string;
}): Promise<{
  buffer: Buffer;
  mimeType: string;
  ext: string;
  sourceKind: "pdf" | "image";
}> {
  const { buffer, originalMime } = args;

  if (originalMime === "application/vnd.google-apps.document") {
    // Already exported as PDF by driveClient.downloadFile — relabel the
    // bytes truthfully so processUpload's PDF branch picks them up.
    return { buffer, mimeType: "application/pdf", ext: "pdf", sourceKind: "pdf" };
  }
  if (originalMime === "application/pdf") {
    return { buffer, mimeType: "application/pdf", ext: "pdf", sourceKind: "pdf" };
  }
  if (originalMime === "image/heic" || originalMime === "image/heif") {
    // Anthropic vision only accepts JPEG/PNG/GIF/WebP. Re-encode HEIC via
    // sharp (libvips with libheif). While we're decoding, also resize and
    // re-encode to JPEG for storage savings — iPhone HEICs at native res
    // are often >5MB and the cover thumbnail doesn't need that.
    const jpeg = await sharp(buffer)
      .rotate()
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { buffer: jpeg, mimeType: "image/jpeg", ext: "jpg", sourceKind: "image" };
  }
  const extByMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  if (!extByMime[originalMime]) {
    throw new NonRetriableError(`Unsupported Drive MIME type: ${originalMime}`);
  }
  // For non-GIF source images, normalize to 1600px JPEG so Drive's full-res
  // photos don't bloat storage. GIFs are passed through (resizing animated
  // GIFs is a different problem and rarely a recipe source).
  if (originalMime === "image/gif") {
    return { buffer, mimeType: "image/gif", ext: "gif", sourceKind: "image" };
  }
  const jpeg = await sharp(buffer)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return { buffer: jpeg, mimeType: "image/jpeg", ext: "jpg", sourceKind: "image" };
}

/**
 * Pulls a Drive file into our storage bucket and creates an ingestion job,
 * which then triggers the regular processUpload pipeline via the
 * ingestion/file.uploaded event.
 */
export const processDriveFile = inngest.createFunction(
  {
    id: "ingestion-process-drive-file",
    name: "Pull Drive file into ingestion pipeline",
    retries: 3,
    concurrency: { limit: 4 },
    onFailure: async ({ event, error }) => {
      // Drive jobId is generated mid-function (not on the trigger event), so we
      // can't reliably mark a specific job failed here. Just log; the periodic
      // stale-job sweep below covers any orphaned 'processing' rows.
      logger.error(
        {
          err: error.message,
          driveFileId: (event as { data?: { event?: { data?: { driveFileId?: string } } } })?.data
            ?.event?.data?.driveFileId,
        },
        "drive ingestion function exhausted retries",
      );
    },
  },
  { event: "ingestion/drive.file.detected" },
  async ({ event, step }) => {
    const { householdId, accountId, driveFileId, mimeType, fileName, modifiedTime } =
      event.data as {
        householdId: string;
        accountId: string;
        driveFileId: string;
        mimeType: string;
        fileName: string;
        // Optional for backward compat — older queued events may not have it.
        modifiedTime?: string | null;
      };
    const supabase = createSupabaseAdmin();

    const account = await step.run("load-account", async () => {
      const { data, error } = await supabase
        .from("integration_accounts")
        .select("*")
        .eq("id", accountId)
        .single();
      if (error || !data) throw new NonRetriableError(`Account ${accountId} not found`);
      return data;
    });

    // Dedup: if this file was already imported via the bulk-import script, skip
    // re-extraction and just upgrade the sentinel job's external_file_id to the
    // real Drive file ID so future scans dedup by ID instead of filename.
    const alreadyImported = await step.run("check-bulk-import", async () => {
      const { data } = await supabase
        .from("ingestion_jobs")
        .select("id")
        .eq("household_id", householdId)
        .eq("external_file_id", fileName)
        .maybeSingle();
      if (!data) return false;
      // Upgrade sentinel external_file_id → real Drive file ID.
      await supabase
        .from("ingestion_jobs")
        .update({ external_file_id: driveFileId })
        .eq("id", data.id);
      return true;
    });

    if (alreadyImported) {
      logger.info({ driveFileId, fileName }, "skipping drive file — already imported via bulk script");
      return { skipped: true };
    }

    // Combined: download from Drive + upload to our bucket. Buffers can't be
    // checkpointed across steps (Inngest serializes step output via JSON).
    const { jobId, sourceKind, storagePath } = await step.run("download-and-upload", async () => {
      const fileBuffer = await driveClient.downloadFile({
        accessToken: account.access_token,
        refreshToken: account.refresh_token ?? undefined,
        fileId: driveFileId,
        mimeType,
      });

      // Normalize: align bytes ↔ MIME ↔ extension ↔ source_kind so the
      // downstream pipeline (and Anthropic vision) gets something it can
      // actually read. Catches HEIC, Google Docs, and the bag of subtly-
      // mislabeled formats that come out of consumer Drive folders.
      const normalized = await normalizeDriveFile({
        buffer: fileBuffer,
        originalMime: mimeType,
      });

      const supa = createSupabaseAdmin();

      const { data: jobRow, error } = await supa
        .from("ingestion_jobs")
        .insert({
          household_id: householdId,
          created_by: account.user_id,
          source_kind: normalized.sourceKind,
          storage_bucket: ingestionStorage.uploadsBucket,
          // Status defaults to 'draft' (queued). processUpload's
          // mark-processing step bumps to 'processing' when the worker
          // actually picks the row up. This keeps the stuck-job sweep
          // accurate even when many Drive files queue at once.
          // Persist Drive provenance so future scans can dedup against this
          // exact file id + modified time.
          external_file_id: driveFileId,
          external_modified_time: modifiedTime ?? null,
        })
        .select("id")
        .single();
      if (error || !jobRow) throw new Error(`Failed to create job: ${error?.message}`);

      // Replace any extension on the original Drive name with the normalized
      // one, so the storage path doesn't lie about its content.
      const safeBase =
        fileName.replace(/[^a-zA-Z0-9.-]/g, "_").replace(/\.[^.]+$/, "") || "file";
      const path = `${householdId}/${jobRow.id}/source-${safeBase}.${normalized.ext}`;
      const { error: upErr } = await supa.storage
        .from(ingestionStorage.uploadsBucket)
        .upload(path, normalized.buffer, {
          contentType: normalized.mimeType,
          upsert: false,
        });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      await supa
        .from("ingestion_jobs")
        .update({ storage_path: path })
        .eq("id", jobRow.id);

      await supa.from("ingestion_events").insert({
        job_id: jobRow.id,
        kind: "file_uploaded",
        payload: { source: "google_drive", driveFileId, normalizedMime: normalized.mimeType },
      });

      return { jobId: jobRow.id, sourceKind: normalized.sourceKind, storagePath: path };
    });

    await step.sendEvent("emit-uploaded", {
      name: "ingestion/file.uploaded",
      data: { jobId, householdId, sourceKind },
    });

    return { jobId, storagePath };
  },
);
