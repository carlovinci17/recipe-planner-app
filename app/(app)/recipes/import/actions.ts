"use server";

import { z } from "zod";
import { ingestionService } from "@/lib/services/ingestion-service";
import { ingestionStore } from "@/lib/ingestion/store";
import { householdService } from "@/lib/services/household-service";
import { raiseIngestionEvent } from "@/lib/ingestion/start-job";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { MAX_SELECTED_PAGES } from "@/lib/ingestion/page-range";

/**
 * Authorization for every action in this file: the caller must belong to the
 * household they are acting on. Defence in depth — Row-Level Security (RLS)
 * enforces the same rule at the row level, but an action that checks first
 * fails with a clear message instead of a silently empty result.
 *
 * Lived further down the file until the Google Drive actions above it were
 * removed with the Inngest decommission.
 */
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
    const cleared = await ingestionService.clearJobs({
      householdId: parsed.data.householdId,
      onlyFailed: true,
    });
    revalidatePath("/recipes/import");
    return { ok: true as const, cleared };
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
    const cleared = await ingestionService.clearJobs({ householdId: parsed.data.householdId });
    revalidatePath("/recipes/import");
    return { ok: true as const, cleared };
  } catch (err) {
    logger.error({ err }, "clearAllJobsAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}

const CreatePhotoJobSchema = z.object({
  householdId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  // "pdf" routes through the rasterize path in `prepare`; defaults to a single image.
  sourceKind: z.enum(["image", "pdf"]).optional(),
});

export async function createPhotoJobAction(input: z.infer<typeof CreatePhotoJobSchema>) {
  const parsed = CreatePhotoJobSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    await assertMembership(parsed.data.householdId);
    const result = await ingestionService.createUploadJob({
      householdId: parsed.data.householdId,
      sourceKind: parsed.data.sourceKind ?? "image",
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
  // Explicit 1-based PDF pages to import, already parsed from the user's
  // "2, 5-8, 13-15". Absent or empty means the whole document. Re-checked
  // here rather than trusted: the browser parsed it, but the browser is not
  // the gate.
  pageNumbers: z
    .array(z.number().int().min(1))
    .max(MAX_SELECTED_PAGES)
    .optional(),
});

export async function completePhotoUploadAction(input: z.infer<typeof CompletePhotoUploadSchema>) {
  const parsed = CompletePhotoUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };
  try {
    // Authorize against the job's household. Row-Level Security (RLS) would
    // also stop a cross-household write, but every sibling action checks
    // explicitly too — defence in depth, per the project conventions.
    const job = await ingestionStore.getJob(parsed.data.jobId);
    if (!job) return { ok: false as const, error: "Job not found" };
    await assertMembership(job.household_id);

    await ingestionService.completeUpload({
      jobId: parsed.data.jobId,
      storagePath: parsed.data.storagePath,
      pageNumbers: parsed.data.pageNumbers,
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
    // Read via the Neon-aware store (admin), then authorize explicitly.
    const job = await ingestionStore.getJob(parsed.data.jobId);
    if (!job) {
      return { ok: false as const, error: "Job not found" };
    }
    const memberships = await householdService.listForCurrentUser();
    if (!memberships.some((m) => m.household.id === job.household_id)) {
      return { ok: false as const, error: "Not a member of this household" };
    }

    // Resume the orchestration parked on waitForExternalEvent (instanceId = jobId).
    await raiseIngestionEvent(parsed.data.jobId, "skimSelection", {
      selectedIndices: parsed.data.selectedIndices,
      sourceName: parsed.data.sourceName ?? null,
      sourceUrl: parsed.data.sourceUrl ?? null,
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
