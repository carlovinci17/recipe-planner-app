import "server-only";
import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest/client";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { extractRecipeFromText } from "@/lib/ai/recipe-extraction";
import { getSourceName } from "@/lib/recipes/source-name";
import { normalizeExtractedRecipe } from "@/lib/ingestion/normalize";
import { persistDraftRecipe } from "@/lib/ingestion/persist-recipe";
import {
  extractJobIdFromFailureEvent,
  markIngestionJobFailed,
} from "@/lib/inngest/helpers/mark-failed";
import { logger } from "@/lib/logger";

export type PageData = {
  /** Plain-text payload for the model — JSON-LD recipe object if present, else stripped HTML. */
  text: string;
  /** Best-guess hero image URL for the recipe (absolute), or null if we couldn't find one. */
  imageUrl: string | null;
  /** YouTube channel name, when the source is a YouTube video. Surfaced on the recipe row. */
  channelName?: string | null;
};

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1) || null;
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return v;
      // Shorts: /shorts/<id>
      const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
      if (shorts?.[1]) return shorts[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pull recipe-worthy text + a hero thumbnail out of a YouTube watch page.
 *
 * Strategy: scrape `var ytInitialPlayerResponse = {...}` from the page HTML.
 * That blob contains `videoDetails` with the full (un-truncated) description,
 * title, channel name, and thumbnails — same fields the watch UI uses. No
 * YouTube Data API key required.
 *
 * Returns a structured text block ("Title: ...\nChannel: ...\nDescription:
 * ...") so the AI extractor sees the recipe ingredients/steps that creators
 * paste into descriptions. Falls back to OpenGraph meta tags if the JSON
 * blob can't be parsed (rare, but YouTube has rolled out incompatible
 * shapes before).
 */
async function fetchYouTubeData(url: string): Promise<PageData> {
  const videoId = extractYouTubeVideoId(url);

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new NonRetriableError(
      `YouTube returned ${res.status} ${res.statusText} for ${url}. The video may be private or removed.`,
    );
  }
  const html = await res.text();

  let title: string | null = null;
  let description: string | null = null;
  let channelName: string | null = null;
  let thumbnailUrl: string | null = null;
  let publishDate: string | null = null;
  let duration: string | null = null;

  // Primary: ytInitialPlayerResponse. The regex is permissive about
  // whitespace + trailing `;` because YouTube has shipped both
  // `var ytInitialPlayerResponse = {...};` and `ytInitialPlayerResponse = {...};`
  // historically.
  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var|<\/script>|window\[)/s);
  if (playerMatch?.[1]) {
    try {
      const data = JSON.parse(playerMatch[1]) as {
        videoDetails?: {
          title?: string;
          shortDescription?: string;
          author?: string;
          lengthSeconds?: string;
          thumbnail?: { thumbnails?: Array<{ url?: string; width?: number }> };
        };
        microformat?: {
          playerMicroformatRenderer?: {
            publishDate?: string;
            uploadDate?: string;
            ownerChannelName?: string;
          };
        };
      };
      const details = data.videoDetails ?? {};
      title = details.title ?? null;
      description = details.shortDescription ?? null;
      channelName = details.author ?? data.microformat?.playerMicroformatRenderer?.ownerChannelName ?? null;
      publishDate =
        data.microformat?.playerMicroformatRenderer?.publishDate ??
        data.microformat?.playerMicroformatRenderer?.uploadDate ??
        null;
      if (details.lengthSeconds) {
        const secs = Number(details.lengthSeconds);
        if (Number.isFinite(secs) && secs > 0) {
          duration = `${Math.round(secs / 60)} min`;
        }
      }
      // Pick the largest available thumbnail.
      const thumbs = details.thumbnail?.thumbnails ?? [];
      const largest = [...thumbs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      thumbnailUrl = largest?.url ?? null;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "ytInitialPlayerResponse parse failed; falling back to og tags",
      );
    }
  }

  // Fallbacks: OpenGraph meta tags (less rich, but very stable).
  if (!title) title = matchMeta(html, "property", "og:title");
  if (!description) description = matchMeta(html, "property", "og:description");
  if (!thumbnailUrl) thumbnailUrl = matchMeta(html, "property", "og:image");
  if (!thumbnailUrl && videoId) {
    // Canonical thumbnail URL when all else fails. maxresdefault may 404
    // for some videos; hqdefault is universal.
    thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  const lines: string[] = [];
  if (title) lines.push(`Title: ${title}`);
  if (channelName) lines.push(`Channel: ${channelName}`);
  if (publishDate) lines.push(`Published: ${publishDate}`);
  if (duration) lines.push(`Video length: ${duration}`);
  if (lines.length > 0) lines.push("");
  if (description) {
    lines.push("Description:");
    lines.push(description);
  }
  const text = lines.join("\n").trim();

  if (!text) {
    throw new NonRetriableError(
      "Couldn't extract any text from this YouTube video. The page may be region-locked.",
    );
  }

  return { text, imageUrl: thumbnailUrl, channelName };
}

/**
 * Fetch a recipe URL and pull two things out:
 *   1. The text payload (JSON-LD recipe schema if present, else stripped HTML)
 *   2. A best-guess hero-image URL — JSON-LD `image` first, then OpenGraph,
 *      then Twitter Card, all resolved against the page URL.
 */
export async function fetchPageData(url: string): Promise<PageData> {
  // YouTube pages don't render content server-side, so JSON-LD scraping
  // returns nothing useful. Route to a dedicated YouTube extractor that
  // pulls description/title/channel from the embedded ytInitialPlayerResponse.
  if (isYouTubeUrl(url)) {
    return fetchYouTubeData(url);
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new NonRetriableError(
      `Fetch ${url} returned ${res.status} ${res.statusText}. The site likely blocks our request — try a different recipe URL.`,
    );
  }

  const html = await res.text();
  const finalUrl = res.url || url;

  let text: string | null = null;
  let imageUrl: string | null = null;

  // ─── JSON-LD recipe schema (authoritative when present) ───
  const ldBlocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  if (ldBlocks) {
    for (const block of ldBlocks) {
      const json = block.replace(/^[\s\S]*?>/, "").replace(/<\/script>[\s\S]*$/, "");
      try {
        const parsed = JSON.parse(json);
        // JSON-LD can be an array of items, a single item, or wrapped in @graph.
        const items: unknown[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { "@graph"?: unknown[] })["@graph"])
            ? ((parsed as { "@graph": unknown[] })["@graph"])
            : [parsed];
        for (const raw of items) {
          const item = raw as Record<string, unknown>;
          const types = Array.isArray(item["@type"]) ? (item["@type"] as string[]) : [item["@type"] as string];
          if (types.includes("Recipe")) {
            if (!text) text = JSON.stringify(item);
            if (!imageUrl) imageUrl = pickImageFromLd(item.image);
          }
        }
      } catch {
        // ignore malformed JSON-LD
      }
    }
  }

  // ─── OpenGraph + Twitter image fallback ───
  if (!imageUrl) imageUrl = matchMeta(html, "property", "og:image");
  if (!imageUrl) imageUrl = matchMeta(html, "name", "twitter:image");
  if (!imageUrl) imageUrl = matchMeta(html, "name", "twitter:image:src");

  // Resolve relative paths against the (post-redirect) page URL.
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, finalUrl).toString();
    } catch {
      imageUrl = null;
    }
  }

  // Filter out data: / blob: / unknown protocols.
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    imageUrl = null;
  }

  // ─── Text fallback if no JSON-LD recipe ───
  if (!text) {
    text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return { text, imageUrl };
}

/**
 * JSON-LD `image` can be: a string URL, an array of strings, an ImageObject
 * with a `url` field, or an array of ImageObjects. Pick the first usable URL.
 */
function pickImageFromLd(image: unknown): string | null {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    for (const item of image) {
      const url = pickImageFromLd(item);
      if (url) return url;
    }
    return null;
  }
  if (typeof image === "object" && image !== null) {
    const obj = image as Record<string, unknown>;
    if (typeof obj.url === "string") return obj.url;
    if (typeof obj["@id"] === "string") return obj["@id"] as string;
    if (typeof obj.contentUrl === "string") return obj.contentUrl;
  }
  return null;
}

/**
 * Pull a meta tag's content. Handles both attribute orders (property=...content=
 * and content=...property=). HTML-entity-decodes &amp; → & for safe URLs.
 */
function matchMeta(html: string, attr: "property" | "name", value: string): string | null {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].replace(/&amp;/g, "&");
  }
  return null;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB sanity cap

/**
 * Best-effort: download the page's hero image and upload it to recipe-images.
 * Returns the storage path on success, null on any failure (caller decides
 * whether to surface). Never throws — recipe import shouldn't fail because
 * a stray hero image was unreachable.
 */
async function downloadAndUploadHeroImage(args: {
  imageUrl: string;
  householdId: string;
  recipeId: string;
}): Promise<string | null> {
  try {
    const res = await fetch(args.imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;

    const contentType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
    if (!contentType.startsWith("image/")) return null;

    const lengthHeader = res.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_IMAGE_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) return null;

    // Map common image MIME types to extensions for storage path readability.
    const ext = ({
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
    } as Record<string, string>)[contentType] ?? "jpg";

    const path = `${args.householdId}/${args.recipeId}/cover-source.${ext}`;
    const supabase = createSupabaseAdmin();
    const { error: upErr } = await supabase.storage
      .from("recipe-images")
      .upload(path, buf, { contentType, upsert: true });
    if (upErr) {
      logger.warn({ err: upErr.message }, "hero image upload failed");
      return null;
    }

    return path;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "hero image fetch failed");
    return null;
  }
}

export const processUrl = inngest.createFunction(
  {
    id: "ingestion-process-url",
    name: "Process recipe URL",
    retries: 3,
    onFailure: async ({ event, error }) => {
      const jobId = extractJobIdFromFailureEvent(event);
      await markIngestionJobFailed(jobId, error.message ?? "URL pipeline failed");
    },
  },
  { event: "ingestion/url.requested" },
  async ({ event, step }) => {
    const { jobId, householdId, url } = event.data;
    const supabase = createSupabaseAdmin();

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

    const page = await step.run("fetch-page", () => fetchPageData(url));

    const extraction = await step.run("extract", () =>
      extractRecipeFromText({ text: page.text, url }),
    );

    const allDetected = extraction.data.recipes ?? [];
    const kept = allDetected.filter((r) => r.is_recipe && r.confidence >= 0.3);

    if (kept.length === 0) {
      await step.run("mark-failed", async () => {
        await supabase
          .from("ingestion_jobs")
          .update({
            status: "failed",
            error:
              allDetected.length === 0
                ? "URL did not appear to contain a recipe"
                : "Detected content didn't reach the confidence threshold",
            raw_extraction: extraction.data,
          })
          .eq("id", jobId);
      });
      throw new NonRetriableError("URL did not contain a recipe");
    }

    await step.run("emit-extraction-completed", async () => {
      await supabase.from("ingestion_events").insert({
        job_id: jobId,
        kind: "extraction_completed",
        payload: { recipes_found: allDetected.length, recipes_kept: kept.length },
      });
    });

    const normalizedAll = kept.map((r) => normalizeExtractedRecipe(r));

    // Persist each detected recipe with tagged-result pattern (catch inside
    // step.run, return ok/error) so Inngest doesn't retry permanent failures.
    // See process-upload.ts for the longer rationale.
    type PersistResult =
      | { ok: true; id: string; title: string }
      | { ok: false; title: string; error: string };
    const results: PersistResult[] = [];

    for (let idx = 0; idx < normalizedAll.length; idx++) {
      const recipe = normalizedAll[idx]!;
      const result = await step.run(
        `persist-recipe-${idx}`,
        async (): Promise<PersistResult> => {
          try {
            const recipeId = await persistDraftRecipe({
              householdId,
              createdBy: job.created_by,
              sourceKind: "url",
              sourceUrl: url,
              aiModel: extraction.usage.model,
              extracted: recipe,
              ingestionJobId: jobId,
              // Auto-populate the human-friendly source label. YouTube
              // channel name wins (more specific than "YouTube"); otherwise
              // we fall back to the domain-derived name from the KNOWN map.
              sourceName: page.channelName ?? getSourceName(url),
            });
            await supabase.from("ingestion_events").insert({
              job_id: jobId,
              kind: "recipe_ready_for_review",
              payload: { recipeId, index: idx, total: normalizedAll.length },
            });
            return { ok: true, id: recipeId, title: recipe.title };
          } catch (err) {
            const message = (err as Error).message;
            logger.warn(
              { jobId, idx, title: recipe.title, err: message },
              "recipe persistence failed; continuing with siblings",
            );
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
        },
      );
      results.push(result);
    }

    const persisted = results
      .filter((r): r is Extract<PersistResult, { ok: true }> => r.ok)
      .map((r) => r.id);
    const failures = results.filter(
      (r): r is Extract<PersistResult, { ok: false }> => !r.ok,
    );

    if (persisted.length === 0) {
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

    const primaryRecipeId = persisted[0]!;
    await step.run("finalize-job", async () => {
      await supabase
        .from("ingestion_jobs")
        .update({
          recipe_id: primaryRecipeId,
          status: "needs_review",
          raw_extraction: extraction.data,
          normalized: normalizedAll,
          ai_model: extraction.usage.model,
          prompt_tokens: extraction.usage.promptTokens,
          completion_tokens: extraction.usage.completionTokens,
          cost_cents: extraction.usage.costCents ?? null,
        })
        .eq("id", jobId);
    });

    // YouTube: persist the channel name on every recipe so the recipe
    // detail page can show "via <Channel>" instead of just the raw URL.
    if (page.channelName) {
      await step.run("attach-channel-name", async () => {
        await supabase
          .from("recipes")
          .update({ source_metadata: { channel_name: page.channelName } })
          .in("id", persisted);
      });
    }

    // Best-effort hero image fetch on the primary recipe only. Failures
    // don't abort the import.
    if (page.imageUrl) {
      await step.run("attach-hero-image", async () => {
        const path = await downloadAndUploadHeroImage({
          imageUrl: page.imageUrl!,
          householdId,
          recipeId: primaryRecipeId,
        });
        if (path) {
          const supa = createSupabaseAdmin();
          await supa
            .from("recipes")
            .update({ image_paths: [path] })
            .eq("id", primaryRecipeId);
        }
        return { attached: !!path };
      });
    }

    for (let i = 0; i < persisted.length; i++) {
      await step.sendEvent(`emit-tagging-${i}`, {
        name: "ingestion/recipe.tagging.requested",
        data: { recipeId: persisted[i]! },
      });
    }

    return {
      jobId,
      recipeIds: persisted,
      primaryRecipeId,
      hasImage: !!page.imageUrl,
    };
  },
);
