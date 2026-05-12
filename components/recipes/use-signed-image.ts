"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const cache = new Map<string, { url: string; expiresAt: number }>();

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

  return url;
}
