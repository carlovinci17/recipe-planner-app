"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { driveClient } from "@/lib/integrations/google-drive";
import { inngest } from "@/lib/inngest/client";
import { recipeService } from "@/lib/services/recipe-service";
import { logger } from "@/lib/logger";

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
