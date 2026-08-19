"use server";

import { z } from "zod";
import { ingestionService } from "@/lib/services/ingestion-service";
import { householdService } from "@/lib/services/household-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { env } from "@/lib/env";
import { raiseIngestionEvent } from "@/lib/ingestion/start-job";
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
  // NFD decompose then strip combining diacritics (é → e, ñ → n, etc.)
  let n = s.normalize("NFD").replace(/\p{M}/gu, "");
  n = n.toLowerCase();
  // Normalise ALL whitespace variants (newlines, tabs, non-breaking spaces) to space first
  n = n.replace(/\s+/gu, " ");
  n = n.replace(/&/g, "and");
  // All Unicode dash/hyphen characters → space (covers every variant via \p{Dash_Punctuation})
  n = n.replace(/\p{Dash_Punctuation}/gu, " ");
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    n = n.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }
  // Replace anything that's not a letter, digit, or space with a space (not empty string)
  // so adjacent tokens don't accidentally merge: "Style\nGreens" → "Style Greens" not "StyleGreens"
  return n.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function significantWords(name: string): string[] {
  return normalizeTitle(name)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Detect "G R I L L E D" style names where every character is separated by
 * a space — a common PDF extraction artifact. True when >60% of tokens are
 * single characters and there are at least 6 tokens.
 */
function isSpacedChars(s: string): boolean {
  const tokens = s.trim().split(/\s+/);
  if (tokens.length < 6) return false;
  const singles = tokens.filter((t) => t.length === 1).length;
  return singles / tokens.length > 0.6;
}

/** Token overlap score: how many significant words the query and filename share. */
function matchScore(query: string, fileName: string): number {
  // Special case: "G R I L L E D S N A P P E R" — collapse spaces then check
  // whether each significant query word appears as a substring of the collapsed name.
  if (isSpacedChars(fileName)) {
    const collapsed = fileName.replace(/\s+/g, "").toLowerCase();
    const qWords = significantWords(query).filter((w) => w.length > 2);
    if (qWords.length === 0) return 0;
    const found = qWords.filter((w) => collapsed.includes(w));
    return found.length / qWords.length;
  }

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
  /**
   * When the match was found via the recipe-title index (not just filename),
   * this is the specific recipe title found inside the file.
   */
  matchedTitle?: string;
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

    // Fetch existing recipes, in-flight jobs, and the recipe-title index in parallel.
    const [recipesRes, jobsRes, indexRes] = await Promise.all([
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
      supabase
        .from("drive_file_index")
        .select("drive_file_id, file_name, folder_path, mime_type, modified_time, recipe_titles")
        .eq("household_id", parsed.data.householdId)
        .eq("index_status", "done"),
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

    // Build index lookup: fileId → { titles, fileName, folderPath, mimeType, modifiedTime }
    type IndexEntry = {
      fileName: string;
      folderPath: string;
      mimeType: string;
      modifiedTime: string | null;
      titles: string[];
    };
    const indexByFileId = new Map<string, IndexEntry>();
    for (const row of indexRes.data ?? []) {
      if ((row.recipe_titles?.length ?? 0) > 0) {
        indexByFileId.set(row.drive_file_id, {
          fileName: row.file_name,
          folderPath: row.folder_path,
          mimeType: row.mime_type,
          modifiedTime: (row.modified_time as string | null) ?? null,
          titles: row.recipe_titles as string[],
        });
      }
    }

    // For each search name, score via filename AND recipe-title index, then merge.
    const results: DriveSearchResult[] = parsed.data.names.map((name) => {
      // Filename matches from Drive scan
      const filenameHits = new Map<string, { f: (typeof allFiles)[0]; score: number }>();
      for (const f of allFiles) {
        const score = matchScore(name, f.name);
        if (score > 0) filenameHits.set(f.id, { f, score });
      }

      // Index matches: best-scoring title within each indexed file
      const indexHits = new Map<
        string,
        { f: (typeof allFiles)[0] | null; score: number; matchedTitle: string; entry: IndexEntry }
      >();
      for (const [fileId, entry] of indexByFileId) {
        let bestScore = 0;
        let bestTitle = "";
        for (const title of entry.titles) {
          const s = matchScore(name, title);
          if (s > bestScore) { bestScore = s; bestTitle = title; }
        }
        if (bestScore > 0) {
          const f = allFiles.find((af) => af.id === fileId) ?? null;
          indexHits.set(fileId, { f, score: bestScore, matchedTitle: bestTitle, entry });
        }
      }

      // Merge: collect all candidate fileIds
      const allIds = new Set([...filenameHits.keys(), ...indexHits.keys()]);
      const merged: Array<{
        fileId: string;
        f: (typeof allFiles)[0] | null;
        score: number;
        matchedTitle?: string;
        mimeType: string;
        modifiedTime: string | null;
        folderPath: string;
        fileName: string;
      }> = [];

      for (const fileId of allIds) {
        const fn = filenameHits.get(fileId);
        const idx = indexHits.get(fileId);

        // Index match takes precedence when score is equal or better
        if (idx && (!fn || idx.score >= fn.score)) {
          const f = idx.f ?? fn?.f ?? null;
          merged.push({
            fileId,
            f,
            score: idx.score,
            matchedTitle: idx.matchedTitle,
            mimeType: f?.mimeType ?? idx.entry.mimeType,
            modifiedTime: f?.modifiedTime ?? idx.entry.modifiedTime,
            folderPath: f?.folderPath ?? idx.entry.folderPath,
            fileName: f?.name ?? idx.entry.fileName,
          });
        } else if (fn) {
          merged.push({
            fileId,
            f: fn.f,
            score: fn.score,
            mimeType: fn.f.mimeType,
            modifiedTime: fn.f.modifiedTime,
            folderPath: fn.f.folderPath,
            fileName: fn.f.name,
          });
        }
      }

      const top5 = merged.sort((a, b) => b.score - a.score).slice(0, 5);

      const matches: DriveSearchMatch[] = top5.map((item) => {
        const existing =
          recipeBySourceId.get(item.fileId) ??
          recipeByNormTitle.get(normalizeTitle(item.fileName)) ??
          null;
        const alreadyImported = !!existing || inFlightFileIds.has(item.fileId);
        return {
          fileId: item.fileId,
          fileName: item.fileName,
          mimeType: item.mimeType,
          modifiedTime: item.modifiedTime,
          folderPath: item.folderPath,
          supported: SUPPORTED_BULK_MIME.has(item.mimeType),
          alreadyImported,
          existingRecipeId: existing?.id ?? null,
          existingRecipeTitle: existing?.title ?? null,
          matchedTitle: item.matchedTitle,
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

    // Deduplicate by fileId — the user might select the same file for multiple
    // recipe names (e.g. two recipes from the same cookbook PDF).
    const seen = new Set<string>();
    const supported = parsed.data.files.filter((f) => {
      if (!SUPPORTED_BULK_MIME.has(f.mimeType)) return false;
      if (seen.has(f.fileId)) return false;
      seen.add(f.fileId);
      return true;
    });

    if (supported.length === 0) return { ok: true, queued: 0 };

    // Server-side dedup: skip files that already have a recipe or an active job.
    const fileIds = supported.map((f) => f.fileId);
    const [recipesRes, jobsRes] = await Promise.all([
      supabase
        .from("recipes")
        .select("external_source_id")
        .eq("household_id", parsed.data.householdId)
        .in("external_source_id", fileIds)
        .is("archived_at", null),
      supabase
        .from("ingestion_jobs")
        .select("external_file_id")
        .eq("household_id", parsed.data.householdId)
        .in("external_file_id", fileIds)
        .in("status", ["draft", "processing", "needs_review", "published"]),
    ]);

    const alreadyDone = new Set([
      ...(recipesRes.data ?? []).map((r) => r.external_source_id).filter(Boolean) as string[],
      ...(jobsRes.data ?? []).map((j) => j.external_file_id).filter(Boolean) as string[],
    ]);

    const toQueue = supported.filter((f) => !alreadyDone.has(f.fileId));

    if (toQueue.length > 0) {
      await inngest.send(
        toQueue.map((file) => ({
          name: "ingestion/drive.file.detected" as const,
          data: {
            householdId: parsed.data.householdId,
            accountId: account.id,
            driveFileId: file.fileId,
            mimeType: file.mimeType,
            fileName: file.fileName,
          },
        })),
      );
    }

    revalidatePath("/recipes/import");
    return { ok: true, queued: toQueue.length };
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

const CreateMultiPhotoJobSchema = z.object({
  householdId: z.string().uuid(),
  photos: z.array(z.object({
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(1).max(100),
  })).min(1).max(20),
});

export async function createMultiPhotoJobAction(input: z.infer<typeof CreateMultiPhotoJobSchema>) {
  const parsed = CreateMultiPhotoJobSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await assertMembership(parsed.data.householdId);
    const result = await ingestionService.createMultiPhotoJob(parsed.data);
    return { ok: true as const, ...result };
  } catch (err) {
    logger.error({ err }, "createMultiPhotoJobAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const CompleteMultiPhotoUploadSchema = z.object({
  jobId: z.string().uuid(),
  householdId: z.string().uuid(),
  pageImagePaths: z.array(z.string().min(1)).min(1).max(20),
});

export async function completeMultiPhotoUploadAction(input: z.infer<typeof CompleteMultiPhotoUploadSchema>) {
  const parsed = CompleteMultiPhotoUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await assertMembership(parsed.data.householdId);
    await ingestionService.completeMultiPhotoUpload(parsed.data);
    return { ok: true as const };
  } catch (err) {
    logger.error({ err }, "completeMultiPhotoUploadAction failed");
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

    if (env.JOBS_PROVIDER === "durable") {
      // Resume the orchestration parked on waitForExternalEvent (instanceId = jobId).
      await raiseIngestionEvent(parsed.data.jobId, "skimSelection", {
        selectedIndices: parsed.data.selectedIndices,
        sourceName: parsed.data.sourceName ?? null,
        sourceUrl: parsed.data.sourceUrl ?? null,
      });
    } else {
      await inngest.send({
        name: "ingestion/file.skim.committed",
        data: {
          jobId: parsed.data.jobId,
          selectedIndices: parsed.data.selectedIndices,
          sourceName: parsed.data.sourceName ?? null,
          sourceUrl: parsed.data.sourceUrl ?? null,
        },
      });
    }
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

/**
 * Load the "Recent imports" bundle for the import page's ActiveJobs list
 * (Module 11.1). Reads via the service layer (Neon or Supabase), so the client
 * no longer talks to the browser Supabase client — the DB-cutover-safe read path.
 */
export async function loadActiveJobsAction(input: {
  householdId: string;
  limit: number;
  offset?: number;
}) {
  try {
    await assertMembership(input.householdId);
    const bundle = await ingestionService.listActiveJobs(input);
    return { ok: true as const, ...bundle };
  } catch (err) {
    logger.error({ err }, "loadActiveJobsAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}
