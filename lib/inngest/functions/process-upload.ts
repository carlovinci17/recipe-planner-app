import "server-only";
import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest/client";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ingestionStorage } from "@/lib/ingestion/storage";
import { pdfBufferToPageImages } from "@/lib/ingestion/pdf-to-images";
import { extractRecipeFromImages, skimRecipesFromImages } from "@/lib/ai/recipe-extraction";
import { normalizeExtractedRecipe } from "@/lib/ingestion/normalize";
import { persistDraftRecipe } from "@/lib/ingestion/persist-recipe";
import type { ExtractedRecipe } from "@/lib/ai/schemas";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import {
  extractJobIdFromFailureEvent,
  markIngestionJobFailed,
} from "@/lib/inngest/helpers/mark-failed";

/**
 * Vision-call sizing: a single Anthropic call with 14+ high-detail page
 * images + 12000 output tokens can run 30+ minutes and trips the stuck-job
 * sweep. Splitting into 5-page chunks (with 1-page overlap so cross-
 * boundary recipes survive) keeps each call bounded ~1–5 min, and the
 * heartbeat step between chunks refreshes ingestion_jobs.updated_at so
 * the sweep doesn't false-positive.
 */
const VISION_CHUNK_PAGES = 5;
const VISION_CHUNK_OVERLAP = 1;

function chunkPages(pages: string[]): string[][] {
  if (pages.length <= VISION_CHUNK_PAGES) return [pages];
  const stride = VISION_CHUNK_PAGES - VISION_CHUNK_OVERLAP;
  const chunks: string[][] = [];
  for (let i = 0; i < pages.length; i += stride) {
    chunks.push(pages.slice(i, Math.min(i + VISION_CHUNK_PAGES, pages.length)));
    if (i + VISION_CHUNK_PAGES >= pages.length) break;
  }
  return chunks;
}

/**
 * Normalize a recipe title for dedupe (overlapping chunks can surface the
 * same recipe twice). Mirrors the filename normalizer used by Drive scan.
 */
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Dedupe across chunks. When the same recipe appears in adjacent chunks
 * (because of the page overlap), keep the more complete version —
 * measured by ingredient + instruction count.
 */
function dedupeRecipes(recipes: ExtractedRecipe[]): ExtractedRecipe[] {
  const byTitle = new Map<string, ExtractedRecipe>();
  for (const r of recipes) {
    const key = normalizeTitle(r.title);
    if (!key) continue;
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, r);
      continue;
    }
    const existingScore = existing.ingredients.length + existing.instructions.length;
    const candidateScore = r.ingredients.length + r.instructions.length;
    if (candidateScore > existingScore) byTitle.set(key, r);
  }
  return Array.from(byTitle.values());
}

/**
 * Main ingestion pipeline for uploaded files (PDFs, images, screenshots).
 *
 * Flow:
 *   1. Mark job as ai_processing_started
 *   2. Download original file from storage
 *   3. If PDF: render pages to images and upload back to storage
 *      Else (image/screenshot): use the original as a single page
 *   4. Sign URLs and call vision model
 *   5. Validate + normalize the extracted recipe
 *   6. Insert draft recipe (status: needs_review)
 *   7. Emit recipe.tagging.requested event
 *
 * Each step is wrapped in `step.run` so Inngest persists progress and retries
 * cleanly without redoing earlier work.
 */
export const processUpload = inngest.createFunction(
  {
    id: "ingestion-process-upload",
    name: "Process uploaded recipe file",
    retries: 3,
    concurrency: { limit: 5 },
    onFailure: async ({ event, error }) => {
      const jobId = extractJobIdFromFailureEvent(event);
      await markIngestionJobFailed(jobId, error.message ?? "Pipeline failed");
    },
  },
  { event: "ingestion/file.uploaded" },
  async ({ event, step }) => {
    const { jobId, householdId } = event.data;
    const supabase = createSupabaseAdmin();

    // ── 1. Lock job row & emit ai_processing_started ──────────────────
    const job = await step.run("load-job", async () => {
      const { data, error } = await supabase
        .from("ingestion_jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      if (error || !data) throw new NonRetriableError(`Job ${jobId} not found`);
      return data;
    });

    await step.run("mark-processing", async () => {
      await supabase.from("ingestion_jobs").update({ status: "processing" }).eq("id", jobId);
      await supabase
        .from("ingestion_events")
        .insert({ job_id: jobId, kind: "ai_processing_started", payload: {} });
    });

    if (!job.storage_bucket || !job.storage_path) {
      throw new NonRetriableError("Job missing storage location");
    }

    // ── 2-3. Download + rasterize (combined; Inngest can't checkpoint a Buffer) ──
    const pageImagePaths = await step.run("download-and-rasterize", async () => {
      const originalBuffer = await ingestionStorage.downloadFile({
        bucket: job.storage_bucket!,
        path: job.storage_path!,
      });

      const isPdf =
        job.source_kind === "pdf" || job.storage_path!.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        // Rendering cap must cover at least startOffset + extraction range so
        // pages beyond the default 25 are actually available for the AI.
        // Bulk with no extraction cap → render all pages (undefined = no cap).
        // Interactive imports → cap at 100 (generous for any cookbook).
        const renderMaxPages = bulkMode
          ? (bulkMaxPages ? startOffset + bulkMaxPages : undefined)
          : 100;
        const images = await pdfBufferToPageImages({ buffer: originalBuffer, maxPages: renderMaxPages });
        const paths: string[] = [];
        for (let i = 0; i < images.length; i++) {
          const path = await ingestionStorage.uploadDerivedImage({
            householdId,
            jobId,
            pageIndex: i,
            buffer: images[i]!,
            // Rasterizer now emits JPEG to keep file sizes manageable.
            format: "jpeg",
          });
          paths.push(path);
        }
        return paths;
      }

      // Already an image. Browser-uploaded HEIC / huge JPEGs / 12MP photos
      // can easily be 5–10MB at full resolution — too big for cover thumbs
      // and slow for Anthropic to fetch. Re-encode to a normalized 1200px
      // JPEG and use *that* as the page source. The raw original stays in
      // storage at job.storage_path for audit / re-run scenarios.
      try {
        const sharp = (await import("sharp")).default;
        const optimised = await sharp(originalBuffer)
          .rotate() // honor EXIF orientation
          .resize({ width: 1200, withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();
        const optimisedPath = await ingestionStorage.uploadDerivedImage({
          householdId,
          jobId,
          pageIndex: 0,
          buffer: optimised,
          format: "jpeg",
        });
        return [optimisedPath];
      } catch (err) {
        // If sharp can't decode the bytes (rare — wrong content-type, corrupt
        // file), fall back to the raw original so vision still runs on
        // *something*. Worst case is a slower load, not a failure.
        logger.warn(
          { jobId, err: (err as Error).message },
          "source image normalize failed; using original",
        );
        return [job.storage_path!];
      }
    });

    await step.run("save-page-paths", async () => {
      await supabase
        .from("ingestion_jobs")
        .update({ page_image_paths: pageImagePaths })
        .eq("id", jobId);
    });

    if (pageImagePaths.length === 0) {
      throw new NonRetriableError("No page images produced");
    }

    // ── 3.5 Optional skim phase ────────────────────────────────────────
    // For documents likely to contain multiple recipes (3+ pages), do a
    // fast Haiku pass to extract just titles. Pause the pipeline, ask the
    // user which recipes to deep-extract, then resume on the subset. Saves
    // expensive Opus tokens on recipes the user doesn't want and gives a
    // time-to-first-decision in <60s vs minutes for a full extract.
    //
    // Skipped for short docs (single image, 1–2 pages) where the overhead
    // isn't worth the round trip.
    // Bulk-mode jobs (set by the local import script) skip the skim pause so
    // they don't wait 24h for user input. They also cap page count and use a
    // cheaper model (ANTHROPIC_MODEL_BULK) to reduce cost and processing time.
    const bulkMode = event.data.bulkMode === true;
    const useOpus = event.data.useOpus === true;
    const bulkMaxPages = event.data.maxPages; // undefined = no cap
    // startPage is 1-based; convert to 0-based slice offset
    const startOffset = Math.max(0, (event.data.startPage ?? 1) - 1);

    const SKIM_PAGE_THRESHOLD = 3;
    const pagesFromStart = startOffset > 0 ? pageImagePaths.slice(startOffset) : pageImagePaths;
    if (pagesFromStart.length === 0) {
      throw new NonRetriableError(
        `startPage (${event.data.startPage}) exceeds this PDF's page count (${pageImagePaths.length} pages)`,
      );
    }
    let pagesToExtract = bulkMode && bulkMaxPages
      ? pagesFromStart.slice(0, bulkMaxPages)
      : pagesFromStart;
    // null when no skim ran (short docs go direct to deep extract).
    // Array of normalized titles when skim ran — used after extraction to
    // drop unrelated recipes the model returned from the same pages.
    let selectedTitlesNormalized: Set<string> | null = null;
    // Batch-level source override the user typed in the skim dialog. When
    // set, it replaces the per-recipe AI/URL-derived source on every
    // persisted recipe. null on both fields means "no override".
    let batchSourceOverride: { name: string | null; url: string | null } = {
      name: null,
      url: null,
    };

    if (pageImagePaths.length >= SKIM_PAGE_THRESHOLD && !bulkMode) {
      const skim = await step.run("skim-recipes", async () => {
        const urls = await ingestionStorage.signedUrls({
          bucket: ingestionStorage.uploadsBucket,
          paths: pageImagePaths,
          expiresIn: 1800,
        });
        const result = await skimRecipesFromImages({ imageUrls: urls });
        return result.data.recipes;
      });

      await step.run("save-skim", async () => {
        await supabase
          .from("ingestion_jobs")
          .update({
            skim_results: { recipes: skim },
            // Refresh updated_at so the stuck-sweep doesn't fire while
            // we're parked on waitForEvent.
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        // Reuse extraction_completed kind; the payload signals "skim phase"
        // so the UI can branch to the picker.
        await supabase.from("ingestion_events").insert({
          job_id: jobId,
          kind: "extraction_completed",
          payload: { phase: "skim", recipes_found: skim.length },
        });
      });

      // Pause until the user commits a selection (or 24h timeout). Inngest
      // releases the worker while we wait — no token cost.
      const commit = await step.waitForEvent("await-skim-selection", {
        event: "ingestion/file.skim.committed",
        timeout: "24h",
        if: `event.data.jobId == "${jobId}"`,
      });

      if (!commit) {
        // User never responded. Mark failed so it leaves the active list.
        await step.run("mark-skim-timeout", async () => {
          await supabase
            .from("ingestion_jobs")
            .update({
              status: "failed",
              error: "Skim preview wasn't acted on within 24 hours.",
            })
            .eq("id", jobId);
        });
        throw new NonRetriableError("Skim selection timed out");
      }

      const selected = commit.data.selectedIndices ?? [];
      // Capture the batch source the user typed in the skim dialog. Empty
      // strings collapse to null at the action layer; defensively coerce
      // here too in case an older client sent through whitespace.
      const rawName = (commit.data as { sourceName?: string | null }).sourceName ?? null;
      const rawUrl = (commit.data as { sourceUrl?: string | null }).sourceUrl ?? null;
      batchSourceOverride = {
        name: rawName && rawName.trim().length > 0 ? rawName.trim() : null,
        url: rawUrl && rawUrl.trim().length > 0 ? rawUrl.trim() : null,
      };
      if (selected.length === 0) {
        // User cancelled the import from the picker. Mark failed cleanly.
        await step.run("mark-skim-cancelled", async () => {
          await supabase
            .from("ingestion_jobs")
            .update({
              status: "failed",
              error: "Cancelled at the recipe selection step.",
            })
            .eq("id", jobId);
        });
        throw new NonRetriableError("Skim selection cancelled");
      }

      // Narrow the pages we'll deep-extract to those that contain the
      // selected recipes (± 1 page each side for cross-boundary recipes).
      // Falls back to all pages if no recipe has a usable page_index.
      const wantedPageIdxSet = new Set<number>();
      for (const idx of selected) {
        const sk = skim[idx];
        if (!sk) continue;
        const p = sk.source_page_index;
        if (!p || p < 1 || p > pageImagePaths.length) continue;
        for (const offset of [-1, 0, 1]) {
          const target = p - 1 + offset;
          if (target >= 0 && target < pageImagePaths.length) wantedPageIdxSet.add(target);
        }
      }
      const wantedPageIdx = Array.from(wantedPageIdxSet).sort((a, b) => a - b);
      pagesToExtract =
        wantedPageIdx.length > 0
          ? wantedPageIdx.map((i) => pageImagePaths[i]!)
          : pageImagePaths;

      // Save which recipes the user picked so the post-extract filter can
      // drop unrelated recipes the model returns from the same pages.
      const selectedTitles = selected
        .map((i) => skim[i]?.title)
        .filter((t): t is string => typeof t === "string" && t.length > 0);
      selectedTitlesNormalized = new Set(selectedTitles.map(normalizeTitle));

      await step.run("save-skim-selection", async () => {
        await supabase
          .from("ingestion_jobs")
          .update({
            skim_results: {
              recipes: skim,
              selected_titles: selectedTitles,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      });
    }

    // ── 4. Vision extraction (chunked for long PDFs) ──────────────────
    // Each chunk is its own Inngest step so:
    //   (a) failure mid-document doesn't redo earlier work
    //   (b) no single step exceeds the stuck-job sweep cutoff
    //   (c) we can touch updated_at between chunks
    const chunks = chunkPages(pagesToExtract);
    const allDetected: ExtractedRecipe[] = [];
    let usageModel = "";
    let usagePromptTokens = 0;
    let usageCompletionTokens = 0;
    let usageCostCents = 0;

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci]!;
      const chunkResult = await step.run(`vision-extract-${ci}`, async () => {
        const urls = await ingestionStorage.signedUrls({
          bucket: ingestionStorage.uploadsBucket,
          paths: chunk,
          // 30-min signed URLs — long enough that an Anthropic-side retry
          // mid-call doesn't run out of time.
          expiresIn: 1800,
        });
        const result = await extractRecipeFromImages({
          imageUrls: urls,
          hint:
            chunks.length > 1
              ? `These are pages ${chunk[0]} – ${chunk[chunk.length - 1]} (chunk ${ci + 1} of ${chunks.length}) from a multi-page document. Some recipes may span chunk boundaries; extract what's visible here.`
              : undefined,
          model: bulkMode && !useOpus ? env.ANTHROPIC_MODEL_BULK : undefined,
        });
        return {
          recipes: result.data.recipes ?? [],
          model: result.usage.model,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          costCents: result.usage.costCents ?? 0,
        };
      });

      allDetected.push(...chunkResult.recipes);
      usageModel = chunkResult.model;
      usagePromptTokens += chunkResult.promptTokens;
      usageCompletionTokens += chunkResult.completionTokens;
      usageCostCents += chunkResult.costCents;

      // Heartbeat between chunks. Refreshes updated_at so the sweep sees
      // an alive job; emits an event so the UI / debugging has a trail.
      await step.run(`vision-progress-${ci}`, async () => {
        await supabase
          .from("ingestion_jobs")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", jobId);
        await supabase.from("ingestion_events").insert({
          job_id: jobId,
          kind: "ai_processing_started",
          payload: {
            chunk: ci + 1,
            total_chunks: chunks.length,
            recipes_so_far: allDetected.length,
          },
        });
      });
    }

    // Dedupe across chunk boundaries — overlap can return the same recipe
    // from two chunks; keep the more complete version.
    const deduped = dedupeRecipes(allDetected);
    // Bulk mode uses Sonnet which tends to return lower confidence scores than
    // Opus for the same content — lower the threshold so valid recipes aren't
    // silently discarded.
    const confidenceThreshold = bulkMode ? 0.1 : 0.3;
    let kept = deduped.filter((r) => r.is_recipe && r.confidence >= confidenceThreshold);

    // If the user went through the skim picker, narrow `kept` to recipes
    // whose title matches one they selected. The deep extract sees a
    // buffered page range, so it can surface neighbors the user
    // intentionally skipped — drop those here.
    if (selectedTitlesNormalized && selectedTitlesNormalized.size > 0) {
      kept = kept.filter((r) => selectedTitlesNormalized!.has(normalizeTitle(r.title)));
    }

    if (kept.length === 0) {
      if (bulkMode) {
        // In bulk mode, complete gracefully rather than hard-failing — the page
        // range may simply not contain recipes. The user can re-run with
        // --force and a different --start-page without a permanently failed job.
        await step.run("mark-bulk-no-recipes", async () => {
          await supabase
            .from("ingestion_jobs")
            .update({
              status: "needs_review",
              error:
                deduped.length === 0
                  ? "No recipes found in this page range — try --force with a different --start-page"
                  : "Recipes detected but all below confidence threshold — try --force with a different page range",
              raw_extraction: { recipes: deduped },
              ai_model: usageModel,
              prompt_tokens: usagePromptTokens,
              completion_tokens: usageCompletionTokens,
              cost_cents: usageCostCents || null,
            })
            .eq("id", jobId);
        });
        return { jobId, recipesFound: 0 };
      }
      await step.run("mark-failed-no-recipes", async () => {
        await supabase
          .from("ingestion_jobs")
          .update({
            status: "failed",
            error:
              deduped.length === 0
                ? "Source did not appear to contain any recipes"
                : "Detected content didn't reach the confidence threshold",
            raw_extraction: { recipes: deduped },
            ai_model: usageModel,
            prompt_tokens: usagePromptTokens,
            completion_tokens: usageCompletionTokens,
            cost_cents: usageCostCents || null,
          })
          .eq("id", jobId);
        await supabase
          .from("ingestion_events")
          .insert({ job_id: jobId, kind: "failed", payload: { reason: "no_recipes" } });
      });
      throw new NonRetriableError("No recipes detected");
    }

    await step.run("emit-extraction-completed", async () => {
      await supabase.from("ingestion_events").insert({
        job_id: jobId,
        kind: "extraction_completed",
        payload: {
          recipes_found: deduped.length,
          recipes_kept: kept.length,
          chunks: chunks.length,
        },
      });
    });

    // Synthesize a usage/extraction object compatible with the existing
    // downstream code so the rest of the pipeline doesn't need to change.
    const extraction = {
      data: { recipes: deduped },
      usage: {
        model: usageModel,
        promptTokens: usagePromptTokens,
        completionTokens: usageCompletionTokens,
        totalTokens: usagePromptTokens + usageCompletionTokens,
        costCents: usageCostCents || undefined,
      },
    };

    // ── 5. Normalize each detected recipe ─────────────────────────────
    const normalizedAll = await step.run("normalize", () =>
      Promise.resolve(kept.map((r) => normalizeExtractedRecipe(r))),
    );

    await step.run("emit-validation-completed", async () => {
      await supabase.from("ingestion_events").insert({
        job_id: jobId,
        kind: "validation_completed",
        payload: { recipes_kept: kept.length },
      });
      await supabase
        .from("ingestion_jobs")
        .update({
          raw_extraction: extraction.data,
          // Normalized stores the array of all kept recipes now (was a
          // single object). Used for debug/audit.
          normalized: normalizedAll,
          ai_model: extraction.usage.model,
          prompt_tokens: extraction.usage.promptTokens,
          completion_tokens: extraction.usage.completionTokens,
          cost_cents: extraction.usage.costCents ?? null,
        })
        .eq("id", jobId);
    });

    // ── 6. Persist each recipe ────────────────────────────────────────
    // Each survives or fails independently. The job is considered
    // successful as long as at least one recipe makes it in.
    //
    // Critical: we catch INSIDE step.run and return a tagged result. If
    // we let persist errors throw out of step.run, Inngest retries the
    // step (default retries: 3) before the outer try/catch sees the
    // error. With 8 recipes consistently failing for the same reason
    // (e.g., a missing column), that's 24 retried calls minutes apart —
    // pushing total time past the stuck-job cutoff. Tagged results
    // sidestep retries entirely.
    type PersistResult =
      | { ok: true; id: string; title: string }
      | { ok: false; title: string; error: string };
    const results: PersistResult[] = [];

    for (let idx = 0; idx < normalizedAll.length; idx++) {
      const recipe = normalizedAll[idx]!;
      const stepKey = `persist-recipe-${idx}`;
      const result = await step.run(stepKey, async (): Promise<PersistResult> => {
        try {
          const id = await persistDraftRecipe({
            householdId,
            createdBy: job.created_by,
            sourceKind: job.source_kind,
            // Batch override (typed in the skim dialog) wins over the job's
            // own source_url. When the override is null, fall back to the
            // job row's URL as before.
            sourceUrl: batchSourceOverride.url ?? job.source_url,
            sourceName: batchSourceOverride.name,
            // Map each recipe to its own source page when the AI reported one.
            // 1-indexed from the prompt; out-of-range / null falls back to
            // page 0 so we always have a cover (the user can re-pick during
            // review via the CoverPicker on the recipe page).
            coverImagePath: (() => {
              const idx = recipe.source_page_index;
              if (idx && idx >= 1 && idx <= pageImagePaths.length) {
                return pageImagePaths[idx - 1] ?? null;
              }
              return pageImagePaths[0] ?? null;
            })(),
            // image_paths is reserved for user-uploaded images (recipe-images
            // bucket). Page images live in recipe-uploads and are surfaced
            // via cover_image_path; leave image_paths empty here so the two
            // columns stay aligned with their buckets.
            imagePaths: [],
            aiModel: extraction.usage.model,
            extracted: recipe,
            ingestionJobId: jobId,
            // Carry the Drive file id (or any other external source id) onto
            // the recipe row itself — this is the canonical key future
            // scans use to skip already-imported files, even after the
            // ingestion_jobs history is cleared.
            externalSourceId: job.external_file_id,
          });
          await supabase.from("ingestion_events").insert({
            job_id: jobId,
            kind: "recipe_ready_for_review",
            // index/total drive the "Saving X of Y" UI label.
            payload: { recipeId: id, index: idx, total: normalizedAll.length },
          });
          // Bump the job row's updated_at so the stuck-job sweep doesn't
          // false-positive a legit long-running multi-recipe import. The
          // row's updated_at trigger handles the timestamp; the explicit
          // value here just guarantees the trigger fires.
          await supabase
            .from("ingestion_jobs")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", jobId);
          return { ok: true, id, title: recipe.title };
        } catch (err) {
          const message = (err as Error).message;
          logger.warn(
            { jobId, idx, title: recipe.title, err: message },
            "recipe persistence failed; continuing with siblings",
          );
          // Emit a per-recipe failure event so the UI can surface "X failed"
          // counts and titles. Without this, partial failures are invisible.
          await supabase.from("ingestion_events").insert({
            job_id: jobId,
            kind: "failed",
            payload: {
              reason: "persist_recipe",
              index: idx,
              total: normalizedAll.length,
              title: recipe.title,
              error: message,
            },
          });
          return { ok: false, title: recipe.title, error: message };
        }
      });
      results.push(result);
    }

    const persisted = results
      .filter((r): r is Extract<PersistResult, { ok: true }> => r.ok)
      .map((r) => r.id);
    const failures = results.filter(
      (r): r is Extract<PersistResult, { ok: false }> => !r.ok,
    );

    if (persisted.length === 0) {
      // Show the actual reasons — much more useful than "All recipe
      // inserts failed". If all failures share the same error (typical
      // when a column is missing), dedupe to keep the message tight.
      const uniqueReasons = Array.from(new Set(failures.map((f) => f.error))).slice(0, 3);
      const errorMsg =
        `All ${failures.length} recipe ${failures.length === 1 ? "insert" : "inserts"} failed. ` +
        uniqueReasons.map((r) => `\n  • ${r}`).join("");
      await step.run("mark-failed-all-persists-failed", async () => {
        await supabase
          .from("ingestion_jobs")
          .update({ status: "failed", error: errorMsg })
          .eq("id", jobId);
        await supabase.from("ingestion_events").insert({
          job_id: jobId,
          kind: "failed",
          payload: {
            reason: "all_persists_failed",
            failures: failures.map((f) => ({ title: f.title, error: f.error })),
          },
        });
      });
      throw new NonRetriableError(errorMsg);
    }

    // Partial-failure path: at least one survived. Emit a summary event
    // so the UI shows "Saved X of N · Y failed" with the failed titles.
    if (failures.length > 0) {
      await step.run("emit-persist-summary", async () => {
        await supabase.from("ingestion_events").insert({
          job_id: jobId,
          kind: "validation_completed",
          payload: {
            partial: true,
            succeeded: persisted.length,
            failed: failures.length,
            failed_titles: failures.map((f) => f.title).slice(0, 20),
            failure_reasons: Array.from(new Set(failures.map((f) => f.error))).slice(0, 5),
          },
        });
      });
    }

    // The first persisted recipe becomes the job's "primary" — that's what
    // existing UI links (Review →, Open →) point at. Siblings are reachable
    // via the recipes.ingestion_job_id back-link.
    const primaryRecipeId = persisted[0]!;
    await step.run("finalize-job", async () => {
      await supabase
        .from("ingestion_jobs")
        .update({ recipe_id: primaryRecipeId, status: "needs_review" })
        .eq("id", jobId);
    });

    // ── 7. Clean up source files ──────────────────────────────────────
    // The recipe data is now in Postgres. Keep only the page image(s)
    // used as recipe covers — delete everything else (the original PDF
    // or raw image, plus any page renders not referenced by a cover).
    await step.run("cleanup-source-files", async () => {
      const toDelete: string[] = [];

      // Original source file (PDF or raw uploaded image) is no longer
      // needed — the extracted data is in Postgres and the cover images
      // below are the web-optimised renders we actually serve.
      if (job.storage_path) toDelete.push(job.storage_path);

      // Work out which page images are actually used as covers so we can
      // keep those and delete the rest. Mirrors the cover selection logic
      // in the persist step above.
      const usedAsCovers = new Set(
        normalizedAll.map((r) => {
          const pi = r.source_page_index;
          if (pi && pi >= 1 && pi <= pageImagePaths.length) {
            return pageImagePaths[pi - 1]!;
          }
          return pageImagePaths[0]!;
        }),
      );

      for (const path of pageImagePaths) {
        if (!usedAsCovers.has(path)) toDelete.push(path);
      }

      if (toDelete.length === 0) return;

      const supa = createSupabaseAdmin();
      const { error } = await supa.storage
        .from(ingestionStorage.uploadsBucket)
        .remove(toDelete);

      if (error) {
        // Don't fail the job — recipe is already saved.
        logger.warn(
          { jobId, filesCount: toDelete.length, error: error.message },
          "source file cleanup failed",
        );
      } else {
        logger.info({ jobId, filesDeleted: toDelete.length }, "source files cleaned up");
      }
    });

    // ── 8. Fan out: tagging (one event per recipe) ────────────────────
    for (let i = 0; i < persisted.length; i++) {
      await step.sendEvent(`emit-tagging-${i}`, {
        name: "ingestion/recipe.tagging.requested",
        data: { recipeId: persisted[i]! },
      });
    }

    logger.info(
      { jobId, householdId, recipeIds: persisted },
      "ingestion completed (multi-recipe)",
    );
    return {
      jobId,
      status: "needs_review" as const,
      recipeIds: persisted,
      primaryRecipeId,
    };
  },
);
