import "server-only";
import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest/client";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { driveClient } from "@/lib/integrations/google-drive";
import { pdfExtractText, avgCharsPerPage } from "@/lib/ingestion/pdf-extract-text";
import {
  extractRecipeTitlesFromText,
  extractRecipeTitlesFromImages,
} from "@/lib/ingestion/extract-recipe-titles";
import { logger } from "@/lib/logger";

export const indexDriveFile = inngest.createFunction(
  {
    id: "drive-index-file",
    name: "Index recipe titles from Drive file",
    retries: 2,
    concurrency: { limit: 5 },
    onFailure: async ({ event, error }) => {
      const supabase = createSupabaseAdmin();
      const original = (
        event as { data?: { event?: { data?: { householdId?: string; driveFileId?: string } } } }
      )?.data?.event?.data;
      if (!original?.householdId || !original.driveFileId) return;
      await supabase
        .from("drive_file_index")
        .update({
          index_status: "failed",
          error: error.message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("household_id", original.householdId)
        .eq("drive_file_id", original.driveFileId);
    },
  },
  { event: "drive/file.index-requested" },
  async ({ event, step }) => {
    const { householdId, accountId, driveFileId, fileName, mimeType } = event.data;

    const supabase = createSupabaseAdmin();

    const account = await step.run("load-account", async () => {
      const { data, error } = await supabase
        .from("integration_accounts")
        .select("access_token, refresh_token")
        .eq("id", accountId)
        .single();
      if (error || !data) throw new NonRetriableError(`Account ${accountId} not found`);
      return data;
    });

    await step.run("mark-indexing", async () => {
      await supabase
        .from("drive_file_index")
        .update({ index_status: "indexing", updated_at: new Date().toISOString() })
        .eq("household_id", householdId)
        .eq("drive_file_id", driveFileId);
    });

    const titles = await step.run("extract-titles", async () => {
      const isPdf =
        mimeType === "application/pdf" ||
        mimeType === "application/vnd.google-apps.document";

      if (!isPdf) return [] as string[];

      const buffer = await driveClient.downloadFile({
        accessToken: account.access_token,
        refreshToken: account.refresh_token ?? undefined,
        fileId: driveFileId,
        mimeType,
      });

      const { pages, totalPages } = await pdfExtractText({ buffer, maxPages: 50 });
      const avg = avgCharsPerPage(pages);

      // Helper — fire-and-forget progress write (non-fatal if it fails).
      const reportProgress = (currentPage: number, total: number) =>
        supabase
          .from("drive_file_index")
          .update({ current_page: currentPage, total_pages: total })
          .eq("household_id", householdId)
          .eq("drive_file_id", driveFileId)
          .then(({ error }) => {
            if (error) logger.warn({ err: error.message }, "progress update failed");
          });

      if (avg >= 100) {
        // Text layer present — all pages read at once.
        await reportProgress(totalPages, totalPages);
        const text = pages.join("\n\n");
        return extractRecipeTitlesFromText({ text, fileName });
      }

      // Scanned PDF — render pages one by one and report as each finishes.
      await reportProgress(0, totalPages);
      return extractRecipeTitlesFromImages({
        buffer,
        fileName,
        maxPages: 30,
        onPageRendered: async (pageNum, total) => { await reportProgress(pageNum, total); },
      });
    });

    await step.run("mark-done", async () => {
      await supabase
        .from("drive_file_index")
        .update({
          index_status: "done",
          recipe_titles: titles,
          indexed_at: new Date().toISOString(),
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("household_id", householdId)
        .eq("drive_file_id", driveFileId);
    });

    logger.info({ driveFileId, fileName, titlesFound: titles.length }, "drive file indexed");
    return { driveFileId, titlesFound: titles.length };
  },
);
