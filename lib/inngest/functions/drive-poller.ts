import "server-only";
import { inngest } from "@/lib/inngest/client";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { driveClient } from "@/lib/integrations/google-drive";
import { logger } from "@/lib/logger";

const SUPPORTED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/vnd.google-apps.document",
]);

/**
 * Cron-driven sweeper that detects new files in watched Google Drive folders
 * and emits ingestion events. Runs frequently but cheaply (changes feed +
 * page tokens means each tick is O(new files)).
 *
 * For higher freshness, n8n can be configured with a Drive trigger that POSTs
 * to /api/webhooks/drive instead — this poller is the always-on fallback.
 */
export const driveFolderPoller = inngest.createFunction(
  {
    id: "drive-folder-poller",
    name: "Poll watched Google Drive folders",
    concurrency: { limit: 1, key: "event.data.householdId" },
  },
  { cron: "*/10 * * * *" }, // every 10 minutes
  async ({ step }) => {
    const supabase = createSupabaseAdmin();

    const folders = await step.run("load-folders", async () => {
      const { data, error } = await supabase
        .from("drive_watched_folders")
        .select("*, account:integration_accounts(*)")
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    });

    let totalEmitted = 0;

    for (const folder of folders) {
      try {
        const account = folder.account as unknown as {
          id: string;
          access_token: string;
          refresh_token: string | null;
          expires_at: string | null;
          household_id: string;
        };
        if (!account?.access_token) continue;

        const { newFiles, nextPageToken } = await driveClient.listNewFilesInFolder({
          accessToken: account.access_token,
          refreshToken: account.refresh_token ?? undefined,
          folderId: folder.folder_id,
          pageToken: folder.page_token ?? undefined,
        });

        for (const file of newFiles) {
          if (!file.mimeType || !SUPPORTED_MIME.has(file.mimeType)) continue;
          await inngest.send({
            name: "ingestion/drive.file.detected",
            data: {
              householdId: folder.household_id,
              accountId: account.id,
              driveFileId: file.id!,
              mimeType: file.mimeType,
              fileName: file.name ?? "untitled",
            },
          });
          totalEmitted++;
        }

        await supabase
          .from("drive_watched_folders")
          .update({ page_token: nextPageToken, last_synced_at: new Date().toISOString() })
          .eq("id", folder.id);
      } catch (err) {
        logger.error({ err, folderId: folder.id }, "drive folder poll failed");
      }
    }

    return { foldersScanned: folders.length, eventsEmitted: totalEmitted };
  },
);
