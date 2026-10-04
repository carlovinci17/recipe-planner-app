import "server-only";
import { and, desc, eq, inArray, or, sql as dsql } from "drizzle-orm";
import { startFileIngestion, startUrlIngestion } from "@/lib/ingestion/start-job";
import { ingestionEvents, ingestionJobs, recipes } from "@/lib/db/schema";
import { runInUserTx } from "./user-tx";
import type { RecipeSourceKind, RecipeStatus, Tables } from "@/types/database.types";

const UPLOADS_BUCKET = "recipe-uploads";

/**
 * The recipe fields the import page's "Recent imports" list needs per job —
 * the subset active-jobs.tsx renders (title, status, cover thumbnail). Kept in
 * snake_case to match the Supabase shape the component already consumes.
 */
export type ActiveJobRecipe = {
  id: string;
  title: string;
  status: RecipeStatus;
  ingestion_job_id: string | null;
  cover_image_path: string | null;
  image_paths: string[] | null;
  cover_focal_x: number;
  cover_focal_y: number;
};

export type ActiveJobsBundle = {
  jobs: Tables<"ingestion_jobs">[];
  events: Tables<"ingestion_events">[];
  recipes: ActiveJobRecipe[];
};

/**
 * Reserve a storage path per photo for a multi-photo import.
 *
 * There is nothing to sign: Blob access is keyless, so the browser uploads
 * through /api/storage/upload rather than PUTting to a pre-signed URL. The
 * empty `uploadUrl` keeps the slot shape the client already destructures.
 */
async function signUploadSlots(
  householdId: string,
  jobId: string,
  photos: Array<{ fileName: string; contentType: string }>,
): Promise<Array<{ uploadUrl: string; path: string; index: number }>> {
  return Promise.all(
    photos.map(async (photo, i) => {
      const ext = photo.contentType === "image/png" ? "png" : "jpg";
      const path = `${householdId}/${jobId}/page-${String(i).padStart(3, "0")}.${ext}`;
      // Azure Blob is keyless — the browser POSTs each photo to
      // /api/storage/upload rather than PUTting to a signed URL.
      return { uploadUrl: "", path, index: i };
    }),
  );
}

export const ingestionService = {
  /**
   * Generate a signed upload URL the browser can PUT to. The path is
   * pre-namespaced under <household_id>/<job_id>/source-* so RLS holds.
   */
  async createUploadJob(args: {
    householdId: string;
    sourceKind: RecipeSourceKind;
    fileName: string;
    contentType: string;
  }) {
    const jobId = await runInUserTx(async (tx, userId) => {
      const [job] = await tx
        .insert(ingestionJobs)
        .values({
          householdId: args.householdId,
          createdBy: userId,
          sourceKind: args.sourceKind,
          storageBucket: UPLOADS_BUCKET,
        })
        .returning({ id: ingestionJobs.id });
      if (!job) throw new Error("Failed to create job");
      return job.id;
    });
    const safeName = args.fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const path = `${args.householdId}/${jobId}/source-${safeName}`;
    // Keyless Azure Blob: no signed URL to hand out, the browser uploads via
    // /api/storage/upload. The empty uploadUrl/token keep the response shape.
    return { jobId, uploadUrl: "", token: "", path, bucket: UPLOADS_BUCKET };
  },

  /**
   * Mark upload complete and emit the ingestion event.
   * The browser calls this after the storage PUT succeeds.
   */
  async completeUpload(args: {
    jobId: string;
    storagePath: string;
    /**
     * Explicit 1-based pages to import from a PDF ("2, 5-8, 13-15"). Empty or
     * absent means the whole document. Passed straight to the pipeline, which
     * rasterizes only these pages.
     */
    pageNumbers?: number[];
  }) {
    const job = await runInUserTx(async (tx) => {
      const [j] = await tx
        .update(ingestionJobs)
        .set({ storagePath: args.storagePath })
        .where(eq(ingestionJobs.id, args.jobId))
        .returning({
          householdId: ingestionJobs.householdId,
          sourceKind: ingestionJobs.sourceKind,
        });
      if (!j) throw new Error("Job not found");
      await tx.insert(ingestionEvents).values({
        jobId: args.jobId,
        kind: "file_uploaded",
        payload: { storage_path: args.storagePath },
      });
      return j;
    });
    await startFileIngestion({
      jobId: args.jobId,
      householdId: job.householdId,
      sourceKind: job.sourceKind,
      ...(args.pageNumbers?.length ? { pageNumbers: args.pageNumbers } : {}),
    });
  },

  /**
   * Create a job for multiple photos uploaded as separate page images.
   * Returns N signed upload URLs — browser PUTs each image directly to Storage,
   * then calls completeMultiPhotoUpload to populate page_image_paths and start the pipeline.
   */
  async createMultiPhotoJob(args: {
    householdId: string;
    photos: Array<{ fileName: string; contentType: string }>;
  }) {
    const jobId = await runInUserTx(async (tx, userId) => {
      const [job] = await tx
        .insert(ingestionJobs)
        .values({
          householdId: args.householdId,
          createdBy: userId,
          sourceKind: "image",
          storageBucket: UPLOADS_BUCKET,
        })
        .returning({ id: ingestionJobs.id });
      if (!job) throw new Error("Failed to create job");
      return job.id;
    });
    return { jobId, uploadSlots: await signUploadSlots(args.householdId, jobId, args.photos) };
  },

  /**
   * Called after all photos are uploaded. Populates page_image_paths and fires the pipeline.
   * processUpload will skip download-and-rasterize when page_image_paths is already set.
   */
  async completeMultiPhotoUpload(args: {
    jobId: string;
    householdId: string;
    pageImagePaths: string[];
  }) {
    await runInUserTx(async (tx) => {
      await tx
        .update(ingestionJobs)
        .set({ pageImagePaths: args.pageImagePaths })
        .where(eq(ingestionJobs.id, args.jobId));
      await tx.insert(ingestionEvents).values({
        jobId: args.jobId,
        kind: "file_uploaded",
        payload: { source: "multi_photo", photo_count: args.pageImagePaths.length },
      });
    });
    await startFileIngestion({
      jobId: args.jobId,
      householdId: args.householdId,
      sourceKind: "image" as const,
    });
  },

  async createUrlJob(args: { householdId: string; url: string }) {
    const jobId = await runInUserTx(async (tx, userId) => {
      const [job] = await tx
        .insert(ingestionJobs)
        .values({
          householdId: args.householdId,
          createdBy: userId,
          sourceKind: "url",
          sourceUrl: args.url,
        })
        .returning({ id: ingestionJobs.id });
      if (!job) throw new Error("Failed to create job");
      await tx.insert(ingestionEvents).values({
        jobId: job.id,
        kind: "ingestion_requested",
        payload: { url: args.url },
      });
      return job.id;
    });
    await startUrlIngestion({ jobId, householdId: args.householdId, url: args.url });
    return { jobId };
  },

  /**
   * Flip the originating job to "published" once the user saves the reviewed
   * recipe, so "Recent imports" shows "Saved" rather than "Ready for review".
   * Best-effort and cosmetic: manual recipes have no job, and a missing row is
   * not an error.
   */
  async markJobPublishedForRecipe(recipeId: string): Promise<void> {
    await runInUserTx(async (tx) => {
      await tx
        .update(ingestionJobs)
        .set({ status: "published" })
        .where(and(eq(ingestionJobs.recipeId, recipeId), eq(ingestionJobs.status, "needs_review")));
    });
  },

  /**
   * User-initiated cancel of an in-flight import. Soft-cancel: marks the job
   * `failed` with `error="Cancelled by user"` only if it's still in `draft`
   * or `processing`. The guard prevents racing with a completion that
   * landed at the same instant. The Inngest worker may still finish the
   * remaining steps for that job — the row update at the end is a no-op
   * when status changed mid-flight, so no DB damage occurs. Reuses the
   * existing `failed` status so "Clear failed" sweeps cancelled rows too.
   */
  async cancelJob(jobId: string): Promise<{ cancelled: boolean }> {
    return runInUserTx(async (tx) => {
      const rows = await tx
        .update(ingestionJobs)
        .set({ status: "failed", error: "Cancelled by user" })
        .where(
          and(eq(ingestionJobs.id, jobId), inArray(ingestionJobs.status, ["draft", "processing"])),
        )
        .returning({ id: ingestionJobs.id });
      return { cancelled: rows.length > 0 };
    });
  },

  /**
   * Delete a household's import jobs — all of them, or only the failed ones.
   * Returns the count deleted. Dual-dispatch (Neon vs Supabase). ingestion_events
   * rows cascade via the FK. (Module 11.1 — the delete path off the Supabase client.)
   */
  async clearJobs(args: { householdId: string; onlyFailed?: boolean }): Promise<number> {
    return runInUserTx(async (tx) => {
      const where = args.onlyFailed
        ? and(eq(ingestionJobs.householdId, args.householdId), eq(ingestionJobs.status, "failed"))
        : eq(ingestionJobs.householdId, args.householdId);
      const rows = await tx.delete(ingestionJobs).where(where).returning({ id: ingestionJobs.id });
      return rows.length;
    });
  },

  /**
   * Load the "Recent imports" bundle for a household: the recent jobs, all their
   * events, and the recipes linked to them (reverse FK `ingestion_job_id`, plus
   * the primary FK `job.recipe_id` for legacy single-recipe jobs). Dual-dispatch
   * (Neon vs Supabase); returns snake_case so active-jobs.tsx's assembly is
   * unchanged (Module 11.1 — the ingestion read path off the browser client).
   */
  async listActiveJobs(args: {
    householdId: string;
    limit: number;
    offset?: number;
  }): Promise<ActiveJobsBundle> {
    const offset = args.offset ?? 0;

    return runInUserTx(async (tx) => {
      // Raw select * → native snake_case rows matching Tables<"ingestion_jobs">.
      const jobs = (await tx.execute(dsql`
        select * from ingestion_jobs
        where household_id = ${args.householdId}
        order by created_at desc
        limit ${args.limit} offset ${offset}
      `)) as unknown as Tables<"ingestion_jobs">[];
      if (jobs.length === 0) return { jobs, events: [], recipes: [] };

      const jobIds = jobs.map((j) => j.id);
      const primaryIds = jobs.map((j) => j.recipe_id).filter((id): id is string => !!id);

      const eventRows = await tx
        .select()
        .from(ingestionEvents)
        .where(inArray(ingestionEvents.jobId, jobIds))
        .orderBy(desc(ingestionEvents.createdAt));
      const events: Tables<"ingestion_events">[] = eventRows.map((e) => ({
        id: e.id,
        job_id: e.jobId,
        kind: e.kind,
        payload: e.payload as Tables<"ingestion_events">["payload"],
        created_at: e.createdAt,
      }));

      const recipeFilter = primaryIds.length
        ? or(inArray(recipes.ingestionJobId, jobIds), inArray(recipes.id, primaryIds))
        : inArray(recipes.ingestionJobId, jobIds);
      const recipeRows = await tx
        .select({
          id: recipes.id,
          title: recipes.title,
          status: recipes.status,
          ingestionJobId: recipes.ingestionJobId,
          coverImagePath: recipes.coverImagePath,
          imagePaths: recipes.imagePaths,
          coverFocalX: recipes.coverFocalX,
          coverFocalY: recipes.coverFocalY,
        })
        .from(recipes)
        .where(and(eq(recipes.householdId, args.householdId), recipeFilter));
      const recipeList: ActiveJobRecipe[] = recipeRows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        ingestion_job_id: r.ingestionJobId,
        cover_image_path: r.coverImagePath,
        image_paths: r.imagePaths,
        cover_focal_x: r.coverFocalX,
        cover_focal_y: r.coverFocalY,
      }));

      return { jobs, events, recipes: recipeList };
    });
  },
};
