import "server-only";
import { logger } from "@/lib/logger";

/**
 * Fetch a recipe page and reduce it to something a text model can read.
 *
 * Extracted from the former `lib/inngest/functions/process-url.ts` when Inngest
 * was decommissioned: the scraping is engine-agnostic and the Durable Functions
 * URL pipeline (`process-url-core.ts`) is its only caller now.
 *
 * Strategy, in order of trust:
 *   1. YouTube gets a dedicated path — the page renders client-side, so
 *      JSON-LD scraping finds nothing; the data lives in ytInitialPlayerResponse.
 *   2. JSON-LD `@type: Recipe` when present — authoritative, structured.
 *   3. OpenGraph / Twitter meta for the hero image.
 *   4. Stripped HTML as a last resort.
 *
 * Failures throw a plain `Error` with a message written for the user. The
 * former `NonRetriableError` from Inngest is not needed: the one caller is
 * wrapped by `app/api/internal/ingestion/process-url/route.ts`, which catches,
 * marks the job failed with this message, and does not retry.
 */
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
    throw new Error(
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
    throw new Error(
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
    throw new Error(
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

