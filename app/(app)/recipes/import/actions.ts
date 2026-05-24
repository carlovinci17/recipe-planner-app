"use server";

import { z } from "zod";
import { ingestionService } from "@/lib/services/ingestion-service";
import { householdService } from "@/lib/services/household-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { driveClient } from "@/lib/integrations/google-drive";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

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
  webViewLink: string | null;
  supported: boolean;
};

export type DriveSearchResult = {
  query: string;
  matches: DriveSearchMatch[];
};

/**
 * Search the connected Google Drive account for files matching each of the
 * provided names. Returns up to 5 matches per name so the user can pick the
 * right one when multiple files share a similar title.
 */
export async function searchDriveByNamesAction(
  input: z.infer<typeof SearchDriveByNamesSchema>,
): Promise<{ ok: true; results: DriveSearchResult[] } | { ok: false; error: string }> {
  const parsed = SearchDriveByNamesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    await assertMembership(parsed.data.householdId);

    const supabase = await createSupabaseServerClient();
    const { data: account, error: accErr } = await supabase
      .from("integration_accounts")
      .select("id, access_token, refresh_token")
      .eq("household_id", parsed.data.householdId)
      .eq("provider", "google_drive")
      .maybeSingle();

    if (accErr) throw accErr;
    if (!account) return { ok: false, error: "Google Drive is not connected for this household" };

    // Search each name in parallel, batched to avoid hammering the Drive API.
    const BATCH = 10;
    const results: DriveSearchResult[] = [];

    for (let i = 0; i < parsed.data.names.length; i += BATCH) {
      const batch = parsed.data.names.slice(i, i + BATCH);
      const batchResults = await Promise.all(
        batch.map(async (name): Promise<DriveSearchResult> => {
          const files = await driveClient.searchByName({
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? undefined,
            name,
            limit: 5,
          });
          const matches: DriveSearchMatch[] = files.map((f) => ({
            fileId: f.id!,
            fileName: f.name ?? "Untitled",
            mimeType: f.mimeType ?? "",
            modifiedTime: f.modifiedTime ?? null,
            webViewLink: f.webViewLink ?? null,
            supported: SUPPORTED_BULK_MIME.has(f.mimeType ?? ""),
          }));
          return { query: name, matches };
        }),
      );
      results.push(...batchResults);
    }

    return { ok: true, results };
  } catch (err) {
    logger.error({ err }, "searchDriveByNamesAction failed");
    return { ok: false, error: (err as Error).message };
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
