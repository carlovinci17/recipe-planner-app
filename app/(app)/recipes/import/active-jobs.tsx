"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, CheckCheck, Clock, Trash2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdRealtime } from "@/lib/realtime/use-household-realtime";
import { loadActiveJobsAction } from "./actions";
import type { ActiveJobRecipe } from "@/lib/services/ingestion-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { IngestionEventKind, RecipeStatus, Tables } from "@/types/database.types";
import { bulkPublishRecipesAction } from "../actions";
import { cancelJobAction, clearAllJobsAction, clearFailedJobsAction } from "./actions";
import { SkimPreviewDialog } from "./skim-preview-dialog";
import { CoverPickerDialog } from "./cover-picker-dialog";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import { coverObjectPositionStyle, resolveCoverImage } from "@/lib/recipes/cover-image";
import { getSourceName } from "@/lib/recipes/source-name";

type SkimRecipe = {
  title: string;
  summary: string;
  source_page_index: number | null;
};

/**
 * Read ingestion_jobs.skim_results into a typed shape. Two flags drive UI:
 *   - awaitingSelection: skim done, user hasn't committed yet → show picker
 *   - hasSkim: skim ran (committed or not) — informational
 */
function readSkimState(job: Job): {
  awaitingSelection: boolean;
  recipes: SkimRecipe[];
} {
  const raw = job.skim_results as
    | { recipes?: SkimRecipe[]; selected_titles?: string[] }
    | null;
  if (!raw || !Array.isArray(raw.recipes) || raw.recipes.length === 0) {
    return { awaitingSelection: false, recipes: [] };
  }
  const awaitingSelection =
    job.status === "processing" &&
    (!Array.isArray(raw.selected_titles) || raw.selected_titles.length === 0);
  return { awaitingSelection, recipes: raw.recipes };
}

type Job = Tables<"ingestion_jobs">;
type Event = Tables<"ingestion_events">;
type Recipe = Tables<"recipes">;

/**
 * Recipe fields surfaced inside the JobRow. Now includes cover image
 * fields so each sub-row can show a thumbnail and open the cover picker
 * without an extra fetch.
 */
type JobRecipe = {
  id: string;
  title: string;
  status: RecipeStatus;
  cover_image_path: string | null;
  image_paths: string[] | null;
  cover_focal_x: number;
  cover_focal_y: number;
};

const STATUS_LABEL: Record<Job["status"], string> = {
  // 'draft' = queued / waiting for the Inngest worker. Was misleadingly
  // labeled "Draft" before — read by users as "saved-but-incomplete"
  // rather than the actual "waiting in queue".
  draft: "Queued",
  processing: "Processing",
  needs_review: "Ready for review",
  published: "Saved",
  failed: "Failed",
};

// Pipeline progress: each event corresponds to a fraction of the total work.
// Values are tuned so the bar feels like it's making steady progress through
// the slow steps (vision extraction is the longest), without 100%-ing too
// early. `recipe_ready_for_review` is the terminal step before review.
const STEP_PROGRESS: Record<IngestionEventKind, number> = {
  file_uploaded: 0.1,
  ingestion_requested: 0.15,
  ai_processing_started: 0.2,
  extraction_completed: 0.7,
  validation_completed: 0.85,
  recipe_ready_for_review: 1.0,
  recipe_saved: 1.0,
  failed: 1.0,
};

// Food-themed default labels per event kind. The dynamic `computeLabel`
// below overrides these with chunk/recipe-aware variants when meta is
// available (e.g. "Tasting page 3 of 14"), but these are the fallback
// when we only know the event kind.
const STEP_LABEL: Record<IngestionEventKind, string> = {
  file_uploaded: "Got the menu",
  ingestion_requested: "Hailing the waiter",
  ai_processing_started: "Reading over the chef's shoulder",
  extraction_completed: "Got the recipe — plating up",
  validation_completed: "Adding the final garnish",
  recipe_ready_for_review: "Bon appétit — ready to taste",
  recipe_saved: "Tucked into the cookbook",
  failed: "The kitchen had a hiccup",
};

/**
 * Per-job dynamic progress context, extracted from event payloads. Drives
 * smooth incremental progress within the long phases (vision extraction
 * and recipe persistence) instead of jumping in chunks.
 */
type ProgressMeta = {
  /** Latest "chunk N of M" from the AI processing phase. */
  chunk?: number;
  totalChunks?: number;
  /** Latest "recipe N of M" from the persist phase. */
  recipeIndex?: number;
  recipeTotal?: number;
};

/**
 * Compute fractional progress (0–1) given the latest event kind and any
 * progress meta we've gathered. Subdivides the two long phases:
 *   - vision extraction: 0.20 → 0.70 (interpolated by chunk progress)
 *   - recipe persistence: 0.85 → 1.00 (interpolated by recipe progress)
 * Outside those phases, falls back to the static STEP_PROGRESS table.
 */
function computeProgress(kind: IngestionEventKind | undefined, meta: ProgressMeta): number {
  if (!kind) return 0.05;
  if (kind === "ai_processing_started" && meta.chunk && meta.totalChunks) {
    return 0.2 + (0.5 * Math.min(meta.chunk, meta.totalChunks)) / meta.totalChunks;
  }
  if (
    kind === "recipe_ready_for_review" &&
    typeof meta.recipeIndex === "number" &&
    meta.recipeTotal
  ) {
    const completed = Math.min(meta.recipeIndex + 1, meta.recipeTotal);
    return 0.85 + (0.15 * completed) / meta.recipeTotal;
  }
  return STEP_PROGRESS[kind];
}

/**
 * Pick a fun, context-rich label. Falls back to the static STEP_LABEL when
 * we don't have enough meta to be more specific.
 */
function computeLabel(kind: IngestionEventKind | undefined, meta: ProgressMeta): string {
  if (!kind) return "Settling in";
  if (
    kind === "ai_processing_started" &&
    meta.chunk &&
    meta.totalChunks &&
    meta.totalChunks > 1
  ) {
    return `Tasting page ${meta.chunk} of ${meta.totalChunks}`;
  }
  if (
    kind === "recipe_ready_for_review" &&
    typeof meta.recipeIndex === "number" &&
    meta.recipeTotal &&
    meta.recipeTotal > 1
  ) {
    return `Tucking recipe ${meta.recipeIndex + 1} of ${meta.recipeTotal} into the cookbook`;
  }
  return STEP_LABEL[kind];
}

const PAGE_SIZE = 25;

const REALTIME_IS_AZURE = process.env.NEXT_PUBLIC_REALTIME_PROVIDER === "azure";

type Derived = {
  jobs: Job[];
  recipesByJob: Record<string, JobRecipe[]>;
  latestEvents: Record<string, IngestionEventKind>;
  extractionCounts: Record<string, { found: number; kept: number }>;
  persistFailures: Record<string, { titles: string[]; reasons: string[] }>;
  progressMeta: Record<string, ProgressMeta>;
};

const toJobRecipe = (r: ActiveJobRecipe): JobRecipe => ({
  id: r.id,
  title: r.title,
  status: r.status,
  cover_image_path: r.cover_image_path,
  image_paths: r.image_paths,
  cover_focal_x: r.cover_focal_x,
  cover_focal_y: r.cover_focal_y,
});

/**
 * Assemble the raw import bundle (jobs + events + recipes) into the derived maps
 * the UI renders. Events must be newest-first (the service returns them so).
 * Shared by the initial load and the realtime refetch (Module 11.1).
 */
function assembleBundle(bundle: { jobs: Job[]; events: Event[]; recipes: ActiveJobRecipe[] }): Derived {
  const { jobs, events, recipes } = bundle;

  const recipesByJob: Record<string, JobRecipe[]> = {};
  for (const r of recipes) {
    if (!r.ingestion_job_id) continue;
    (recipesByJob[r.ingestion_job_id] ??= []).push(toJobRecipe(r));
  }
  // Primary-FK fallback for legacy single-recipe jobs (recipe has no ingestion_job_id).
  const byId = new Map(recipes.map((r) => [r.id, r]));
  for (const job of jobs) {
    if (!job.recipe_id || recipesByJob[job.id]) continue;
    const p = byId.get(job.recipe_id);
    if (p) recipesByJob[job.id] = [toJobRecipe(p)];
  }

  const latestEvents: Record<string, IngestionEventKind> = {};
  const extractionCounts: Record<string, { found: number; kept: number }> = {};
  const persistFailures: Record<string, { titles: string[]; reasons: string[] }> = {};
  const progressMeta: Record<string, ProgressMeta> = {};
  for (const ev of events) {
    if (!latestEvents[ev.job_id]) latestEvents[ev.job_id] = ev.kind;
    if (ev.kind === "ai_processing_started") {
      const p = ev.payload as { chunk?: number; total_chunks?: number } | null;
      if (p?.chunk && p.total_chunks) {
        const cur = progressMeta[ev.job_id] ?? {};
        if (cur.chunk === undefined)
          progressMeta[ev.job_id] = { ...cur, chunk: p.chunk, totalChunks: p.total_chunks };
      }
    }
    if (ev.kind === "recipe_ready_for_review") {
      const p = ev.payload as { index?: number; total?: number } | null;
      if (typeof p?.index === "number" && p.total) {
        const cur = progressMeta[ev.job_id] ?? {};
        if (cur.recipeIndex === undefined)
          progressMeta[ev.job_id] = { ...cur, recipeIndex: p.index, recipeTotal: p.total };
      }
    }
    if (ev.kind === "extraction_completed" && !extractionCounts[ev.job_id]) {
      const p = ev.payload as { recipes_found?: number; recipes_kept?: number } | null;
      if (p && typeof p.recipes_found === "number") {
        extractionCounts[ev.job_id] = { found: p.recipes_found, kept: p.recipes_kept ?? p.recipes_found };
      }
    }
    if (ev.kind === "validation_completed") {
      const p = ev.payload as { partial?: boolean; failed_titles?: string[]; failure_reasons?: string[] } | null;
      if (p?.partial && p.failed_titles && !persistFailures[ev.job_id]) {
        persistFailures[ev.job_id] = { titles: p.failed_titles, reasons: p.failure_reasons ?? [] };
      }
    }
    if (ev.kind === "failed") {
      const p = ev.payload as { reason?: string; title?: string; error?: string } | null;
      if (p?.reason === "persist_recipe" && p.title) {
        const bucket = (persistFailures[ev.job_id] ??= { titles: [], reasons: [] });
        if (!bucket.titles.includes(p.title)) bucket.titles.push(p.title);
        if (p.error && !bucket.reasons.includes(p.error)) bucket.reasons.push(p.error);
      }
    }
  }

  return { jobs, recipesByJob, latestEvents, extractionCounts, persistFailures, progressMeta };
}

export function ActiveJobs({ householdId }: { householdId: string }) {
  const supabase = createClient();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [totalLoaded, setTotalLoaded] = useState(0);
  // Map of job_id -> the most recent event kind (drives the progress bar).
  const [latestEvents, setLatestEvents] = useState<Record<string, IngestionEventKind>>({});
  // Map of job_id -> all recipes attached via recipes.ingestion_job_id. A
  // multi-recipe import (cookbook PDF, listicle URL) yields multiple entries
  // here; a typical single-recipe import yields one.
  const [recipesByJob, setRecipesByJob] = useState<Record<string, JobRecipe[]>>({});
  // Map of job_id -> { found, kept } from the extraction_completed event
  // payload. `kept` is the target persistence count; the UI shows
  // "Saving X of N" by comparing recipesByJob.length to kept.
  const [extractionCounts, setExtractionCounts] = useState<
    Record<string, { found: number; kept: number }>
  >({});
  // Per-job progress meta — chunk N of M (vision phase) and recipe N of M
  // (persist phase). Extracted from event payloads. Drives smooth
  // incremental progress so the bar climbs in real steps instead of
  // jumping from 20% to 70%.
  const [progressMeta, setProgressMeta] = useState<Record<string, ProgressMeta>>({});
  // Map of job_id -> { failed_titles, failure_reasons } from per-recipe
  // failure events. Drives the "Saved X · Y failed" tooltip on partial
  // imports so the user can see exactly which recipes didn't make it.
  const [persistFailures, setPersistFailures] = useState<
    Record<string, { titles: string[]; reasons: string[] }>
  >({});
  // Job id whose skim-preview dialog is currently open.
  const [skimDialogJobId, setSkimDialogJobId] = useState<string | null>(null);
  // { recipeId, jobId } when a recipe's thumbnail is clicked to open its
  // cover picker. We carry jobId alongside so we can look up the matching
  // source pages from the job row without re-fetching.
  const [coverPickerTarget, setCoverPickerTarget] = useState<{
    recipeId: string;
    jobId: string;
  } | null>(null);
  const [pending, start] = useTransition();
  // How many jobs are currently loaded — so a realtime refetch reloads the same
  // span (not just the first page). A ref so the realtime callback stays stable.
  const loadedCountRef = useRef(PAGE_SIZE);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await loadActiveJobsAction({ householdId, limit: PAGE_SIZE + 1 });
      if (cancelled || !res.ok) return;
      const list = res.jobs as Job[];
      const more = list.length > PAGE_SIZE;
      const trimmed = more ? list.slice(0, PAGE_SIZE) : list;
      const d = assembleBundle({ jobs: trimmed, events: res.events, recipes: res.recipes });
      setJobs(d.jobs);
      setTotalLoaded(trimmed.length);
      loadedCountRef.current = trimmed.length;
      if (more) setVisibleCount(PAGE_SIZE);
      setRecipesByJob(d.recipesByJob);
      setLatestEvents(d.latestEvents);
      setExtractionCounts(d.extractionCounts);
      setPersistFailures(d.persistFailures);
      setProgressMeta(d.progressMeta);
    })();

    // Azure realtime path: the Supabase postgres_changes channels below don't
    // apply (writes go to Neon); the Web PubSub hook drives refetches instead.
    if (REALTIME_IS_AZURE) {
      return () => {
        cancelled = true;
      };
    }

    const jobsChannel = supabase
      .channel(`ingestion-${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ingestion_jobs",
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          setJobs((prev) => {
            if (payload.eventType === "DELETE")
              return prev.filter((j) => j.id !== (payload.old as Job).id);
            const next = payload.new as Job;
            // Fallback for legacy single-recipe jobs whose recipes don't
            // carry ingestion_job_id (so the recipes-channel subscription
            // never delivers them). When such a job gains a recipe_id via
            // realtime, fetch the title once and inject it into the row.
            if (next.recipe_id) {
              const recipeId = next.recipe_id;
              const jobId = next.id;
              setRecipesByJob((current) => {
                const existing = current[jobId];
                if (existing && existing.some((r) => r.id === recipeId)) return current;
                void supabase
                  .from("recipes")
                  .select("id, title, status, cover_image_path, image_paths, cover_focal_x, cover_focal_y")
                  .eq("id", recipeId)
                  .maybeSingle()
                  .then(({ data }) => {
                    if (!data) return;
                    const ref: JobRecipe = {
                      id: data.id,
                      title: data.title,
                      status: data.status,
                      cover_image_path: data.cover_image_path,
                      image_paths: data.image_paths,
                      cover_focal_x: data.cover_focal_x,
                      cover_focal_y: data.cover_focal_y,
                    };
                    setRecipesByJob((c) => {
                      const list = c[jobId] ?? [];
                      if (list.some((r) => r.id === ref.id)) return c;
                      return { ...c, [jobId]: [...list, ref] };
                    });
                  });
                return current;
              });
            }
            const without = prev.filter((j) => j.id !== next.id);
            return [next, ...without].slice(0, PAGE_SIZE);
          });
        },
      )
      .subscribe();

    // No straightforward way to filter ingestion_events by household_id
    // without a view (events are scoped via job_id). Subscribe to all
    // public.ingestion_events INSERTs and ignore ones we don't care about.
    const eventsChannel = supabase
      .channel(`ingestion-events-${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ingestion_events",
        },
        (payload) => {
          const ev = payload.new as Event;
          setLatestEvents((prev) => ({ ...prev, [ev.job_id]: ev.kind }));
          if (ev.kind === "extraction_completed") {
            const p = ev.payload as { recipes_found?: number; recipes_kept?: number } | null;
            if (p && typeof p.recipes_found === "number") {
              setExtractionCounts((prev) => ({
                ...prev,
                [ev.job_id]: {
                  found: p.recipes_found!,
                  kept: p.recipes_kept ?? p.recipes_found!,
                },
              }));
            }
          }
          // Vision phase chunk progress — drives the smooth bar climb
          // from 20% → 70% as each chunk completes.
          if (ev.kind === "ai_processing_started") {
            const p = ev.payload as { chunk?: number; total_chunks?: number } | null;
            if (p?.chunk && p.total_chunks) {
              setProgressMeta((prev) => ({
                ...prev,
                [ev.job_id]: {
                  ...prev[ev.job_id],
                  chunk: p.chunk,
                  totalChunks: p.total_chunks,
                },
              }));
            }
          }
          // Persist phase progress — bar climbs 85% → 100% as each recipe
          // lands in the cookbook.
          if (ev.kind === "recipe_ready_for_review") {
            const p = ev.payload as { index?: number; total?: number } | null;
            if (typeof p?.index === "number" && p.total) {
              setProgressMeta((prev) => ({
                ...prev,
                [ev.job_id]: {
                  ...prev[ev.job_id],
                  recipeIndex: p.index,
                  recipeTotal: p.total,
                },
              }));
            }
          }
          // Partial-failure summary event from process-upload / process-url.
          if (ev.kind === "validation_completed") {
            const p = ev.payload as
              | { partial?: boolean; failed_titles?: string[]; failure_reasons?: string[] }
              | null;
            if (p?.partial && p.failed_titles) {
              setPersistFailures((prev) => ({
                ...prev,
                [ev.job_id]: {
                  titles: p.failed_titles!,
                  reasons: p.failure_reasons ?? [],
                },
              }));
            }
          }
          // Per-recipe failure event (fired as each persist attempt errors).
          // Accumulate so the UI shows live failure counts as they arrive,
          // even before the partial-summary event lands.
          if (ev.kind === "failed") {
            const p = ev.payload as {
              reason?: string;
              title?: string;
              error?: string;
            } | null;
            if (p?.reason === "persist_recipe" && p.title) {
              setPersistFailures((prev) => {
                const bucket = prev[ev.job_id] ?? { titles: [], reasons: [] };
                const titles = bucket.titles.includes(p.title!)
                  ? bucket.titles
                  : [...bucket.titles, p.title!];
                const reasons =
                  p.error && !bucket.reasons.includes(p.error)
                    ? [...bucket.reasons, p.error]
                    : bucket.reasons;
                return { ...prev, [ev.job_id]: { titles, reasons } };
              });
            }
          }
        },
      )
      .subscribe();

    // Watch recipes scoped to this household so siblings of a multi-recipe
    // import flow into the row as they're persisted (driving the
    // "Saving X of N" counter without polling).
    const recipesChannel = supabase
      .channel(`ingestion-recipes-${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "recipes",
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Recipe;
            if (!old.ingestion_job_id) return;
            const jobId = old.ingestion_job_id;
            setRecipesByJob((prev) => {
              const list = prev[jobId];
              if (!list) return prev;
              return { ...prev, [jobId]: list.filter((r) => r.id !== old.id) };
            });
            return;
          }
          const next = payload.new as Recipe;
          if (!next.ingestion_job_id) return;
          const jobId = next.ingestion_job_id;
          const ref: JobRecipe = {
            id: next.id,
            title: next.title,
            status: next.status,
            cover_image_path: next.cover_image_path,
            image_paths: next.image_paths,
            cover_focal_x: next.cover_focal_x,
            cover_focal_y: next.cover_focal_y,
          };
          setRecipesByJob((prev) => {
            const list = prev[jobId] ?? [];
            const idx = list.findIndex((r) => r.id === ref.id);
            if (idx === -1) return { ...prev, [jobId]: [...list, ref] };
            const copy = list.slice();
            copy[idx] = ref;
            return { ...prev, [jobId]: copy };
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(jobsChannel);
      void supabase.removeChannel(eventsChannel);
      void supabase.removeChannel(recipesChannel);
    };
  }, [householdId, supabase]);

  // Azure realtime (ADR-0009): events carry ids only, so on any ingestion signal
  // we refetch the whole visible span from the server (Neon) and re-derive. No-op
  // unless NEXT_PUBLIC_REALTIME_PROVIDER=azure. Debounced (~500ms) so a burst of
  // per-chunk events during a long extraction collapses into one reload.
  const refetchAll = useCallback(async () => {
    const res = await loadActiveJobsAction({
      householdId,
      limit: Math.max(loadedCountRef.current, PAGE_SIZE),
    });
    if (!res.ok) return;
    const d = assembleBundle({ jobs: res.jobs as Job[], events: res.events, recipes: res.recipes });
    loadedCountRef.current = d.jobs.length;
    setJobs(d.jobs);
    setTotalLoaded(d.jobs.length);
    setRecipesByJob(d.recipesByJob);
    setLatestEvents(d.latestEvents);
    setExtractionCounts(d.extractionCounts);
    setPersistFailures(d.persistFailures);
    setProgressMeta(d.progressMeta);
  }, [householdId]);

  useHouseholdRealtime((e) => {
    if (e.type !== "ingestion.job" && e.type !== "ingestion.event" && e.type !== "recipe.changed") {
      return;
    }
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void refetchAll(), 500);
  });

  async function loadMore() {
    const res = await loadActiveJobsAction({ householdId, limit: PAGE_SIZE + 1, offset: jobs.length });
    if (!res.ok) return;
    const more = res.jobs as Job[];
    if (more.length > 0) {
      // Merge the new page's jobs + derived maps into what's already loaded.
      const d = assembleBundle({ jobs: more, events: res.events, recipes: res.recipes });
      setJobs((prev) => {
        const existing = new Set(prev.map((j) => j.id));
        return [...prev, ...d.jobs.filter((j) => !existing.has(j.id))];
      });
      setTotalLoaded((n) => n + more.length);
      loadedCountRef.current += more.length;
      setRecipesByJob((prev) => ({ ...prev, ...d.recipesByJob }));
      setLatestEvents((prev) => ({ ...prev, ...d.latestEvents }));
      setExtractionCounts((prev) => ({ ...prev, ...d.extractionCounts }));
      setPersistFailures((prev) => ({ ...prev, ...d.persistFailures }));
      setProgressMeta((prev) => ({ ...prev, ...d.progressMeta }));
    }
    setVisibleCount((n) => n + PAGE_SIZE);
  }

  function clearFailed() {
    start(async () => {
      const result = await clearFailedJobsAction({ householdId });
      if (!result.ok) {
        toast.error(result.error ?? "Failed to clear");
        return;
      }
      // Realtime DELETE events from Supabase only include the PK in their
      // payload, so the channel filter on household_id strips them out
      // before we ever see them. Update local state explicitly here.
      if (result.cleared > 0) {
        const removedIds = new Set(
          jobs.filter((j) => j.status === "failed").map((j) => j.id),
        );
        setJobs((prev) => prev.filter((j) => j.status !== "failed"));
        setLatestEvents((prev) => {
          const next = { ...prev };
          for (const id of removedIds) delete next[id];
          return next;
        });
        setRecipesByJob((prev) => {
          const next = { ...prev };
          for (const id of removedIds) delete next[id];
          return next;
        });
        setExtractionCounts((prev) => {
          const next = { ...prev };
          for (const id of removedIds) delete next[id];
          return next;
        });
      }
      if (result.cleared === 0) {
        toast.info("No failed imports to clear");
      } else {
        toast.success(
          `Cleared ${result.cleared} failed ${result.cleared === 1 ? "import" : "imports"}`,
        );
      }
    });
  }

  const [confirmClearAllOpen, setConfirmClearAllOpen] = useState(false);
  function clearAll() {
    start(async () => {
      const result = await clearAllJobsAction({ householdId });
      if (!result.ok) {
        toast.error(result.error ?? "Failed to clear");
        return;
      }
      // Same realtime caveat as clearFailed — wipe local state directly.
      setJobs([]);
      setLatestEvents({});
      setRecipesByJob({});
      setExtractionCounts({});
      setConfirmClearAllOpen(false);
      if (result.cleared === 0) {
        toast.info("Nothing to clear");
      } else {
        toast.success(
          `Cleared ${result.cleared} ${result.cleared === 1 ? "import" : "imports"}`,
        );
      }
    });
  }

  // Track per-row "Save all" in-flight so the button can show "Saving..."
  // and disable while the action round-trips. Keyed by job id since the
  // bulk-publish targets the siblings of a single import.
  const [savingAllJobIds, setSavingAllJobIds] = useState<Set<string>>(new Set());
  function saveAllForJob(jobId: string, recipeIds: string[]) {
    if (recipeIds.length === 0) return;
    setSavingAllJobIds((prev) => new Set(prev).add(jobId));
    // Optimistic — flip each affected recipe to published locally. The
    // recipes-channel realtime delivery will reconcile if anything diverges.
    setRecipesByJob((prev) => {
      const list = prev[jobId];
      if (!list) return prev;
      const wanted = new Set(recipeIds);
      return {
        ...prev,
        [jobId]: list.map((r) =>
          wanted.has(r.id) && r.status === "needs_review"
            ? { ...r, status: "published" as const }
            : r,
        ),
      };
    });
    void bulkPublishRecipesAction({ recipeIds }).then((result) => {
      setSavingAllJobIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't approve");
        return;
      }
      if (result.published === 0) {
        toast.info("Nothing to publish — already up to date");
        return;
      }
      toast.success(
        `Published ${result.published} ${result.published === 1 ? "recipe" : "recipes"}`,
      );
    });
  }

  // Track per-row cancel-in-flight so we can disable the X while the action
  // round-trips. A Set instead of useTransition so multiple rows can be
  // cancelled concurrently without sharing the same pending flag.
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  function cancelJob(jobId: string) {
    setCancelling((prev) => new Set(prev).add(jobId));
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId ? { ...j, status: "failed", error: "Cancelled by user" } : j,
      ),
    );
    void cancelJobAction({ jobId, householdId }).then((result) => {
      setCancelling((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't cancel import");
        return;
      }
      if (result.cancelled) {
        toast.success("Import cancelled");
      } else {
        toast.info("Import already finished");
      }
    });
  }

  if (jobs.length === 0) return null;

  const failedCount = jobs.filter((j) => j.status === "failed").length;
  const inFlightCount = jobs.filter(
    (j) => j.status === "processing" || j.status === "draft",
  ).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Recent imports</CardTitle>
        <div className="flex items-center gap-1">
          {failedCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFailed}
              disabled={pending}
              className="h-7 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear {failedCount} failed
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmClearAllOpen(true)}
            disabled={pending}
            className="h-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Clear all
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {jobs.slice(0, visibleCount).map((j) => (
          <JobRow
            key={j.id}
            job={j}
            latestEvent={latestEvents[j.id]}
            recipes={recipesByJob[j.id] ?? []}
            extractionCount={extractionCounts[j.id]}
            failures={persistFailures[j.id]}
            progressMeta={progressMeta[j.id] ?? {}}
            cancelling={cancelling.has(j.id)}
            savingAll={savingAllJobIds.has(j.id)}
            skimState={readSkimState(j)}
            onCancel={cancelJob}
            onSaveAll={(ids) => saveAllForJob(j.id, ids)}
            onOpenSkim={() => setSkimDialogJobId(j.id)}
            onOpenCoverPicker={(recipeId) =>
              setCoverPickerTarget({ recipeId, jobId: j.id })
            }
          />
        ))}
        {(visibleCount < jobs.length || jobs.length === totalLoaded) && totalLoaded >= PAGE_SIZE && (
          <div className="pt-1 flex justify-center">
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={loadMore}>
              Show more
            </Button>
          </div>
        )}
      </CardContent>

      {/* Cover-picker dialog — opens when a recipe thumbnail in a sub-row
          is clicked. Looks up the target recipe + its job's source pages
          and hands them to the shared CoverPickerGrid. */}
      {(() => {
        if (!coverPickerTarget) {
          return (
            <CoverPickerDialog
              recipeId=""
              recipeTitle=""
              currentCoverPath={null}
              sourcePages={[]}
              hasUserUploads={false}
              open={false}
              onOpenChange={() => {}}
            />
          );
        }
        const job = jobs.find((j) => j.id === coverPickerTarget.jobId);
        const list = recipesByJob[coverPickerTarget.jobId] ?? [];
        const recipe = list.find((r) => r.id === coverPickerTarget.recipeId);
        return (
          <CoverPickerDialog
            recipeId={coverPickerTarget.recipeId}
            recipeTitle={recipe?.title ?? "Recipe"}
            currentCoverPath={recipe?.cover_image_path ?? null}
            sourcePages={job?.page_image_paths ?? []}
            hasUserUploads={(recipe?.image_paths ?? []).length > 0}
            initialFocalX={recipe?.cover_focal_x ?? 50}
            initialFocalY={recipe?.cover_focal_y ?? 50}
            open={true}
            onOpenChange={(next) => {
              if (!next) setCoverPickerTarget(null);
            }}
          />
        );
      })()}

      {/* Skim preview dialog — opens when the user clicks "Review & pick"
          on a job that has skim_results but no committed selection yet.
          The page-image paths are passed through so each recipe row can
          render a thumbnail of its source page. Batch-source defaults are
          derived from the job's URL when present (URL imports get a useful
          pre-fill; file/PDF imports start blank for the user to type). */}
      {(() => {
        const activeJob = skimDialogJobId
          ? jobs.find((j) => j.id === skimDialogJobId)
          : null;
        const defaultUrl = activeJob?.source_url ?? null;
        const defaultName = defaultUrl ? getSourceName(defaultUrl) : null;
        return (
          <SkimPreviewDialog
            jobId={skimDialogJobId ?? ""}
            recipes={activeJob ? readSkimState(activeJob).recipes : []}
            sourcePages={activeJob?.page_image_paths ?? []}
            defaultSourceName={defaultName}
            defaultSourceUrl={defaultUrl}
            open={skimDialogJobId !== null}
            onOpenChange={(next) => {
              if (!next) setSkimDialogJobId(null);
            }}
          />
        );
      })()}

      <Dialog
        open={confirmClearAllOpen}
        onOpenChange={(open) => !pending && setConfirmClearAllOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all imports?</DialogTitle>
            <DialogDescription>
              This removes all {jobs.length} {jobs.length === 1 ? "row" : "rows"} from
              Recent imports — successful, failed, and any{" "}
              {inFlightCount > 0
                ? `${inFlightCount} still in progress (those will be aborted)`
                : "in-flight imports"}
              . Your saved recipes are not affected. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmClearAllOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={clearAll}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? "Clearing..." : "Clear all"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function JobRow({
  job,
  latestEvent,
  recipes,
  extractionCount,
  failures,
  progressMeta,
  cancelling,
  savingAll,
  skimState,
  onCancel,
  onSaveAll,
  onOpenSkim,
  onOpenCoverPicker,
}: {
  job: Job;
  latestEvent?: IngestionEventKind;
  recipes: JobRecipe[];
  extractionCount?: { found: number; kept: number };
  failures?: { titles: string[]; reasons: string[] };
  progressMeta: ProgressMeta;
  cancelling: boolean;
  savingAll: boolean;
  skimState: { awaitingSelection: boolean; recipes: SkimRecipe[] };
  onCancel: (jobId: string) => void;
  onSaveAll: (recipeIds: string[]) => void;
  onOpenSkim: () => void;
  onOpenCoverPicker: (recipeId: string) => void;
}) {
  const isProcessing = job.status === "processing";
  const progress = isProcessing
    ? Math.round(computeProgress(latestEvent, progressMeta) * 100)
    : 100;
  const stepLabel = isProcessing ? computeLabel(latestEvent, progressMeta) : null;
  const statusText = isProcessing && stepLabel ? stepLabel : STATUS_LABEL[job.status];

  // Multi-recipe progress: once extraction reports its count, replace the
  // generic "Recipe extracted" / "Validating" labels with concrete progress.
  // Saving X of N — refreshes every time a sibling row lands via realtime.
  const persistedCount = recipes.length;
  const expectedCount = extractionCount?.kept ?? 0;
  const failedCount = failures?.titles.length ?? 0;
  const showMultiProgress =
    isProcessing &&
    expectedCount > 1 &&
    (latestEvent === "extraction_completed" ||
      latestEvent === "validation_completed" ||
      latestEvent === "recipe_ready_for_review");

  // The job has multiple recipes once persistence lands, OR the extraction
  // event has reported >1 even before persistence completes.
  const isMultiRecipe = recipes.length > 1 || expectedCount > 1;

  // For headline title: when single-recipe, show that recipe's title;
  // when multi-recipe (or pre-persistence), show a count summary.
  const headlineTitle = (() => {
    if (isMultiRecipe) {
      if (expectedCount > 0 && persistedCount < expectedCount && isProcessing) {
        return `${expectedCount} recipes from this import`;
      }
      const n = persistedCount > 0 ? persistedCount : expectedCount;
      return `${n} recipes from this import`;
    }
    return recipes[0]?.title ?? null;
  })();

  return (
    <div className="rounded-md border bg-background px-3 py-2 text-sm">
      {skimState.awaitingSelection ? (
        // Pre-extract picker: skim finished, user hasn't chosen yet. The
        // strip sits above the status line so it's the first thing the eye
        // catches on this row.
        <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-primary">
              {skimState.recipes.length} {skimState.recipes.length === 1 ? "recipe" : "recipes"} found
            </div>
            <div className="text-xs text-muted-foreground">
              Pick which to import before the slower extraction runs.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={onOpenSkim}
            className="shrink-0"
          >
            Review &amp; pick
          </Button>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <StatusIcon status={job.status} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-medium">
                {headlineTitle ?? (
                  <span className="italic text-muted-foreground">Untitled recipe</span>
                )}
              </span>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {job.source_kind}
              </span>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {showMultiProgress
                ? `Found ${extractionCount!.found} ${extractionCount!.found === 1 ? "recipe" : "recipes"} · Saving ${persistedCount} of ${expectedCount}${failedCount > 0 ? ` · ${failedCount} failed` : ""}`
                : statusText}
              {!isProcessing && failedCount > 0 && persistedCount > 0 ? (
                // Partial-success summary on a completed multi-recipe job
                <span
                  className="text-destructive"
                  title={
                    failures
                      ? `Failed: ${failures.titles.join(", ")}${failures.reasons.length > 0 ? `\nReason: ${failures.reasons[0]}` : ""}`
                      : ""
                  }
                >
                  {" · "}
                  {failedCount} failed
                </span>
              ) : null}
              {job.error ? (
                <span className="text-destructive" title={job.error}>
                  {" — "}
                  {job.error}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {/* Right-side action: review/open for single-recipe jobs; cancel for
            in-flight; nothing while a multi-recipe job is mid-persistence
            (each recipe gets its own per-row link below). */}
        {!isMultiRecipe && recipes[0] && job.status === "needs_review" ? (
          <Link
            href={`/recipes/${recipes[0].id}/review`}
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            Review →
          </Link>
        ) : !isMultiRecipe && recipes[0] && job.status === "published" ? (
          <Link
            href={`/recipes/${recipes[0].id}`}
            className="shrink-0 text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            Open →
          </Link>
        ) : job.status === "processing" || job.status === "draft" ? (
          <button
            type="button"
            onClick={() => onCancel(job.id)}
            disabled={cancelling}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"
            aria-label="Cancel import"
          >
            <X className="h-3.5 w-3.5" />
            {cancelling ? "Cancelling..." : "Cancel"}
          </button>
        ) : null}
      </div>

      {/* Per-recipe sub-rows — only rendered when the import produced more
          than one recipe (cookbook PDF, listicle URL). Each gets its own
          Review/Open link. Renders during persistence too, so users see the
          list grow in real time as siblings are saved. */}
      {isMultiRecipe && recipes.length > 0 ? (() => {
        // "Save all" only makes sense when 2+ recipes are still awaiting
        // review. 1 left = just click Review →. 0 left = everything's done.
        const needsReviewIds = recipes
          .filter((r) => r.status === "needs_review")
          .map((r) => r.id);
        return (
          <>
            {needsReviewIds.length >= 2 ? (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs">
                <span className="text-muted-foreground">
                  {needsReviewIds.length} {needsReviewIds.length === 1 ? "recipe" : "recipes"} ready
                  — skip individual review?
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => onSaveAll(needsReviewIds)}
                  disabled={savingAll}
                >
                  <CheckCheck className="mr-1 h-3.5 w-3.5" />
                  {savingAll ? "Saving..." : `Save all ${needsReviewIds.length}`}
                </Button>
              </div>
            ) : null}
            <ul className="mt-2 divide-y divide-border/40 rounded-md bg-muted/40 px-2 py-1">
              {recipes.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 px-1.5 py-1.5 text-sm"
                >
                  <RecipeCoverThumb
                    recipe={r}
                    onClick={() => onOpenCoverPicker(r.id)}
                  />
                  <span className="min-w-0 flex-1 truncate" title={r.title}>
                    {r.title}
                  </span>
                  {r.status === "needs_review" ? (
                    <Link
                      href={`/recipes/${r.id}/review`}
                      className="shrink-0 text-xs font-medium text-primary hover:underline"
                    >
                      Review →
                    </Link>
                  ) : r.status === "published" ? (
                    <Link
                      href={`/recipes/${r.id}`}
                      className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Open →
                    </Link>
                  ) : (
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {r.status}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        );
      })() : null}

      {/* Failed-recipe breakdown — appears under the success list when an
          import partially failed. Reasons are deduped at the action layer
          so we typically show one or two distinct error strings even with
          many failed recipes. */}
      {failures && failures.titles.length > 0 ? (
        <details className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs">
          <summary className="cursor-pointer font-medium text-destructive">
            {failures.titles.length} {failures.titles.length === 1 ? "recipe" : "recipes"}{" "}
            failed to save
          </summary>
          <ul className="mt-1.5 space-y-1 pl-2">
            {failures.titles.map((title) => (
              <li key={title} className="truncate text-muted-foreground" title={title}>
                · {title}
              </li>
            ))}
          </ul>
          {failures.reasons.length > 0 ? (
            <div className="mt-2 border-t border-destructive/20 pt-1.5 text-muted-foreground">
              <div className="font-medium text-destructive/90">Reason{failures.reasons.length > 1 ? "s" : ""}:</div>
              {failures.reasons.map((reason, i) => (
                <div key={i} className="mt-0.5 whitespace-pre-wrap break-words">
                  {reason}
                </div>
              ))}
            </div>
          ) : null}
        </details>
      ) : null}

      {isProcessing ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-[width] duration-500 ease-out",
              progress < 100 && "animate-pulse",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Tappable square thumbnail for a sub-row recipe. Resolves cover via the
 * shared `resolveCoverImage` (same priority as the recipes listing page —
 * user uploads first, then cover_image_path), signs at 96×96 for the
 * 40px-square render slot @ 2× DPI. Click bubbles up to open the cover
 * picker dialog scoped to this recipe.
 */
function RecipeCoverThumb({
  recipe,
  onClick,
}: {
  recipe: JobRecipe;
  onClick: () => void;
}) {
  const ref = resolveCoverImage({
    image_paths: recipe.image_paths,
    cover_image_path: recipe.cover_image_path,
  });
  // Width-only so we can apply focal positioning via CSS instead of a
  // server-side center crop.
  const url = useSignedImage(ref?.path ?? null, ref?.bucket ?? "recipe-uploads", {
    width: 128,
    quality: 70,
  });
  const focalStyle = coverObjectPositionStyle(recipe);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Change cover image"
      title="Change cover image"
      className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          style={focalStyle}
          className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
          —
        </div>
      )}
    </button>
  );
}

function StatusIcon({ status }: { status: Job["status"] }) {
  if (status === "needs_review" || status === "published")
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-destructive" />;
  return <Clock className="h-4 w-4 animate-pulse text-muted-foreground" />;
}
