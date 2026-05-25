"use server";

import { z } from "zod";
import { ingestionService } from "@/lib/services/ingestion-service";
import { householdService } from "@/lib/services/household-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { driveClient } from "@/lib/integrations/google-drive";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

// ── Fuzzy name matching helpers ───────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "by",
  "with", "as", "is", "are", "was", "were", "its", "my", "our", "your",
]);

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
};

function normalizeTitle(s: string): string {
  let n = s.toLowerCase().replace(/&/g, "and").replace(/[-–—]/g, " ");
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    n = n.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }
  return n.replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function significantWords(name: string): string[] {
  return normalizeTitle(name)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/** Token overlap score: how many significant words the query and filename share. */
function matchScore(query: string, fileName: string): number {
  const qWords = new Set(significantWords(query));
  const fWords = new Set(significantWords(fileName));
  if (qWords.size === 0) return 0;
  let overlap = 0;
  for (const w of qWords) if (fWords.has(w)) overlap++;
  return overlap / Math.max(qWords.size, fWords.size);
}


// ── Bulk Drive import ─────────────────────────────────────────────────────────

const SUPPORTED_BULK_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/vnd.google-apps.document",
]);

const SearchDriveByNamesSchema = z.object({
  householdId: z.string().uuid(),
  names: z.array(z.string().min(1).max(300)).min(1).max(200),
});

export type DriveSearchMatch = {
  fileId: string;
  fileName: string;
  mimeType: string;
  modifiedTime: string | null;
  folderPath: string;
  supported: boolean;
  /** Recipe already imported from this exact Drive file. */
  alreadyImported: boolean;
  existingRecipeId: string | null;
  existingRecipeTitle: string | null;
};

export type DriveSearchResult = {
  query: string;
  /** Top matches sorted by similarity score, highest first. */
  matches: DriveSearchMatch[];
};

/**
 * Scan all watched folders for the household (including subfolders), then
 * fuzzy-match each provided name against the file names found. Returns up to
 * 5 candidates per name ranked by token-overlap similarity, with already-
 * imported files flagged so the user can choose to skip them.
 */
export async function searchDriveByNamesAction(
  input: z.infer<typeof SearchDriveByNamesSchema>,
): Promise<
  | { ok: true; results: DriveSearchResult[]; totalFiles: number; folderCount: number }
  | { ok: false; error: string }
> {
  const parsed = SearchDriveByNamesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    await assertMembership(parsed.data.householdId);

    const supabase = await createSupabaseServerClient();

    // Load all watched folders with their account credentials.
    const { data: folders, error: fErr } = await supabase
      .from("drive_watched_folders")
      .select(
        "id, folder_id, folder_name, account:integration_accounts(id, access_token, refresh_token)",
      )
      .eq("household_id", parsed.data.householdId);

    if (fErr) throw fErr;
    if (!folders?.length) {
      return {
        ok: false,
        error: "No watched folders configured. Add a folder in the Google Drive section above.",
      };
    }

    // Build per-account token-refresh callbacks.
    const onNewTokensFor = (accountId: string) =>
      ({ accessToken, refreshToken }: { accessToken: string; refreshToken?: string }) => {
        supabase
          .from("integration_accounts")
          .update({
            access_token: accessToken,
            ...(refreshToken ? { refresh_token: refreshToken } : {}),
          })
          .eq("id", accountId)
          .then(({ error }) => {
            if (error) logger.warn({ err: error.message, accountId }, "failed to persist refreshed Drive token");
          });
      };

    // Scan all watched folders in parallel.
    const fileArrays = await Promise.all(
      folders.map((folder) => {
        const account = folder.account as unknown as {
          id: string;
          access_token: string;
          refresh_token: string | null;
        } | null;
        if (!account?.access_token) return Promise.resolve([]);
        return driveClient.listAllFilesInFolderRecursive({
          accessToken: account.access_token,
          refreshToken: account.refresh_token ?? undefined,
          onNewTokens: onNewTokensFor(account.id),
          folderId: folder.folder_id,
        });
      }),
    );

    // Deduplicate by file id across folders, keep only supported types.
    const seenIds = new Set<string>();
    const allFiles: Array<{ id: string; name: string; mimeType: string; modifiedTime: string | null; folderPath: string }> = [];
    for (const batch of fileArrays) {
      for (const f of batch) {
        if (!f.id || seenIds.has(f.id)) continue;
        if (!SUPPORTED_BULK_MIME.has(f.mimeType ?? "")) continue;
        seenIds.add(f.id);
        allFiles.push({
          id: f.id,
          name: f.name ?? "Untitled",
          mimeType: f.mimeType ?? "",
          modifiedTime: f.modifiedTime ?? null,
          folderPath: f.folderPath,
        });
      }
    }

    // Fetch existing recipes and in-flight jobs for already-imported detection.
    const [recipesRes, jobsRes] = await Promise.all([
      supabase
        .from("recipes")
        .select("id, title, external_source_id")
        .eq("household_id", parsed.data.householdId)
        .is("archived_at", null),
      supabase
        .from("ingestion_jobs")
        .select("external_file_id")
        .eq("household_id", parsed.data.householdId)
        .not("external_file_id", "is", null)
        .in("status", ["draft", "processing", "needs_review", "published"]),
    ]);

    const recipeBySourceId = new Map<string, { id: string; title: string }>();
    const recipeByNormTitle = new Map<string, { id: string; title: string }>();
    for (const r of recipesRes.data ?? []) {
      if (r.external_source_id) recipeBySourceId.set(r.external_source_id, { id: r.id, title: r.title });
      const norm = normalizeTitle(r.title);
      if (norm && !recipeByNormTitle.has(norm)) recipeByNormTitle.set(norm, { id: r.id, title: r.title });
    }
    const inFlightFileIds = new Set(
      (jobsRes.data ?? []).map((j) => j.external_file_id).filter(Boolean) as string[],
    );

    // For each search name, score every file and return the top 5.
    const results: DriveSearchResult[] = parsed.data.names.map((name) => {
      const scored = allFiles
        .map((f) => ({ f, score: matchScore(name, f.name) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      const matches: DriveSearchMatch[] = scored.map(({ f }) => {
        const existing =
          recipeBySourceId.get(f.id) ??
          recipeByNormTitle.get(normalizeTitle(f.name)) ??
          null;
        const alreadyImported = !!existing || inFlightFileIds.has(f.id);
        return {
          fileId: f.id,
          fileName: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
          folderPath: f.folderPath,
          supported: SUPPORTED_BULK_MIME.has(f.mimeType),
          alreadyImported,
          existingRecipeId: existing?.id ?? null,
          existingRecipeTitle: existing?.title ?? null,
        };
      });

      return { query: name, matches };
    });

    return { ok: true, results, totalFiles: allFiles.length, folderCount: folders.length };
  } catch (err) {
    logger.error({ err }, "searchDriveByNamesAction failed");
    const msg = (err as Error).message ?? "";
    if (msg.includes("invalid_grant")) {
      return {
        ok: false,
        error: "Your Google Drive connection has expired. Please reconnect in Settings → Integrations.",
      };
    }
    return { ok: false, error: msg };
  }
}

const QueueBulkDriveSchema = z.object({
  householdId: z.string().uuid(),
  files: z
    .array(
      z.object({
        fileId: z.string().min(1),
        fileName: z.string().min(1).max(300),
        mimeType: z.string().min(1),
      }),
    )
    .min(1)
    .max(200),
});

/**
 * Queue a confirmed list of Drive files for ingestion. Each file fires an
 * `ingestion/drive.file.detected` event — the existing Inngest pipeline
 * handles download → extraction → review from there.
 */
export async function queueBulkDriveImportAction(
  input: z.infer<typeof QueueBulkDriveSchema>,
): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const parsed = QueueBulkDriveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    await assertMembership(parsed.data.householdId);

    const supabase = await createSupabaseServerClient();
    const { data: account, error: accErr } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("household_id", parsed.data.householdId)
      .eq("provider", "google_drive")
      .maybeSingle();

    if (accErr) throw accErr;
    if (!account) return { ok: false, error: "Google Drive is not connected for this household" };

    const supported = parsed.data.files.filter((f) => SUPPORTED_BULK_MIME.has(f.mimeType));

    await Promise.all(
      supported.map((file) =>
        inngest.send({
          name: "ingestion/drive.file.detected",
          data: {
            householdId: parsed.data.householdId,
            accountId: account.id,
            driveFileId: file.fileId,
            mimeType: file.mimeType,
            fileName: file.fileName,
          },
        }),
      ),
    );

    revalidatePath("/recipes/import");
    return { ok: true, queued: supported.length };
  } catch (err) {
    logger.error({ err }, "queueBulkDriveImportAction failed");
    return { ok: false, error: (err as Error).message };
  }
}

async function assertMembership(householdId: string) {
  const memberships = await householdService.listForCurrentUser();
  if (!memberships.some((m) => m.household.id === householdId)) {
    throw new Error("Not a member of this household");
  }
}

const CreateUrlSchema = z.object({
  householdId: z.string().uuid(),
  url: z.string().url(),
});

export async function createUrlJobAction(input: z.infer<typeof CreateUrlSchema>) {
  const parsed = CreateUrlSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid URL" };
  try {
    await assertMembership(parsed.data.householdId);
    const result = await ingestionService.createUrlJob(parsed.data);
    return { ok: true as const, ...result };
  } catch (err) {
    logger.error({ err }, "createUrlJobAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const CancelJobSchema = z.object({
  jobId: z.string().uuid(),
  householdId: z.string().uuid(),
});

/**
 * User-initiated cancel of an in-flight import. Soft-cancel — marks the job
 * failed with a "Cancelled by user" reason; the row stays visible until the
 * user clears it via "Clear failed".
 */
export async function cancelJobAction(input: z.infer<typeof CancelJobSchema>) {
  const parsed = CancelJobSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await assertMembership(parsed.data.householdId);
    const result = await ingestionService.cancelJob(parsed.data.jobId);
    revalidatePath("/recipes/import");
    return { ok: true as const, cancelled: result.cancelled };
  } catch (err) {
    logger.error({ err }, "cancelJobAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const ClearFailedSchema = z.object({
  householdId: z.string().uuid(),
});

/**
 * Hard-delete failed ingestion jobs for the household. RLS scopes to members.
 * Cascades remove ingestion_events. Used by the "Clear failed" button on the
 * Recent imports list.
 */
export async function clearFailedJobsAction(input: z.infer<typeof ClearFailedSchema>) {
  const parsed = ClearFailedSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await assertMembership(parsed.data.householdId);
    const supabase = await createSupabaseServerClient();
    const { error, count } = await supabase
      .from("ingestion_jobs")
      .delete({ count: "exact" })
      .eq("household_id", parsed.data.householdId)
      .eq("status", "failed");
    if (error) throw error;
    revalidatePath("/recipes/import");
    return { ok: true as const, cleared: count ?? 0 };
  } catch (err) {
    logger.error({ err }, "clearFailedJobsAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const ClearAllSchema = z.object({ householdId: z.string().uuid() });

/**
 * Hard-delete EVERY ingestion job for the household — failed, completed, and
 * in-flight alike. The recipes themselves stay (recipes.ingestion_job_id has
 * `on delete set null`); only the import history is wiped.
 *
 * In-flight Inngest workers will see their job row vanish; their final
 * `.update().eq('id', jobId)` will no-op without throwing.
 */
export async function clearAllJobsAction(input: z.infer<typeof ClearAllSchema>) {
  const parsed = ClearAllSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await assertMembership(parsed.data.householdId);
    const supabase = await createSupabaseServerClient();
    const { error, count } = await supabase
      .from("ingestion_jobs")
      .delete({ count: "exact" })
      .eq("household_id", parsed.data.householdId);
    if (error) throw error;
    revalidatePath("/recipes/import");
    return { ok: true as const, cleared: count ?? 0 };
  } catch (err) {
    logger.error({ err }, "clearAllJobsAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const CreatePhotoJobSchema = z.object({
  householdId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
});

export async function createPhotoJobAction(input: z.infer<typeof CreatePhotoJobSchema>) {
  const parsed = CreatePhotoJobSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await assertMembership(parsed.data.householdId);
    const result = await ingestionService.createUploadJob({
      householdId: parsed.data.householdId,
      sourceKind: "image",
      fileName: parsed.data.fileName,
      contentType: parsed.data.contentType,
    });
    return { ok: true as const, ...result };
  } catch (err) {
    logger.error({ err }, "createPhotoJobAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const CompletePhotoUploadSchema = z.object({
  jobId: z.string().uuid(),
  storagePath: z.string().min(1),
});

export async function completePhotoUploadAction(input: z.infer<typeof CompletePhotoUploadSchema>) {
  const parsed = CompletePhotoUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await ingestionService.completeUpload({
      jobId: parsed.data.jobId,
      storagePath: parsed.data.storagePath,
    });
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "completePhotoUploadAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const CommitSkimSchema = z.object({
  jobId: z.string().uuid(),
  selectedIndices: z.array(z.number().int().min(0)).max(200),
  // Optional batch-level source override applied to every imported recipe.
  // Null/absent leaves the per-recipe AI/URL-derived defaults intact.
  sourceName: z.string().min(1).max(100).nullable().optional(),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
});

/**
 * Resume a processUpload that's parked on `step.waitForEvent` after a skim.
 * The user picks which recipes (by index into skim_results.recipes) to
 * deep-extract; we fire the matching Inngest event to unblock the function.
 *
 * Passing an empty `selectedIndices` is interpreted as "cancel" — the
 * pipeline will mark the job failed cleanly rather than extract anything.
 */
export async function commitSkimSelectionAction(input: z.infer<typeof CommitSkimSchema>) {
  const parsed = CommitSkimSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    // Membership check: the job must belong to a household the caller is in.
    const supabase = await createSupabaseServerClient();
    const { data: job, error: jobErr } = await supabase
      .from("ingestion_jobs")
      .select("id, household_id")
      .eq("id", parsed.data.jobId)
      .single();
    if (jobErr || !job) {
      return { ok: false as const, error: "Job not found" };
    }
    const memberships = await householdService.listForCurrentUser();
    if (!memberships.some((m) => m.household.id === job.household_id)) {
      return { ok: false as const, error: "Not a member of this household" };
    }

    await inngest.send({
      name: "ingestion/file.skim.committed",
      data: {
        jobId: parsed.data.jobId,
        selectedIndices: parsed.data.selectedIndices,
        sourceName: parsed.data.sourceName ?? null,
        sourceUrl: parsed.data.sourceUrl ?? null,
      },
    });
    revalidatePath("/recipes/import");
    return {
      ok: true as const,
      committedCount: parsed.data.selectedIndices.length,
    };
  } catch (err) {
    logger.error({ err }, "commitSkimSelectionAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}
