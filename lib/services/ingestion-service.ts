import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { startFileIngestion } from "@/lib/ingestion/start-job";
import { env } from "@/lib/env";
import type { RecipeSourceKind } from "@/types/database.types";

const UPLOADS_BUCKET = "recipe-uploads";

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
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data: job, error } = await supabase
      .from("ingestion_jobs")
      .insert({ household_id: args.householdId, created_by: user.id, source_kind: "image" as const, storage_bucket: UPLOADS_BUCKET })
      .select("id")
      .single();
    if (error || !job) throw error ?? new Error("Failed to create job");

    const uploadSlots = await Promise.all(
      args.photos.map(async (photo, i) => {
        const ext = photo.contentType === "image/png" ? "png" : "jpg";
        const path = `${args.householdId}/${job.id}/page-${String(i).padStart(3, "0")}.${ext}`;
        // Azure is keyless — the browser POSTs each photo to /api/storage/upload
        // (no signature). Just hand back the target path.
        if (env.STORAGE_PROVIDER === "azure") {
          return { uploadUrl: "", path, index: i };
        }
        const { data: signed, error: signErr } = await supabase.storage
          .from(UPLOADS_BUCKET)
          .createSignedUploadUrl(path);
        if (signErr || !signed) throw signErr ?? new Error(`Failed to sign upload ${i}`);
        return { uploadUrl: signed.signedUrl, path, index: i };
      }),
    );

    return { jobId: job.id, uploadSlots };
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

    await inngest.send({
      name: "ingestion/url.requested",
      data: { jobId: job.id, householdId: args.householdId, url: args.url },
    });

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
   * User-initiated cancel of an in-flight import. Soft-cancel: marks the job
   * `failed` with `error="Cancelled by user"` only if it's still in `draft`
   * or `processing`. The guard prevents racing with a completion that
   * landed at the same instant. The Inngest worker may still finish the
   * remaining steps for that job — the row update at the end is a no-op
   * when status changed mid-flight, so no DB damage occurs. Reuses the
   * existing `failed` status so "Clear failed" sweeps cancelled rows too.
   */
  async cancelJob(jobId: string): Promise<{ cancelled: boolean }> {
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
};
