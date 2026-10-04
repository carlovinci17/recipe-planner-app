"use client";

import { useMemo } from "react";

/**
 * Resolve a stored image path to a URL the browser can load.
 *
 * Images live in Azure Blob Storage, which this app accesses keylessly via
 * managed identity — so there is no public or pre-signed blob URL to hand the
 * browser. Instead `/api/images/<container>/<path>` serves them: it checks the
 * caller's household membership against the path prefix, then streams the blob,
 * resizing with sharp on demand.
 *
 * That makes the URL a pure function of its inputs, so this hook is a plain
 * derivation with no effect, no network round-trip and no cache. It replaces a
 * Supabase Storage version that had to call `createSignedUrl` on mount and keep
 * a module-level expiry cache — all of which the authorized route makes
 * unnecessary.
 *
 * The name is kept because roughly a dozen components call it, and "signed" is
 * still a fair description of what the URL buys you: access to a private
 * object, authorized per request.
 */

/**
 * Transform options. Omit them entirely for the original asset (lightbox and
 * fullscreen views); pass a width so cards and thumbnails don't download a
 * 4000px PDF raster to display at 64px.
 *
 * `quality` defaults to 75 server-side. `resize` maps to sharp's fit mode and
 * defaults to "cover" — a filled box rather than letterboxing.
 */
export type SignedImageOptions = {
  width?: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain" | "fill";
};

export function useSignedImage(
  path: string | null,
  bucket: "recipe-uploads" | "recipe-images" = "recipe-uploads",
  options?: SignedImageOptions,
): string | null {
  // Destructured to primitives: using `options` as a dependency would rebuild
  // the URL on every render, because callers pass an object literal.
  const width = options?.width;
  const height = options?.height;
  const quality = options?.quality;
  const resize = options?.resize;

  return useMemo(() => {
    if (!path) return null;
    const qs = new URLSearchParams();
    if (width) qs.set("w", String(width));
    if (height) qs.set("h", String(height));
    if (quality) qs.set("q", String(quality));
    // Only worth sending when it differs from the route's default.
    if (resize && resize !== "cover") qs.set("fit", resize);
    const query = qs.toString();
    // Blob paths already begin with the household id, which the route
    // re-checks against the caller's memberships before serving anything.
    return `/api/images/${bucket}/${path}${query ? `?${query}` : ""}`;
  }, [path, bucket, width, height, quality, resize]);
}
