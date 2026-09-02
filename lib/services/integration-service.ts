import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { driveWatchedFolders, integrationAccounts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { runInUserTx } from "./user-tx";
import type { Tables } from "@/types/database.types";

/**
 * Google Drive integration reads (account + watched folders).
 *
 * Neon-only by design — unlike the older services there is no Supabase branch.
 * These queries previously ran straight against Supabase from the page bodies;
 * when the Supabase project was deleted the hostname stopped resolving and the
 * import page hung on the client's DNS retry loop instead of rendering. A dead
 * fallback is worse than no fallback, so this throws a clear error instead.
 *
 * Rows are aliased back to snake_case so they match `Tables<"…">`, which is what
 * the Drive components already consume.
 */

type DriveAccount = Tables<"integration_accounts">;
type WatchedFolder = Tables<"drive_watched_folders">;

function requireDb(): void {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required — Supabase has been removed");
}

export const integrationService = {
  /** The household's connected Google Drive account, or null when not connected. */
  async getDriveAccount(householdId: string): Promise<DriveAccount | null> {
    requireDb();
    return runInUserTx(async (tx) => {
      const rows = await tx
        .select({
          id: integrationAccounts.id,
          household_id: integrationAccounts.householdId,
          user_id: integrationAccounts.userId,
          provider: integrationAccounts.provider,
          external_id: integrationAccounts.externalId,
          email: integrationAccounts.email,
          access_token: integrationAccounts.accessToken,
          refresh_token: integrationAccounts.refreshToken,
          scopes: integrationAccounts.scopes,
          expires_at: integrationAccounts.expiresAt,
          metadata: integrationAccounts.metadata,
          created_at: integrationAccounts.createdAt,
          updated_at: integrationAccounts.updatedAt,
        })
        .from(integrationAccounts)
        .where(
          and(
            eq(integrationAccounts.householdId, householdId),
            eq(integrationAccounts.provider, "google_drive"),
          ),
        )
        .limit(1);
      return (rows[0] as DriveAccount | undefined) ?? null;
    });
  },

  /** Watched Drive folders for the household, newest first. */
  async listWatchedFolders(householdId: string): Promise<WatchedFolder[]> {
    requireDb();
    return runInUserTx(async (tx) => {
      const rows = await tx
        .select({
          id: driveWatchedFolders.id,
          account_id: driveWatchedFolders.accountId,
          household_id: driveWatchedFolders.householdId,
          folder_id: driveWatchedFolders.folderId,
          folder_name: driveWatchedFolders.folderName,
          page_token: driveWatchedFolders.pageToken,
          is_active: driveWatchedFolders.isActive,
          last_synced_at: driveWatchedFolders.lastSyncedAt,
          created_at: driveWatchedFolders.createdAt,
          updated_at: driveWatchedFolders.updatedAt,
        })
        .from(driveWatchedFolders)
        .where(eq(driveWatchedFolders.householdId, householdId))
        .orderBy(desc(driveWatchedFolders.createdAt));
      return rows as WatchedFolder[];
    });
  },
};
