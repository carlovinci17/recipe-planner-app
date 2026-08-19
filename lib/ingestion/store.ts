import "server-only";
import { eq, sql as dsql } from "drizzle-orm";
import { ingestionEvents, ingestionJobs } from "@/lib/db/schema";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { publishToHousehold } from "@/lib/realtime/publish";
import { env } from "@/lib/env";
import type { IngestionEventKind, Json, Tables } from "@/types/database.types";

/**
 * Resolve (and memoize) a job's household id for realtime publishing (Module
 * 11.1 / ADR-0009). A job→household mapping never changes, so a process-lifetime
 * cache means at most one lookup per job instead of one per write.
 */
const householdCache = new Map<string, string>();
async function jobHouseholdId(jobId: string): Promise<string | null> {
  const cached = householdCache.get(jobId);
  if (cached) return cached;
  let hid: string | null = null;
  if (env.DATABASE_URL) {
    const { db } = await import("@/lib/db");
    const rows = (await db.execute(
      dsql`select household_id from ingestion_jobs where id = ${jobId} limit 1`,
    )) as unknown as { household_id: string }[];
    hid = rows[0]?.household_id ?? null;
  } else {
    const supabase = createSupabaseAdmin();
    const { data } = await supabase
      .from("ingestion_jobs")
      .select("household_id")
      .eq("id", jobId)
      .maybeSingle();
    hid = (data?.household_id as string | undefined) ?? null;
  }
  if (hid) householdCache.set(jobId, hid);
  return hid;
}

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
    // cost_cents is an INTEGER column, but providers report fractional cents (a
    // cheap gpt-4o-mini call can cost 0.62¢) — round before writing or Postgres
    // rejects "invalid input syntax for type integer".
    const p: IngestionJobPatch =
      typeof patch.cost_cents === "number"
        ? { ...patch, cost_cents: Math.round(patch.cost_cents) }
        : patch;
    if (env.DATABASE_URL) {
      const { db } = await import("@/lib/db");
      const set: Record<string, unknown> = {};
      if (p.status !== undefined) set.status = p.status;
      if (p.error !== undefined) set.error = p.error;
      if (p.recipe_id !== undefined) set.recipeId = p.recipe_id;
      if (p.raw_extraction !== undefined) set.rawExtraction = p.raw_extraction;
      if (p.normalized !== undefined) set.normalized = p.normalized;
      if (p.ai_model !== undefined) set.aiModel = p.ai_model;
      if (p.prompt_tokens !== undefined) set.promptTokens = p.prompt_tokens;
      if (p.completion_tokens !== undefined) set.completionTokens = p.completion_tokens;
      if (p.cost_cents !== undefined) set.costCents = p.cost_cents;
      if (p.skim_results !== undefined) set.skimResults = p.skim_results;
      if (p.page_image_paths !== undefined) set.pageImagePaths = p.page_image_paths;
      if (p.storage_path !== undefined) set.storagePath = p.storage_path;
      if (p.updated_at !== undefined) set.updatedAt = p.updated_at;
      await db.update(ingestionJobs).set(set).where(eq(ingestionJobs.id, jobId));
    } else {
      const supabase = createSupabaseAdmin();
      await supabase.from("ingestion_jobs").update(p).eq("id", jobId);
    }
    // Signal the import UI on status transitions (no-op unless realtime=azure).
    if (p.status !== undefined) {
      const hid = await jobHouseholdId(jobId);
      if (hid) await publishToHousehold(hid, { type: "ingestion.job", jobId });
    }
  },

  /** Append an ingestion event for a job. */
  async insertEvent(jobId: string, kind: IngestionEventKind, payload: Json = {}): Promise<void> {
    if (env.DATABASE_URL) {
      const { db } = await import("@/lib/db");
      await db.insert(ingestionEvents).values({ jobId, kind, payload });
    } else {
      const supabase = createSupabaseAdmin();
      await supabase.from("ingestion_events").insert({ job_id: jobId, kind, payload });
    }
    // Progress signal for the import UI (no-op unless realtime=azure).
    const hid = await jobHouseholdId(jobId);
    if (hid) await publishToHousehold(hid, { type: "ingestion.event", jobId });
  },
};
