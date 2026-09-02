import "server-only";
import { and, desc, eq, inArray, or, sql as dsql } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { startFileIngestion, startUrlIngestion } from "@/lib/ingestion/start-job";
import { ingestionEvents, ingestionJobs, recipes } from "@/lib/db/schema";
import { runInUserTx } from "./user-tx";
import { env } from "@/lib/env";
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
 * Sign (or, on keyless Azure Blob, stub) N per-photo upload slots. Shared by the
 * Neon and Supabase branches of createMultiPhotoJob so the storage behaviour is
 * identical regardless of which DB the job row landed in. Storage dispatches on
 * STORAGE_PROVIDER; the DB is a separate axis (ADR-0006 / ADR-0011 coupling).
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
      // Azure is keyless — the browser POSTs each photo to /api/storage/upload.
      if (env.STORAGE_PROVIDER === "azure") return { uploadUrl: "", path, index: i };
      const supabase = await createSupabaseServerClient();
      const { data: signed, error: signErr } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw signErr ?? new Error(`Failed to sign upload ${i}`);
      return { uploadUrl: signed.signedUrl, path, index: i };
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
    if (env.DATABASE_URL) {
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
      if (env.STORAGE_PROVIDER === "azure") {
        return { jobId, uploadUrl: "", token: "", path, bucket: UPLOADS_BUCKET };
      }
      const supabase = await createSupabaseServerClient();
      const { data: signed, error: signErr } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw signErr ?? new Error("Failed to sign upload");
      return { jobId, uploadUrl: signed.signedUrl, token: signed.token, path, bucket: UPLOADS_BUCKET };
    }
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data: job, error } = await supabase
      .from("ingestion_jobs")
      .insert({
        household_id: args.householdId,
        created_by: user.id,
        source_kind: args.sourceKind,
        storage_bucket: UPLOADS_BUCKET,
      })
      .select("id")
      .single();
    if (error || !job) throw error ?? new Error("Failed to create job");

    const safeName = args.fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const path = `${args.householdId}/${job.id}/source-${safeName}`;

    const { data: signed, error: signErr } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .createSignedUploadUrl(path);
    if (signErr || !signed) throw signErr ?? new Error("Failed to sign upload");

    return {
      jobId: job.id,
      uploadUrl: signed.signedUrl,
      token: signed.token,
      path,
      bucket: UPLOADS_BUCKET,
    };
  },

  /**
   * Mark upload complete and emit the ingestion event.
   * The browser calls this after the storage PUT succeeds.
   */
  async completeUpload(args: { jobId: string; storagePath: string }) {
    if (env.DATABASE_URL) {
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
      });
      return;
    }
    const supabase = await createSupabaseServerClient();
    // Don't transition to 'processing' here — that's the worker's job. The
    // gap between this call and the worker actually starting can be tens
    // of minutes if the queue is busy, and a row claiming "processing"
    // while no worker is touching it confuses both the UI and the
    // stuck-job sweep.
    const { data: job, error } = await supabase
      .from("ingestion_jobs")
      .update({ storage_path: args.storagePath })
      .eq("id", args.jobId)
      .select("household_id, source_kind")
      .single();
    if (error || !job) throw error ?? new Error("Job not found");

    await supabase.from("ingestion_events").insert({
      job_id: args.jobId,
      kind: "file_uploaded",
      payload: { storage_path: args.storagePath },
    });

    await startFileIngestion({
      jobId: args.jobId,
      householdId: job.household_id,
      sourceKind: job.source_kind,
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
    if (env.DATABASE_URL) {
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
    }
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data: job, error } = await supabase
      .from("ingestion_jobs")
      .insert({ household_id: args.householdId, created_by: user.id, source_kind: "image" as const, storage_bucket: UPLOADS_BUCKET })
      .select("id")
      .single();
    if (error || !job) throw error ?? new Error("Failed to create job");

    return { jobId: job.id, uploadSlots: await signUploadSlots(args.householdId, job.id, args.photos) };
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
    if (env.DATABASE_URL) {
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
      return;
    }
    const supabase = await createSupabaseServerClient();
    await supabase
      .from("ingestion_jobs")
      .update({ page_image_paths: args.pageImagePaths })
      .eq("id", args.jobId);

    await supabase.from("ingestion_events").insert({
      job_id: args.jobId,
      kind: "file_uploaded",
      payload: { source: "multi_photo", photo_count: args.pageImagePaths.length },
    });

    await startFileIngestion({
      jobId: args.jobId,
      householdId: args.householdId,
      sourceKind: "image" as const,
    });
  },

  async createUrlJob(args: { householdId: string; url: string }) {
    if (env.DATABASE_URL) {
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
    }
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // Status defaults to 'draft' (queued). The processUrl worker's
    // mark-processing step transitions to 'processing' on pickup.
    const { data: job, error } = await supabase
      .from("ingestion_jobs")
      .insert({
        household_id: args.householdId,
        created_by: user.id,
        source_kind: "url",
        source_url: args.url,
      })
      .select("id")
      .single();
    if (error || !job) throw error ?? new Error("Failed to create job");

    await supabase.from("ingestion_events").insert({
      job_id: job.id,
      kind: "ingestion_requested",
      payload: { url: args.url },
    });

    await startUrlIngestion({ jobId: job.id, householdId: args.householdId, url: args.url });

    return { jobId: job.id };
  },

  async getJob(jobId: string) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("ingestion_jobs")
      .select("*, events:ingestion_events(*)")
      .eq("id", jobId)
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Flip the originating job to "published" once the user saves the reviewed
   * recipe, so "Recent imports" shows "Saved" rather than "Ready for review".
   * Best-effort and cosmetic: manual recipes have no job, and a missing row is
   * not an error.
   */
  async markJobPublishedForRecipe(recipeId: string): Promise<void> {
    if (env.DATABASE_URL) {
      await runInUserTx(async (tx) => {
        await tx
          .update(ingestionJobs)
          .set({ status: "published" })
          .where(
            and(eq(ingestionJobs.recipeId, recipeId), eq(ingestionJobs.status, "needs_review")),
          );
      });
      return;
    }
    const supabase = await createSupabaseServerClient();
    await supabase
      .from("ingestion_jobs")
      .update({ status: "published" })
      .eq("recipe_id", recipeId)
      .eq("status", "needs_review");
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
    if (env.DATABASE_URL) {
      return runInUserTx(async (tx) => {
        const rows = await tx
          .update(ingestionJobs)
          .set({ status: "failed", error: "Cancelled by user" })
          .where(and(eq(ingestionJobs.id, jobId), inArray(ingestionJobs.status, ["draft", "processing"])))
          .returning({ id: ingestionJobs.id });
        return { cancelled: rows.length > 0 };
      });
    }
    const supabase = await createSupabaseServerClient();
    const { error, count } = await supabase
      .from("ingestion_jobs")
      .update(
        { status: "failed", error: "Cancelled by user" },
        { count: "exact" },
      )
      .eq("id", jobId)
      .in("status", ["draft", "processing"]);
    if (error) throw error;
    return { cancelled: (count ?? 0) > 0 };
  },

  /**
   * Delete a household's import jobs — all of them, or only the failed ones.
   * Returns the count deleted. Dual-dispatch (Neon vs Supabase). ingestion_events
   * rows cascade via the FK. (Module 11.1 — the delete path off the Supabase client.)
   */
  async clearJobs(args: { householdId: string; onlyFailed?: boolean }): Promise<number> {
    if (env.DATABASE_URL) {
      return runInUserTx(async (tx) => {
        const where = args.onlyFailed
          ? and(eq(ingestionJobs.householdId, args.householdId), eq(ingestionJobs.status, "failed"))
          : eq(ingestionJobs.householdId, args.householdId);
        const rows = await tx.delete(ingestionJobs).where(where).returning({ id: ingestionJobs.id });
        return rows.length;
      });
    }
    const supabase = await createSupabaseServerClient();
    const base = supabase
      .from("ingestion_jobs")
      .delete({ count: "exact" })
      .eq("household_id", args.householdId);
    const { error, count } = args.onlyFailed ? await base.eq("status", "failed") : await base;
    if (error) throw error;
    return count ?? 0;
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

    if (env.DATABASE_URL) {
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
    }

    // Supabase branch — mirrors active-jobs.tsx's current inline reads.
    const supabase = await createSupabaseServerClient();
    const { data: jobsData } = await supabase
      .from("ingestion_jobs")
      .select("*")
      .eq("household_id", args.householdId)
      .order("created_at", { ascending: false })
      .range(offset, offset + args.limit - 1);
    const jobs = (jobsData ?? []) as Tables<"ingestion_jobs">[];
    if (jobs.length === 0) return { jobs, events: [], recipes: [] };

    const jobIds = jobs.map((j) => j.id);
    const primaryIds = jobs.map((j) => j.recipe_id).filter((id): id is string => !!id);
    const RECIPE_COLS =
      "id, title, status, ingestion_job_id, cover_image_path, image_paths, cover_focal_x, cover_focal_y";
    const [eventsRes, reverseRes, primaryRes] = await Promise.all([
      supabase.from("ingestion_events").select("*").in("job_id", jobIds).order("created_at", { ascending: false }),
      supabase.from("recipes").select(RECIPE_COLS).in("ingestion_job_id", jobIds),
      primaryIds.length
        ? supabase.from("recipes").select(RECIPE_COLS).in("id", primaryIds)
        : Promise.resolve({ data: [] as ActiveJobRecipe[] }),
    ]);
    const byId = new Map<string, ActiveJobRecipe>();
    for (const r of [...((reverseRes.data ?? []) as ActiveJobRecipe[]), ...((primaryRes.data ?? []) as ActiveJobRecipe[])]) {
      byId.set(r.id, r);
    }
    return {
      jobs,
      events: (eventsRes.data ?? []) as Tables<"ingestion_events">[],
      recipes: [...byId.values()],
    };
  },
};
