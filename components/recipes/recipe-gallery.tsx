"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import { cn } from "@/lib/utils";

/**
 * Recipe gallery — hero + thumbnail strip + lightbox.
 *
 * UX pattern adopted from Amazon / Airbnb / eBay: a single dominant image up
 * top, smaller thumbnails below for quick swap, fullscreen lightbox for
 * detail. Single-image recipes render exactly the previous CoverImage.
 *
 * Image sources are merged from two buckets:
 *   - `image_paths` (recipe-images, user uploads) — first wins as hero
 *   - `cover_image_path` (recipe-uploads, AI source) — appended last
 */
export type RecipeGalleryItem = {
  path: string;
  bucket: "recipe-images" | "recipe-uploads";
  caption?: string;
};

export function RecipeGallery({
  recipe,
  title,
  heroOverlay,
}: {
  recipe: {
    image_paths: string[] | null;
    cover_image_path: string | null;
    cover_focal_x?: number | null;
    cover_focal_y?: number | null;
  };
  title: string;
  /**
   * Optional element rendered absolutely on top-right of the hero image.
   * Pointer-events stay enabled so a pill can still be clicked as a link.
   */
  heroOverlay?: React.ReactNode;
}) {
  const items = useMemo<RecipeGalleryItem[]>(() => {
    const userImages = recipe.image_paths ?? [];
    const cover = recipe.cover_image_path;
    const seen = new Set<string>();
    const list: RecipeGalleryItem[] = [];
    for (const p of userImages) {
      if (!p || seen.has(p)) continue;
      // Skip user-images entries that collide with the cover path. The
      // cover entry below carries the correct bucket (recipe-uploads),
      // and `image_paths` claims the recipe-images bucket — keeping both
      // would duplicate the React key and load the wrong bucket for one
      // of them. Past versions of the import pipeline seeded image_paths
      // with the page-image path, which is exactly the collision case.
      if (cover && p === cover) continue;
      seen.add(p);
      list.push({ path: p, bucket: "recipe-images" });
    }
    if (cover && !seen.has(cover)) {
      list.push({ path: cover, bucket: "recipe-uploads" });
    }
    return list;
  }, [recipe.image_paths, recipe.cover_image_path]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Clamp the index whenever items change (e.g., a user deletes an image).
  useEffect(() => {
    if (currentIndex >= items.length && items.length > 0) {
      setCurrentIndex(0);
    }
  }, [items.length, currentIndex]);

  if (items.length === 0) return null;

  const current = items[currentIndex]!;

  // Focal point only applies when the displayed hero is the recipe's
  // designated cover_image_path. Other images in the gallery (user uploads,
  // additional source pages) keep the default center crop.
  const heroFocalStyle =
    current.path === recipe.cover_image_path
      ? { objectPosition: `${recipe.cover_focal_x ?? 50}% ${recipe.cover_focal_y ?? 50}%` }
      : undefined;

  return (
    <div className="space-y-3">
      <div className="relative">
        <GalleryHero
          item={current}
          title={title}
          showExpandHint={items.length > 0}
          focalStyle={heroFocalStyle}
          onClick={() => setLightboxOpen(true)}
        />
        {heroOverlay ? (
          <div className="pointer-events-none absolute right-3 top-3 z-10">
            <div className="pointer-events-auto">{heroOverlay}</div>
          </div>
        ) : null}
      </div>

      {items.length > 1 ? (
        <ThumbnailStrip
          items={items}
          currentIndex={currentIndex}
          onSelect={setCurrentIndex}
          onZoom={(idx) => {
            setCurrentIndex(idx);
            setLightboxOpen(true);
          }}
        />
      ) : null}

      {lightboxOpen ? (
        <Lightbox
          items={items}
          startIndex={currentIndex}
          title={title}
          onClose={() => setLightboxOpen(false)}
          onIndexChange={setCurrentIndex}
        />
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Hero
// ──────────────────────────────────────────────────────────────────
function GalleryHero({
  item,
  title,
  showExpandHint,
  focalStyle,
  onClick,
}: {
  item: RecipeGalleryItem;
  title: string;
  showExpandHint: boolean;
  focalStyle?: React.CSSProperties;
  onClick: () => void;
}) {
  // Hero is 16:9 inside a container that can hit ~900px wide; 1600
  // covers retina without serving the original raster every page load.
  const url = useSignedImage(item.path, item.bucket, {
    width: 1600,
    resize: "cover",
    quality: 80,
  });
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Open image in fullscreen"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={title}
          style={focalStyle}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : null}
      {showExpandHint ? (
        <div className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-4 w-4" />
        </div>
      ) : null}
      {item.caption ? (
        <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs text-white">
          {item.caption}
        </div>
      ) : null}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────
// Thumbnail strip
// ──────────────────────────────────────────────────────────────────
function ThumbnailStrip({
  items,
  currentIndex,
  onSelect,
  onZoom,
}: {
  items: RecipeGalleryItem[];
  currentIndex: number;
  onSelect: (idx: number) => void;
  onZoom: (idx: number) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="flex gap-2">
        {items.map((item, idx) => (
          <Thumbnail
            key={item.path}
            item={item}
            isActive={idx === currentIndex}
            onClick={() => onSelect(idx)}
            onDoubleClick={() => onZoom(idx)}
            label={`Image ${idx + 1} of ${items.length}`}
          />
        ))}
      </div>
    </div>
  );
}

function Thumbnail({
  item,
  isActive,
  onClick,
  onDoubleClick,
  label,
}: {
  item: RecipeGalleryItem;
  isActive: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  label: string;
}) {
  // Thumb strip cells are 64px square; 192 covers 3× DPI.
  const url = useSignedImage(item.path, item.bucket, {
    width: 192,
    height: 192,
    resize: "cover",
    quality: 70,
  });
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-label={label}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "relative h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 bg-muted transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "border-primary ring-2 ring-primary/20"
          : "border-transparent opacity-70 hover:opacity-100",
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : null}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────
// Lightbox (fullscreen modal)
// ──────────────────────────────────────────────────────────────────
function Lightbox({
  items,
  startIndex,
  title,
  onClose,
  onIndexChange,
}: {
  items: RecipeGalleryItem[];
  startIndex: number;
  title: string;
  onClose: () => void;
  onIndexChange: (idx: number) => void;
}) {
  const [index, setIndex] = useState(startIndex);

  // Keep the parent's hero in sync so closing the lightbox lands the user on
  // whichever image they were viewing.
  useEffect(() => {
    onIndexChange(index);
  }, [index, onIndexChange]);

  const prev = useCallback(
    () => setIndex((i) => (i - 1 + items.length) % items.length),
    [items.length],
  );
  const next = useCallback(
    () => setIndex((i) => (i + 1) % items.length),
    [items.length],
  );

  // Keyboard navigation: ← / → to navigate, Esc to close.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, prev, next]);

  // Lock body scroll while open so background scroll doesn't bleed through.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const current = items[index]!;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — image gallery`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
        aria-label="Close (Esc)"
      >
        <X className="h-5 w-5" />
      </button>

      {items.length > 1 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
          aria-label="Previous image"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      ) : null}

      {items.length > 1 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
          aria-label="Next image"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      ) : null}

      <LightboxImage item={current} title={title} />

      {items.length > 1 ? (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
          {index + 1} / {items.length}
          {current.caption ? <span className="ml-2 opacity-70">· {current.caption}</span> : null}
        </div>
      ) : current.caption ? (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
          {current.caption}
        </div>
      ) : null}
    </div>
  );
}

function LightboxImage({ item, title }: { item: RecipeGalleryItem; title: string }) {
  // Lightbox is fullscreen; cap at 2400px wide. Visually indistinguishable
  // from the original on any consumer display, but a fraction of the bytes
  // when the source is a 4000px PDF raster.
  const url = useSignedImage(item.path, item.bucket, {
    width: 2400,
    resize: "contain",
    quality: 90,
  });
  return (
    <div
      className="relative flex h-full max-h-[90vh] w-full max-w-[90vw] items-center justify-center"
      onClick={(e) => e.stopPropagation()}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={title}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      ) : (
        <div className="text-white/60">Loading...</div>
      )}
    </div>
  );
}
