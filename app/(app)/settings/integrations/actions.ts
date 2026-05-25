"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { driveClient } from "@/lib/integrations/google-drive";
import { inngest } from "@/lib/inngest/client";
import { recipeService } from "@/lib/services/recipe-service";
import { logger } from "@/lib/logger";
import { householdService } from "@/lib/services/household-service";

const SUPPORTED_DRIVE_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/vnd.google-apps.document",
]);

/**
 * Normalize a string for fuzzy title-vs-filename comparison. Lowercase,
 * strip diacritics, drop a trailing extension, replace any non-alnum run
 * with a single space, trim. Two strings normalize-equal iff they describe
 * the same recipe in human terms — "Keto-Mug Bread.pdf" → "keto mug bread".
 */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const AddSchema = z.object({
  householdId: z.string().uuid(),
  accountId: z.string().uuid(),
  folderId: z.string().min(1),
  folderName: z.string().nullable(),
});

export async function addWatchedFolderAction(input: z.infer<typeof AddSchema>) {
  const parsed = AddSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("drive_watched_folders")
    .insert({
      household_id: parsed.data.householdId,
      account_id: parsed.data.accountId,
      folder_id: parsed.data.folderId,
      folder_name: parsed.data.folderName,
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? "Failed" };
  revalidatePath("/settings/integrations");
  return { ok: true as const, folder: data };
}

export async function removeWatchedFolderAction(id: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.from("drive_watched_folders").delete().eq("id", id);
  revalidatePath("/settings/integrations");
}

export async function disconnectGoogleDriveAction(accountId: string) {
  const supabase = await createSupabaseServerClient();
  // Remove watched folders first, then the account row.
  await supabase.from("drive_watched_folders").delete().eq("account_id", accountId);
  await supabase.from("integration_accounts").delete().eq("id", accountId);
  revalidatePath("/settings/integrations");
  revalidatePath("/recipes/import");
}

// =====================================================================
// Drive scan: preview + commit (replaces the old one-shot scan action)
// =====================================================================
// The scan now runs in two phases:
//   1) `previewDriveFolderScanAction` — discovers files, runs three-way
//      dedup (canonical recipe id, in-flight job, fuzzy filename↔title),
//      and returns a per-file status without queueing anything.
//   2) `commitDriveFolderScanAction` — receives the user's per-file
//      decisions (skip / import / replace existing) and queues / deletes
//      accordingly.
//
// Why this UX: legacy recipes pre-date the external_source_id column, so
// the canonical id check can't see them. The fuzzy filename match closes
// that gap, and the user gets to decide per file what to do.
// =====================================================================

export type DriveScanItem = {
  driveFileId: string;
  fileName: string;
  mimeType: string;
  modifiedTime: string | null;
  /** Subfolder path relative to the watched folder, e.g. "Desserts / Cakes". Empty string = root folder. */
  folderPath: string;
  /**
   * `recipe-exists`  — canonical id match on recipes.external_source_id
   * `in-flight`      — non-failed ingestion_jobs row exists for this file
   * `name-match`     — recipe title matches the (normalized) filename
   * `new`            — never seen this file before
   */
  status: "new" | "in-flight" | "recipe-exists" | "name-match";
  /** When the file matched an existing recipe, surface it for the UI. */
  existingRecipeId?: string;
  existingRecipeTitle?: string;
};

const PreviewSchema = z.object({ folderId: z.string().uuid() });

export async function previewDriveFolderScanAction(input: z.infer<typeof PreviewSchema>) {
  const parsed = PreviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };

  const supabase = await createSupabaseServerClient();
  const { data: folder, error: fErr } = await supabase
    .from("drive_watched_folders")
    .select("id, folder_id, household_id, account:integration_accounts(access_token, refresh_token, id)")
    .eq("id", parsed.data.folderId)
    .single();
  if (fErr || !folder) return { ok: false as const, error: "Folder not found" };

  const account = folder.account as unknown as {
    id: string;
    access_token: string;
    refresh_token: string | null;
  } | null;
  if (!account?.access_token) {
    return { ok: false as const, error: "Drive account not connected" };
  }

  const onNewTokens = ({ accessToken, refreshToken }: { accessToken: string; refreshToken?: string }) => {
    supabase
      .from("integration_accounts")
      .update({
        access_token: accessToken,
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
      })
      .eq("id", account.id)
      .then(({ error }) => {
        if (error) logger.warn({ err: error.message, accountId: account.id }, "failed to persist refreshed Drive token");
      });
  };

  let files;
  try {
    files = await driveClient.listAllFilesInFolderRecursive({
      accessToken: account.access_token,
      refreshToken: account.refresh_token ?? undefined,
      onNewTokens,
      folderId: folder.folder_id,
    });
  } catch (err) {
    logger.error({ err, folderId: folder.id }, "drive scan failed");
    const msg = (err as Error).message ?? "";
    if (msg.includes("invalid_grant")) {
      return { ok: false as const, error: "Your Google Drive connection has expired. Please reconnect in Settings → Integrations." };
    }
    return { ok: false as const, error: msg };
  }

  const supported = files.filter(
    (f) => f.id && f.mimeType && SUPPORTED_DRIVE_MIME.has(f.mimeType),
  );

  // Pull every recipe in the household for dedup. We need both
  // external_source_id (canonical) and title (for fuzzy filename match).
  // For typical households (<1000 recipes) this is a single fast query;
  // beyond that, we'd want an FTS-based lookup.
  const [recipesRes, jobsRes] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, title, external_source_id")
      .eq("household_id", folder.household_id)
      .is("archived_at", null),
    supabase
      .from("ingestion_jobs")
      .select("external_file_id, status")
      .eq("household_id", folder.household_id)
      .not("external_file_id", "is", null)
      .in("status", ["draft", "processing", "needs_review", "published"]),
  ]);

  if (recipesRes.error) {
    logger.error({ err: recipesRes.error.message }, "drive preview recipes query failed");
    return {
      ok: false as const,
      error: `Couldn't check existing recipes: ${recipesRes.error.message}`,
    };
  }
  if (jobsRes.error) {
    logger.error({ err: jobsRes.error.message }, "drive preview jobs query failed");
    return {
      ok: false as const,
      error: `Couldn't check existing import jobs: ${jobsRes.error.message}`,
    };
  }

  const recipes = recipesRes.data ?? [];
  const recipeBySourceId = new Map<string, { id: string; title: string }>();
  const recipeByNormalizedTitle = new Map<string, { id: string; title: string }>();
  for (const r of recipes) {
    if (r.external_source_id) {
      recipeBySourceId.set(r.external_source_id, { id: r.id, title: r.title });
    }
    const norm = normalizeForMatch(r.title);
    if (norm && !recipeByNormalizedTitle.has(norm)) {
      // First-wins: if two recipes happen to normalize to the same string,
      // we surface one of them. The user can disambiguate visually.
      recipeByNormalizedTitle.set(norm, { id: r.id, title: r.title });
    }
  }
  const inFlightFileIds = new Set<string>();
  for (const j of jobsRes.data ?? []) {
    if (j.external_file_id) inFlightFileIds.add(j.external_file_id);
  }

  const items: DriveScanItem[] = supported.map((f) => {
    const fileId = f.id!;
    const fileName = f.name ?? "untitled";
    const folderPath = f.folderPath ?? "";

    // Canonical: a recipe was created from exactly this Drive file id.
    const canonical = recipeBySourceId.get(fileId);
    if (canonical) {
      return {
        driveFileId: fileId,
        fileName,
        mimeType: f.mimeType!,
        modifiedTime: f.modifiedTime ?? null,
        folderPath,
        status: "recipe-exists",
        existingRecipeId: canonical.id,
        existingRecipeTitle: canonical.title,
      };
    }

    // In-flight: a non-failed ingestion job already covers this file.
    if (inFlightFileIds.has(fileId)) {
      return {
        driveFileId: fileId,
        fileName,
        mimeType: f.mimeType!,
        modifiedTime: f.modifiedTime ?? null,
        folderPath,
        status: "in-flight",
      };
    }

    // Fuzzy: filename normalizes to an existing recipe title.
    const normFile = normalizeForMatch(fileName);
    const fuzzy = normFile ? recipeByNormalizedTitle.get(normFile) : undefined;
    if (fuzzy) {
      return {
        driveFileId: fileId,
        fileName,
        mimeType: f.mimeType!,
        modifiedTime: f.modifiedTime ?? null,
        folderPath,
        status: "name-match",
        existingRecipeId: fuzzy.id,
        existingRecipeTitle: fuzzy.title,
      };
    }

    return {
      driveFileId: fileId,
      fileName,
      mimeType: f.mimeType!,
      modifiedTime: f.modifiedTime ?? null,
      folderPath,
      status: "new",
    };
  });

  return {
    ok: true as const,
    folderId: folder.id,
    householdId: folder.household_id,
    accountId: account.id,
    items,
    totalDriveFiles: files.length,
  };
}

const CommitSchema = z.object({
  folderId: z.string().uuid(),
  items: z
    .array(
      z.object({
        driveFileId: z.string().min(1),
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
        modifiedTime: z.string().nullable().default(null),
        action: z.enum(["skip", "import", "replace"]),
        existingRecipeId: z.string().uuid().nullable().default(null),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * Apply the user's per-file decisions from the preview dialog.
 *   skip    — no-op
 *   import  — queue the file for ingestion
 *   replace — delete the existing recipe (if id provided), then queue
 *
 * Replacing deletes immediately; the new import runs asynchronously via
 * Inngest. If extraction fails the user loses the old recipe — we surface
 * this risk in the dialog UI before commit.
 */
export async function commitDriveFolderScanAction(input: z.infer<typeof CommitSchema>) {
  const parsed = CommitSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };

  const supabase = await createSupabaseServerClient();
  const { data: folder, error: fErr } = await supabase
    .from("drive_watched_folders")
    .select("id, folder_id, household_id, account:integration_accounts(access_token, refresh_token, id)")
    .eq("id", parsed.data.folderId)
    .single();
  if (fErr || !folder) return { ok: false as const, error: "Folder not found" };

  const account = folder.account as unknown as {
    id: string;
    access_token: string;
    refresh_token: string | null;
  } | null;
  if (!account?.access_token) {
    return { ok: false as const, error: "Drive account not connected" };
  }

  let queued = 0;
  let replaced = 0;
  let skipped = 0;

  // Pre-pass: delete recipes flagged for replacement. Sequenced before
  // queueing so the new import lands cleanly (no duplicate name flicker).
  const replacements = parsed.data.items.filter(
    (it) => it.action === "replace" && it.existingRecipeId,
  );
  for (const r of replacements) {
    try {
      await recipeService.delete(r.existingRecipeId!);
      replaced++;
    } catch (err) {
      logger.error(
        { err: (err as Error).message, recipeId: r.existingRecipeId },
        "replace-existing delete failed",
      );
    }
  }

  // Queue everything that's import or replace (replace falls through here
  // after the delete above).
  const toQueue = parsed.data.items.filter(
    (it) => it.action === "import" || it.action === "replace",
  );
  if (toQueue.length > 0) {
    await inngest.send(
      toQueue.map((it) => ({
        name: "ingestion/drive.file.detected" as const,
        data: {
          householdId: folder.household_id,
          accountId: account.id,
          driveFileId: it.driveFileId,
          mimeType: it.mimeType,
          fileName: it.fileName,
          modifiedTime: it.modifiedTime,
        },
      })),
    );
    queued = toQueue.length;
  }

  skipped = parsed.data.items.filter((it) => it.action === "skip").length;

  await supabase
    .from("drive_watched_folders")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", folder.id);

  revalidatePath("/settings/integrations");
  revalidatePath("/recipes/import");
  revalidatePath("/recipes");
  return { ok: true as const, queued, replaced, skipped };
}

// =====================================================================
// Drive file index — build searchable title index inside PDF files
// =====================================================================

const StartIndexSchema = z.object({
  householdId: z.string().uuid(),
  /** Re-index files that are already done. Useful after adding new watched folders. */
  force: z.boolean().optional().default(false),
});

/**
 * Scan all watched folders for PDFs, upsert rows in drive_file_index,
 * and fire Inngest events to extract recipe titles from each file.
 * Only PDFs and Google Docs are indexed (images are single-recipe and
 * don't benefit from title extraction).
 */
export async function startDriveIndexAction(
  input: z.infer<typeof StartIndexSchema>,
): Promise<{ ok: true; queued: number; skipped: number } | { ok: false; error: string }> {
  const parsed = StartIndexSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    const memberships = await householdService.listForCurrentUser();
    if (!memberships.some((m) => m.household.id === parsed.data.householdId)) {
      return { ok: false, error: "Not a member of this household" };
    }

    const supabase = await createSupabaseServerClient();

    const { data: folders, error: fErr } = await supabase
      .from("drive_watched_folders")
      .select(
        "id, folder_id, folder_name, account:integration_accounts(id, access_token, refresh_token)",
      )
      .eq("household_id", parsed.data.householdId);

    if (fErr) throw fErr;
    if (!folders?.length) return { ok: false, error: "No watched folders configured." };

    const onNewTokensFor =
      (accountId: string) =>
      ({ accessToken, refreshToken }: { accessToken: string; refreshToken?: string }) => {
        supabase
          .from("integration_accounts")
          .update({
            access_token: accessToken,
            ...(refreshToken ? { refresh_token: refreshToken } : {}),
          })
          .eq("id", accountId)
          .then(({ error }) => {
            if (error)
              logger.warn({ err: error.message, accountId }, "failed to persist refreshed token");
          });
      };

    const INDEXABLE_MIME = new Set([
      "application/pdf",
      "application/vnd.google-apps.document",
    ]);

    const fileArrays = await Promise.all(
      folders.map((folder) => {
        const account = folder.account as unknown as {
          id: string;
          access_token: string;
          refresh_token: string | null;
        } | null;
        if (!account?.access_token) return Promise.resolve([]);
        return driveClient
          .listAllFilesInFolderRecursive({
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? undefined,
            onNewTokens: onNewTokensFor(account.id),
            folderId: folder.folder_id,
          })
          .then((files) =>
            files
              .filter((f) => f.id && INDEXABLE_MIME.has(f.mimeType ?? ""))
              .map((f) => ({
                accountId: account.id,
                driveFileId: f.id!,
                fileName: f.name ?? "Untitled",
                mimeType: f.mimeType!,
                folderPath: f.folderPath,
                modifiedTime: f.modifiedTime ?? null,
              })),
          );
      }),
    );

    // Deduplicate across folders
    const seenIds = new Set<string>();
    const allFiles: Array<{
      accountId: string;
      driveFileId: string;
      fileName: string;
      mimeType: string;
      folderPath: string;
      modifiedTime: string | null;
    }> = [];
    for (const batch of fileArrays) {
      for (const f of batch) {
        if (seenIds.has(f.driveFileId)) continue;
        seenIds.add(f.driveFileId);
        allFiles.push(f);
      }
    }

    if (allFiles.length === 0) return { ok: true, queued: 0, skipped: 0 };

    // Fetch existing index status to skip already-done files (unless force).
    const { data: existingRows } = await supabase
      .from("drive_file_index")
      .select("drive_file_id, index_status")
      .eq("household_id", parsed.data.householdId)
      .in(
        "drive_file_id",
        allFiles.map((f) => f.driveFileId),
      );

    const existingStatus = new Map<string, string>();
    for (const row of existingRows ?? []) {
      existingStatus.set(row.drive_file_id, row.index_status);
    }

    const toIndex = parsed.data.force
      ? allFiles
      : allFiles.filter((f) => {
          const status = existingStatus.get(f.driveFileId);
          // Skip files already done or in progress; queue new/failed ones.
          return !status || status === "failed" || status === "pending";
        });

    const skipped = allFiles.length - toIndex.length;

    if (toIndex.length === 0) return { ok: true, queued: 0, skipped };

    // Upsert pending rows for all files to index.
    await supabase.from("drive_file_index").upsert(
      toIndex.map((f) => ({
        household_id: parsed.data.householdId,
        drive_file_id: f.driveFileId,
        file_name: f.fileName,
        folder_path: f.folderPath,
        mime_type: f.mimeType,
        modified_time: f.modifiedTime ? new Date(f.modifiedTime).toISOString() : null,
        index_status: "pending",
        recipe_titles: [],
        error: null,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "household_id,drive_file_id" },
    );

    // Fire an index event per file. Batch into chunks of 100 to stay within
    // Inngest's bulk-send limit (500 events).
    const CHUNK = 100;
    for (let i = 0; i < toIndex.length; i += CHUNK) {
      const chunk = toIndex.slice(i, i + CHUNK);
      await inngest.send(
        chunk.map((f) => ({
          name: "drive/file.index-requested" as const,
          data: {
            householdId: parsed.data.householdId,
            accountId: f.accountId,
            driveFileId: f.driveFileId,
            fileName: f.fileName,
            mimeType: f.mimeType,
            folderPath: f.folderPath,
          },
        })),
      );
    }

    revalidatePath("/recipes/import");
    return { ok: true, queued: toIndex.length, skipped };
  } catch (err) {
    logger.error({ err }, "startDriveIndexAction failed");
    const msg = (err as Error).message ?? "";
    if (msg.includes("invalid_grant")) {
      return {
        ok: false,
        error:
          "Your Google Drive connection has expired. Please reconnect in Settings → Integrations.",
      };
    }
    return { ok: false, error: msg };
  }
}

export type DriveIndexStatus = {
  total: number;
  done: number;
  pending: number;
  indexing: number;
  failed: number;
  totalRecipes: number;
  lastIndexedAt: string | null;
  isBuilding: boolean;
  /** The file currently being indexed, if any. */
  currentFile?: {
    fileName: string;
    currentPage: number | null;
    totalPages: number | null;
    indexMethod: string | null;
  };
  /** Files that failed or completed with 0 titles — shown only when not building. */
  problemFiles?: Array<{
    fileName: string;
    status: "failed" | "no_titles";
    error: string | null;
    indexMethod: string | null;
  }>;
};

const GetIndexStatusSchema = z.object({ householdId: z.string().uuid() });

/** Return aggregate counts for the household's Drive file index. */
export async function getDriveIndexStatusAction(
  input: z.infer<typeof GetIndexStatusSchema>,
): Promise<{ ok: true; status: DriveIndexStatus } | { ok: false; error: string }> {
  const parsed = GetIndexStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    const memberships = await householdService.listForCurrentUser();
    if (!memberships.some((m) => m.household.id === parsed.data.householdId)) {
      return { ok: false, error: "Not a member of this household" };
    }

    const supabase = await createSupabaseServerClient();

    // Main status query — does NOT include current_page/total_pages so it
    // works even if the migration adding those columns hasn't been applied yet.
    const { data: rows, error } = await supabase
      .from("drive_file_index")
      .select("index_status, indexed_at, recipe_titles, file_name")
      .eq("household_id", parsed.data.householdId);

    if (error) throw error;

    const counts = { total: 0, done: 0, pending: 0, indexing: 0, failed: 0 };
    let totalRecipes = 0;
    let lastIndexedAt: string | null = null;
    let currentFileName: string | null = null;

    for (const row of rows ?? []) {
      counts.total++;
      counts[row.index_status as keyof typeof counts] =
        (counts[row.index_status as keyof typeof counts] ?? 0) + 1;
      if (row.index_status === "done") {
        totalRecipes += row.recipe_titles?.length ?? 0;
        if (row.indexed_at) {
          if (!lastIndexedAt || row.indexed_at > lastIndexedAt) {
            lastIndexedAt = row.indexed_at;
          }
        }
      }
      if (row.index_status === "indexing" && !currentFileName) {
        currentFileName = row.file_name;
      }
    }

    const isBuilding = counts.pending > 0 || counts.indexing > 0;

    // Page-progress + method query — separate so missing columns only degrade
    // the progress display, not the whole status.
    let currentFile: DriveIndexStatus["currentFile"];
    if (currentFileName) {
      currentFile = { fileName: currentFileName, currentPage: null, totalPages: null, indexMethod: null };
      try {
        const { data: prog } = await supabase
          .from("drive_file_index")
          .select("current_page, total_pages, index_method")
          .eq("household_id", parsed.data.householdId)
          .eq("file_name", currentFileName)
          .eq("index_status", "indexing")
          .maybeSingle();
        if (prog) {
          currentFile.currentPage = prog.current_page ?? null;
          currentFile.totalPages = prog.total_pages ?? null;
          currentFile.indexMethod = prog.index_method ?? null;
        }
      } catch {
        // Columns not yet in DB — details simply won't show.
      }
    }

    // Problem files — only fetched when not building (not polled every 2 s).
    let problemFiles: DriveIndexStatus["problemFiles"];
    if (!isBuilding && counts.total > 0) {
      try {
        const { data: problems } = await supabase
          .from("drive_file_index")
          .select("file_name, index_status, error, index_method, recipe_titles")
          .eq("household_id", parsed.data.householdId)
          .in("index_status", ["failed", "done"])
          .order("updated_at", { ascending: false })
          .limit(100);

        problemFiles = (problems ?? [])
          .filter((f) => f.index_status === "failed" || !f.recipe_titles?.length)
          .slice(0, 30)
          .map((f) => ({
            fileName: f.file_name,
            status: (f.index_status === "failed" ? "failed" : "no_titles") as "failed" | "no_titles",
            error: f.error ?? null,
            indexMethod: f.index_method ?? null,
          }));
      } catch {
        // Non-fatal — problem list simply won't show.
      }
    }

    return {
      ok: true,
      status: {
        ...counts,
        totalRecipes,
        lastIndexedAt,
        isBuilding,
        currentFile,
        problemFiles,
      },
    };
  } catch (err) {
    logger.error({ err }, "getDriveIndexStatusAction failed");
    return { ok: false, error: (err as Error).message };
  }
}

const CancelIndexSchema = z.object({ householdId: z.string().uuid() });

/**
 * Cancel pending indexing jobs by marking all `pending` rows as `failed`.
 * Already-running (`indexing`) Inngest jobs are left alone — they will
 * complete naturally and flip their rows to `done`. The UI stops polling
 * as soon as `pending` drops to zero.
 */
export async function cancelDriveIndexAction(
  input: z.infer<typeof CancelIndexSchema>,
): Promise<{ ok: true; cancelled: number } | { ok: false; error: string }> {
  const parsed = CancelIndexSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    const memberships = await householdService.listForCurrentUser();
    if (!memberships.some((m) => m.household.id === parsed.data.householdId)) {
      return { ok: false, error: "Not a member of this household" };
    }

    const supabase = await createSupabaseServerClient();
    const { count, error } = await supabase
      .from("drive_file_index")
      .update(
        {
          index_status: "failed",
          error: "Cancelled by user",
          updated_at: new Date().toISOString(),
        },
        { count: "exact" },
      )
      .eq("household_id", parsed.data.householdId)
      .eq("index_status", "pending");

    if (error) throw error;
    revalidatePath("/recipes/import");
    return { ok: true, cancelled: count ?? 0 };
  } catch (err) {
    logger.error({ err }, "cancelDriveIndexAction failed");
    return { ok: false, error: (err as Error).message };
  }
}
