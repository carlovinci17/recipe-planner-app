import "server-only";
import { and, asc, eq, inArray, isNotNull, lt, or, isNull, sql } from "drizzle-orm";
import { driveFiles, driveFolders, ingestionEvents, ingestionJobs } from "@/lib/db/schema";
import { SUPPORTED_MIME, downloadFile, listFolderTree } from "@/lib/integrations/google-drive";
import { ingestionStorage } from "@/lib/ingestion/storage";
import { startFileIngestion } from "@/lib/ingestion/start-job";
import { logger } from "@/lib/logger";

/**
 * Google Drive folder sync — the work behind the `driveSync` timer (every 5 min)
 * and the import page's "Sync now".
 *
 * Runs on the owner connection (no user in scope, like the rest of the
 * pipeline); every query is scoped by folder row / household explicitly.
 *
 *   listFolder  — walk the shared folder tree and record each file in
 *                 drive_files. New → pending; changed since last import →
 *                 pending again; unreadable types → unsupported.
 *   queueFiles  — start ingestion for pending files, at most MAX_IN_FLIGHT at a
 *                 time across all households, so a 100-PDF first sync trickles
 *                 through instead of firing 100 vision calls at once.
 *
 * Duplicates are handled downstream, not here: a Drive job always skims, and
 * the skim marks titles the household already has (see the orchestrator).
 */

const LIST_EVERY_MINUTES = 30;
const MAX_IN_FLIGHT = 3;

type FolderRow = typeof driveFolders.$inferSelect;

async function db() {
  return (await import("@/lib/db")).db;
}

export async function listFolder(folder: FolderRow): Promise<{
  total: number;
  pending: number;
  unsupported: number;
  alreadySeen: number;
}> {
  const d = await db();
  try {
    const entries = await listFolderTree(folder.folderId);
    const before = await d
      .select({ driveFileId: driveFiles.driveFileId })
      .from(driveFiles)
      .where(eq(driveFiles.folderId, folder.id));
    const seen = new Set(before.map((r) => r.driveFileId));

    for (let i = 0; i < entries.length; i += 200) {
      const batch = entries.slice(i, i + 200).map((e) => ({
        householdId: folder.householdId,
        folderId: folder.id,
        driveFileId: e.id,
        name: e.name,
        path: e.path || null,
        mimeType: e.mimeType,
        modifiedTime: e.modifiedTime,
        status: e.mimeType in SUPPORTED_MIME ? "pending" : "unsupported",
      }));
      await d
        .insert(driveFiles)
        .values(batch)
        .onConflictDoUpdate({
          target: [driveFiles.householdId, driveFiles.driveFileId],
          set: {
            name: sql`excluded.name`,
            path: sql`excluded.path`,
            mimeType: sql`excluded.mime_type`,
            modifiedTime: sql`excluded.modified_time`,
            // A file edited in Drive since its import goes round again; the
            // skim's title check stops it duplicating recipes it already made.
            status: sql`case
              when ${driveFiles.status} = 'unsupported' then excluded.status
              when ${driveFiles.modifiedTime} is distinct from excluded.modified_time
                then 'pending'
              else ${driveFiles.status} end`,
            updatedAt: sql`now()`,
          },
        });
    }

    await d
      .update(driveFolders)
      .set({ lastListedAt: sql`now()`, lastError: null, updatedAt: sql`now()` })
      .where(eq(driveFolders.id, folder.id));

    const supported = entries.filter((e) => e.mimeType in SUPPORTED_MIME);
    return {
      total: entries.length,
      pending: supported.filter((e) => !seen.has(e.id)).length,
      unsupported: entries.length - supported.length,
      alreadySeen: supported.filter((e) => seen.has(e.id)).length,
    };
  } catch (err) {
    await d
      .update(driveFolders)
      .set({ lastError: (err as Error).message.slice(0, 500), updatedAt: sql`now()` })
      .where(eq(driveFolders.id, folder.id));
    throw err;
  }
}

/** Jobs started by the sync that are still working (not parked on the picker). */
async function inFlightCount(): Promise<number> {
  const d = await db();
  const [row] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(driveFiles)
    .innerJoin(ingestionJobs, eq(ingestionJobs.id, driveFiles.jobId))
    .where(
      and(
        eq(driveFiles.status, "queued"),
        inArray(ingestionJobs.status, ["draft", "processing"]),
        // A cookbook waiting for the user to pick recipes costs nothing while it
        // waits — it must not hold a slot, or one unanswered picker stalls the sync.
        sql`not (${ingestionJobs.skimResults} is not null
              and ${ingestionJobs.skimResults} -> 'selected_titles' is null)`,
      ),
    );
  return row?.n ?? 0;
}

async function queueOne(file: typeof driveFiles.$inferSelect, folder: FolderRow): Promise<void> {
  const d = await db();
  const fmt = SUPPORTED_MIME[file.mimeType];
  if (!fmt) return;
  let jobId: string | null = null;
  try {
    const bytes = await downloadFile(file.driveFileId, file.mimeType);
    const [job] = await d
      .insert(ingestionJobs)
      .values({
        householdId: folder.householdId,
        createdBy: folder.createdBy,
        sourceKind: "google_drive",
        storageBucket: ingestionStorage.uploadsBucket,
      })
      .returning({ id: ingestionJobs.id });
    jobId = job!.id;
    const base = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .slice(0, 80);
    const path = `${folder.householdId}/${jobId}/source-${base}.${fmt.ext}`;
    await ingestionStorage.uploadTo({
      bucket: ingestionStorage.uploadsBucket,
      path,
      buffer: bytes,
      contentType: fmt.kind === "pdf" ? "application/pdf" : file.mimeType,
    });
    await d.update(ingestionJobs).set({ storagePath: path }).where(eq(ingestionJobs.id, jobId));
    await d.insert(ingestionEvents).values({
      jobId,
      kind: "file_uploaded",
      payload: {
        storage_path: path,
        source: "google_drive",
        drive_file_id: file.driveFileId,
        drive_path: file.path ? `${file.path}/${file.name}` : file.name,
      },
    });
    await d
      .update(driveFiles)
      .set({ status: "queued", jobId, error: null, updatedAt: sql`now()` })
      .where(eq(driveFiles.id, file.id));
    await startFileIngestion({
      jobId,
      householdId: folder.householdId,
      sourceKind: "google_drive",
      source: "drive",
    });
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    logger.error({ err, driveFileId: file.driveFileId }, "drive sync: queueing a file failed");
    await d
      .update(driveFiles)
      .set({ status: "failed", error: message, updatedAt: sql`now()` })
      .where(eq(driveFiles.id, file.id));
    if (jobId) {
      await d
        .update(ingestionJobs)
        .set({ status: "failed", error: `Drive import failed: ${message}` })
        .where(eq(ingestionJobs.id, jobId));
    }
  }
}

export async function queueFiles(): Promise<{ queued: number; failed: number }> {
  const d = await db();
  const capacity = MAX_IN_FLIGHT - (await inFlightCount());
  if (capacity <= 0) return { queued: 0, failed: 0 };
  const rows = await d
    .select({ file: driveFiles, folder: driveFolders })
    .from(driveFiles)
    .innerJoin(driveFolders, eq(driveFolders.id, driveFiles.folderId))
    .where(
      and(
        eq(driveFiles.status, "pending"),
        eq(driveFolders.isActive, true),
        isNotNull(driveFolders.confirmedAt),
      ),
    )
    .orderBy(asc(driveFiles.createdAt))
    .limit(capacity);
  let failed = 0;
  for (const { file, folder } of rows) {
    await queueOne(file, folder);
    const [after] = await d
      .select({ status: driveFiles.status })
      .from(driveFiles)
      .where(eq(driveFiles.id, file.id));
    if (after?.status === "failed") failed++;
  }
  return { queued: rows.length - failed, failed };
}

/** One timer tick: re-list folders that are due, then start what fits. */
export async function driveSyncTick(): Promise<{ listed: number; queued: number; failed: number }> {
  const d = await db();
  const due = await d
    .select()
    .from(driveFolders)
    .where(
      and(
        eq(driveFolders.isActive, true),
        isNotNull(driveFolders.confirmedAt),
        or(
          isNull(driveFolders.lastListedAt),
          lt(driveFolders.lastListedAt, sql`now() - make_interval(mins => ${LIST_EVERY_MINUTES})`),
        ),
      ),
    );
  let listed = 0;
  for (const folder of due) {
    try {
      await listFolder(folder);
      listed++;
    } catch (err) {
      logger.warn({ err, folderId: folder.id }, "drive sync: listing a folder failed");
    }
  }
  const { queued, failed } = await queueFiles();
  return { listed, queued, failed };
}
