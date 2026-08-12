"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const cache = new Map<string, { url: string; expiresAt: number }>();

// Which storage stack the browser is talking to. Mirrors the server's
// STORAGE_PROVIDER (NEXT_PUBLIC_ so it's inlined for the client). When "azure",
// images are served by the authorized /api/images route — a deterministic URL,
// so there's no browser-side signing round-trip. Anything else keeps the
// original Supabase client-signed path.
const USE_AZURE = process.env.NEXT_PUBLIC_STORAGE_PROVIDER === "azure";

/** Build the authorized image-route URL. Blob paths already start with the
 * householdId, which the route re-checks against the caller's memberships. */
function azureImageUrl(
  bucket: string,
  path: string,
  o?: { width?: number; height?: number; quality?: number },
): string {
  const qs = new URLSearchParams();
  if (o?.width) qs.set("w", String(o.width));
  if (o?.height) qs.set("h", String(o.height));
  if (o?.quality) qs.set("q", String(o.quality));
  const query = qs.toString();
  return `/api/images/${bucket}/${path}${query ? `?${query}` : ""}`;
}

/**
 * Optional Supabase Storage transform params. Asking for any of these
 * yields a server-side resized/recompressed image that's CDN-cached, so
 * cards/thumbnails don't have to download 4000px PDF rasters at 800kB
 * each. Omit entirely (or pass `undefined`) for the original asset
 * (lightbox / fullscreen view).
 *
 * `quality` defaults to 75 when transformations are requested but no
 * quality value is supplied — a sane balance between size and sharpness.
 */
export type SignedImageOptions = {
  width?: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain" | "fill";
};

/**
 * Sign a Supabase Storage path and cache the result client-side. Cache key
 * includes bucket + transform options so the same path requested against
 * different buckets or at different sizes doesn't collide.
 */
export function useSignedImage(
  path: string | null,
  bucket: "recipe-uploads" | "recipe-images" = "recipe-uploads",
  options?: SignedImageOptions,
): string | null {
  // Stable primitive deps — using `options` directly as a dep would
  // re-fire the effect every render when callers pass an object literal.
  const w = options?.width;
  const h = options?.height;
  const q = options?.quality;
  const r = options?.resize;
  const hasTransform = w !== undefined || h !== undefined || q !== undefined || r !== undefined;

  // Azure: the route URL is deterministic, so resolve it synchronously and
  // skip the signing effect entirely.
  const azureUrl = useMemo(() => {
    if (!USE_AZURE || !path) return null;
    return azureImageUrl(bucket, path, { width: w, height: h, quality: q });
  }, [path, bucket, w, h, q]);

  const cacheKey = useMemo(() => {
    if (!path) return null;
    return `${bucket}|${w ?? "_"}|${h ?? "_"}|${q ?? "_"}|${r ?? "_"}|${path}`;
  }, [bucket, w, h, q, r, path]);

  const [url, setUrl] = useState<string | null>(() => {
    if (!cacheKey) return null;
    const cached = cache.get(cacheKey);
    return cached && cached.expiresAt > Date.now() ? cached.url : null;
  });

  useEffect(() => {
    if (USE_AZURE) return; // Azure path resolves synchronously above.
    if (!cacheKey || !path) {
      setUrl(null);
      return;
    }
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setUrl(cached.url);
      return;
    }

    let cancelled = false;
    const supabase = createClient();
    supabase.storage
      .from(bucket)
      .createSignedUrl(
        path,
        3600,
        hasTransform
          ? {
              transform: {
                width: w,
                height: h,
                quality: q ?? 75,
                resize: r,
              },
            }
          : undefined,
      )
      .then(({ data }) => {
        if (cancelled || !data?.signedUrl) return;
        cache.set(cacheKey, { url: data.signedUrl, expiresAt: Date.now() + 3500 * 1000 });
        setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, path, bucket, w, h, q, r, hasTransform]);

  return USE_AZURE ? azureUrl : url;
}
