import "server-only";
import { and, eq, sql } from "drizzle-orm";
import {
  driveFiles,
  driveFolders,
  householdMembers,
  ingestionJobs,
  profiles,
} from "@/lib/db/schema";
import {
  DriveAccessError,
  driveShareAddress,
  getFolder,
  parseFolderId,
} from "@/lib/integrations/google-drive";
import { listFolder, queueFiles } from "@/lib/ingestion/drive-sync";
import { runInUserTx } from "./user-tx";

export type DriveFolderSummary = {
  id: string;
  folderName: string | null;
  confirmed: boolean;
  lastListedAt: string | null;
  lastError: string | null;
  counts: {
    total: number;
    waiting: number;
    importing: number;
    imported: number;
    skipped: number;
    failed: number;
    unsupported: number;
  };
};

export type DrivePreview = {
  total: number;
  pending: number;
  unsupported: number;
  alreadySeen: number;
};

/**
 * The import page's Google Drive tab. Reads and folder changes run as the user
 * (RLS); the Drive listing itself runs on the owner connection inside
 * lib/ingestion/drive-sync, scoped to the folder row the user just proved they
 * can see.
 */
export const driveService = {
  shareAddress: driveShareAddress,

  async listFolders(householdId: string): Promise<DriveFolderSummary[]> {
    return runInUserTx(async (tx) => {
      const folders = await tx
        .select()
        .from(driveFolders)
        .where(eq(driveFolders.householdId, householdId))
        .orderBy(driveFolders.createdAt);
      const counts = await tx
        .select({
          folderId: driveFiles.folderId,
          // Outcome comes from the job: the file row only knows it was queued.
          bucket: sql<string>`case
            when ${driveFiles.status} = 'unsupported' then 'unsupported'
            when ${driveFiles.status} = 'failed' then 'failed'
            when ${driveFiles.status} = 'pending' then 'waiting'
            when ${ingestionJobs.status} in ('needs_review', 'published') then 'imported'
            when ${ingestionJobs.status} = 'failed' and ${ingestionJobs.error} like 'Skipped%' then 'skipped'
            when ${ingestionJobs.status} = 'failed' then 'failed'
            else 'importing' end`,
          n: sql<number>`count(*)::int`,
        })
        .from(driveFiles)
        .leftJoin(ingestionJobs, eq(ingestionJobs.id, driveFiles.jobId))
        .where(eq(driveFiles.householdId, householdId))
        .groupBy(driveFiles.folderId, sql`2`);
      return folders.map((f) => {
        const c = {
          total: 0,
          waiting: 0,
          importing: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          unsupported: 0,
        };
        for (const row of counts.filter((r) => r.folderId === f.id)) {
          c[row.bucket as keyof typeof c] += row.n;
          c.total += row.n;
        }
        return {
          id: f.id,
          folderName: f.folderName,
          confirmed: f.confirmedAt !== null,
          lastListedAt: f.lastListedAt,
          lastError: f.lastError,
          counts: c,
        };
      });
    });
  },

  /**
   * Register a shared folder and list it, returning the first-sync preview.
   * Nothing is imported until `confirm`. The folder's Drive owner must be a
   * household member, so a household cannot pull in someone else's shared
   * folder by pasting its link.
   */
  async connect(args: {
    householdId: string;
    link: string;
  }): Promise<
    | { ok: true; folderId: string; folderName: string; preview: DrivePreview }
    | { ok: false; error: string }
  > {
    const driveId = parseFolderId(args.link);
    if (!driveId) return { ok: false, error: "That doesn't look like a Google Drive folder link." };
    let folder;
    try {
      folder = await getFolder(driveId);
    } catch (err) {
      if (err instanceof DriveAccessError) return { ok: false, error: err.message };
      throw err;
    }

    const row = await runInUserTx(async (tx, userId) => {
      const members = await tx
        .select({ email: profiles.email })
        .from(householdMembers)
        .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
        .where(eq(householdMembers.householdId, args.householdId));
      const memberEmails = new Set(members.map((m) => m.email?.toLowerCase()).filter(Boolean));
      const owner = folder.ownerEmails.find((e) => memberEmails.has(e));
      if (folder.ownerEmails.length > 0 && !owner) return null;
      const [inserted] = await tx
        .insert(driveFolders)
        .values({
          householdId: args.householdId,
          createdBy: userId,
          folderId: folder.id,
          folderName: folder.name,
          ownerEmail: owner ?? null,
        })
        .onConflictDoUpdate({
          target: [driveFolders.householdId, driveFolders.folderId],
          set: { folderName: folder.name, isActive: true, updatedAt: sql`now()` },
        })
        .returning();
      return inserted ?? null;
    });
    if (!row) {
      return {
        ok: false,
        error:
          "That folder belongs to someone outside your household. Share a folder you own, signed in to Drive with the same email you use here.",
      };
    }
    const preview = await listFolder(row);
    return { ok: true, folderId: row.id, folderName: folder.name, preview };
  },

  /** Start importing (first sync), then hand off to the timer. */
  async confirm(args: { householdId: string; folderRowId: string }): Promise<void> {
    const updated = await runInUserTx((tx) =>
      tx
        .update(driveFolders)
        .set({
          confirmedAt: sql`coalesce(${driveFolders.confirmedAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(driveFolders.id, args.folderRowId),
            eq(driveFolders.householdId, args.householdId),
          ),
        )
        .returning({ id: driveFolders.id }),
    );
    if (updated.length > 0) await queueFiles();
  },

  async syncNow(args: { householdId: string; folderRowId: string }): Promise<DrivePreview | null> {
    const [row] = await runInUserTx((tx) =>
      tx
        .select()
        .from(driveFolders)
        .where(
          and(
            eq(driveFolders.id, args.folderRowId),
            eq(driveFolders.householdId, args.householdId),
          ),
        ),
    );
    if (!row) return null;
    const preview = await listFolder(row);
    if (row.confirmedAt) await queueFiles();
    return preview;
  },

  async remove(args: { householdId: string; folderRowId: string }): Promise<void> {
    await runInUserTx((tx) =>
      tx
        .delete(driveFolders)
        .where(
          and(
            eq(driveFolders.id, args.folderRowId),
            eq(driveFolders.householdId, args.householdId),
          ),
        ),
    );
  },
};
