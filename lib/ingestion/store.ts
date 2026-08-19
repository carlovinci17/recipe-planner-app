import "server-only";
import { eq, sql as dsql } from "drizzle-orm";
import { ingestionEvents, ingestionJobs } from "@/lib/db/schema";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { IngestionEventKind, Json, Tables } from "@/types/database.types";

/**
 * Admin (service-role) data access for the ingestion pipeline's internal steps
 * (Module 11.1). The Durable/internal endpoints run cross-household from event
 * payloads, so they bypass RLS — on Supabase via the service-role client, on
 * Neon via `db` (the superuser Drizzle connection). Every lookup is keyed by the
 * job's primary key, so there's no cross-household leak to guard.
 *
 * `@/lib/db` throws unless DATABASE_URL is set, so it's imported lazily inside the
 * Neon branch only; the Drizzle schema + operators are connection-free and safe
 * to import at the top.
 */
type JobRow = Tables<"ingestion_jobs">;

export type IngestionJobPatch = Partial<
  Pick<
    JobRow,
    | "status"
    | "error"
    | "recipe_id"
    | "raw_extraction"
    | "normalized"
    | "ai_model"
    | "prompt_tokens"
    | "completion_tokens"
    | "cost_cents"
    | "skim_results"
    | "page_image_paths"
    | "storage_path"
    | "updated_at"
  >
>;

export const ingestionStore = {
  /** Read a full job row (snake_case, matching Tables<"ingestion_jobs">). */
  async getJob(jobId: string): Promise<JobRow | null> {
    if (env.DATABASE_URL) {
      const { db } = await import("@/lib/db");
      const rows = (await db.execute(
        dsql`select * from ingestion_jobs where id = ${jobId} limit 1`,
      )) as unknown as JobRow[];
      return rows[0] ?? null;
    }
    const supabase = createSupabaseAdmin();
    const { data } = await supabase.from("ingestion_jobs").select("*").eq("id", jobId).maybeSingle();
    return (data as JobRow | null) ?? null;
  },

  /** Patch a job by id. Patch keys are the DB (snake_case) column names. */
  async updateJob(jobId: string, patch: IngestionJobPatch): Promise<void> {
    if (env.DATABASE_URL) {
      const { db } = await import("@/lib/db");
      const set: Record<string, unknown> = {};
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.error !== undefined) set.error = patch.error;
      if (patch.recipe_id !== undefined) set.recipeId = patch.recipe_id;
      if (patch.raw_extraction !== undefined) set.rawExtraction = patch.raw_extraction;
      if (patch.normalized !== undefined) set.normalized = patch.normalized;
      if (patch.ai_model !== undefined) set.aiModel = patch.ai_model;
      if (patch.prompt_tokens !== undefined) set.promptTokens = patch.prompt_tokens;
      if (patch.completion_tokens !== undefined) set.completionTokens = patch.completion_tokens;
      if (patch.cost_cents !== undefined) set.costCents = patch.cost_cents;
      if (patch.skim_results !== undefined) set.skimResults = patch.skim_results;
      if (patch.page_image_paths !== undefined) set.pageImagePaths = patch.page_image_paths;
      if (patch.storage_path !== undefined) set.storagePath = patch.storage_path;
      if (patch.updated_at !== undefined) set.updatedAt = patch.updated_at;
      await db.update(ingestionJobs).set(set).where(eq(ingestionJobs.id, jobId));
      return;
    }
    const supabase = createSupabaseAdmin();
    await supabase.from("ingestion_jobs").update(patch).eq("id", jobId);
  },

  /** Append an ingestion event for a job. */
  async insertEvent(jobId: string, kind: IngestionEventKind, payload: Json = {}): Promise<void> {
    if (env.DATABASE_URL) {
      const { db } = await import("@/lib/db");
      await db.insert(ingestionEvents).values({ jobId, kind, payload });
      return;
    }
    const supabase = createSupabaseAdmin();
    await supabase.from("ingestion_events").insert({ job_id: jobId, kind, payload });
  },
};
