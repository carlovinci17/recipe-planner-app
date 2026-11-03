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

/** The image route URL for `path` with these options. Pure — no fetch. */
export function signedImageUrl(
  path: string,
  bucket: "recipe-uploads" | "recipe-images",
  options?: SignedImageOptions,
): string {
  const qs = new URLSearchParams();
  if (options?.width) qs.set("w", String(options.width));
  if (options?.height) qs.set("h", String(options.height));
  if (options?.quality) qs.set("q", String(options.quality));
  // Only worth sending when it differs from the route's default.
  if (options?.resize && options.resize !== "cover") qs.set("fit", options.resize);
  const query = qs.toString();
  // Blob paths already begin with the household id, which the route
  // re-checks against the caller's memberships before serving anything.
  return `/api/images/${bucket}/${path}${query ? `?${query}` : ""}`;
}

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

  return useMemo(
    () => (path ? signedImageUrl(path, bucket, { width, height, quality, resize }) : null),
    [path, bucket, width, height, quality, resize],
  );
}

/**
 * The same image at several widths, for `<img srcSet sizes>`: the browser picks
 * the smallest one that is still sharp for the slot on that screen (a phone gets
 * a small file, a large or high-density screen a big one). `src` is the middle
 * width, for browsers that ignore srcSet.
 */
export function useSignedImageSet(
  path: string | null,
  bucket: "recipe-uploads" | "recipe-images",
  widths: readonly number[],
  options?: Omit<SignedImageOptions, "width" | "height">,
): { src: string; srcSet: string } | null {
  const quality = options?.quality;
  const resize = options?.resize;
  const key = widths.join(",");
  return useMemo(() => {
    if (!path || widths.length === 0) return null;
    const url = (w: number) => signedImageUrl(path, bucket, { width: w, quality, resize });
    return {
      src: url(widths[Math.floor(widths.length / 2)]!),
      srcSet: widths.map((w) => `${url(w)} ${w}w`).join(", "),
    };
    // `key` stands in for `widths`, which callers pass as a fresh array literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, bucket, key, quality, resize]);
}
