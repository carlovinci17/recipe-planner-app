"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { useSignedImage, useSignedImageSet } from "@/components/recipes/use-signed-image";

/** Widths offered for the recipe page's main image and the fullscreen view. */
const HERO_WIDTHS = [640, 960, 1280, 1600, 2000] as const;
const LIGHTBOX_WIDTHS = [960, 1600, 2400] as const;
import { cn } from "@/lib/utils";
import { listRecipeImages } from "@/lib/recipes/cover-image";
import {
  clampZoom,
  NO_ZOOM,
  TAP_ZOOM,
  zoomAbout,
  type Point,
  type ZoomState,
} from "@/lib/recipes/zoom";

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
  // Photos first (the first is the cover), then the kept import page — the same
  // order the cover editor uses (listRecipeImages).
  const items = useMemo<RecipeGalleryItem[]>(
    () => listRecipeImages(recipe),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the image fields matter
    [recipe.image_paths, recipe.cover_image_path],
  );

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
  // Hero is 16:9 in a container up to 56rem (~900px) wide. The browser picks
  // a width for the screen: ~640–960 on a phone, up to 2000 on a high-density
  // desktop, instead of everyone getting 1600.
  const img = useSignedImageSet(item.path, item.bucket, HERO_WIDTHS, { quality: 80 });
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Open image in fullscreen"
    >
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img.src}
          srcSet={img.srcSet}
          sizes="(min-width: 56rem) 56rem, 100vw"
          alt={title}
          style={focalStyle}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : null}
      {showExpandHint ? (
        // Bottom-right, not top-right: the top-right corner belongs to
        // `heroOverlay` (the source pill), and a touch device that latches
        // :hover left this dark circle sitting behind the pill.
        <div className="absolute bottom-3 right-3 rounded-full bg-black/50 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100">
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

      {/* Keyed by image so zoom resets when moving to another one. */}
      <LightboxImage
        key={current.path}
        item={current}
        title={title}
        onSwipe={items.length > 1 ? (dir) => (dir === "next" ? next() : prev()) : undefined}
      />

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

/** A swipe this long (px) with one finger at 1× moves to the next/previous image. */
const SWIPE_PX = 50;
/** Two taps this close together (ms) are a double-tap. */
const DOUBLE_TAP_MS = 300;

/**
 * The fullscreen image, with touch gestures. The app turns off the browser's
 * own pinch-zoom (viewport `userScalable: false`, app/layout.tsx), so zoom is
 * done here and only here:
 *   - pinch with two fingers to zoom (1×–4×), centred between the fingers
 *   - drag with one finger to look around while zoomed
 *   - double-tap to zoom in on that spot, and again to zoom back out
 *   - swipe left/right at 1× for the next/previous image
 * Pointer events cover touch, pen and mouse alike; `touch-action: none` stops
 * the browser treating these gestures as page scrolling.
 */
function LightboxImage({
  item,
  title,
  onSwipe,
}: {
  item: RecipeGalleryItem;
  title: string;
  onSwipe?: (dir: "next" | "prev") => void;
}) {
  // Fullscreen, up to 90% of the screen; capped at 2400px wide, which is
  // indistinguishable from the original on any consumer display. Phones pick
  // a smaller width.
  const img = useSignedImageSet(item.path, item.bucket, LIGHTBOX_WIDTHS, {
    quality: 90,
    resize: "contain",
  });

  const [zoom, setZoom] = useState<ZoomState>(NO_ZOOM);
  const [gesturing, setGesturing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Fingers currently down, by pointer id, in page coordinates.
  const pointers = useRef(new Map<number, Point>());
  // The state when the current gesture (or its latest phase) began.
  // `pinched`: two fingers were down at some point, so it is never a tap or swipe.
  const gesture = useRef<{
    zoom: ZoomState;
    mid: Point;
    dist: number;
    moved: boolean;
    pinched: boolean;
  } | null>(null);
  const lastTap = useRef(0);

  /** A page point, measured from the image's centre (the zoom maths' frame). */
  function local(p: Point): Point {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return p;
    return { x: p.x - (r.left + r.width / 2), y: p.y - (r.top + r.height / 2) };
  }
  function imageSize() {
    // Layout size, which the CSS transform doesn't change: the size at 1×.
    return { width: imgRef.current?.offsetWidth ?? 0, height: imgRef.current?.offsetHeight ?? 0 };
  }
  /** Start (or restart, when a finger is added or lifted) the gesture from now. */
  function beginPhase(current: ZoomState) {
    const pts = [...pointers.current.values()];
    const mid = pts.length >= 2 ? midpoint(pts[0]!, pts[1]!) : pts[0]!;
    gesture.current = {
      zoom: current,
      mid: local(mid),
      dist: pts.length >= 2 ? distance(pts[0]!, pts[1]!) : 0,
      moved: gesture.current?.moved ?? false,
      pinched: (gesture.current?.pinched ?? false) || pts.length >= 2,
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = null;
    setGesturing(true);
    beginPhase(zoom);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const scale = g.zoom.scale * (distance(pts[0]!, pts[1]!) / (g.dist || 1));
      const next = zoomAbout(g.zoom, g.mid, local(midpoint(pts[0]!, pts[1]!)), scale);
      g.moved = true;
      setZoom(clampZoom(next, imageSize()));
    } else if (g.zoom.scale > 1) {
      // One finger while zoomed: move the picture with it.
      const now = local(pts[0]!);
      g.moved = g.moved || Math.hypot(now.x - g.mid.x, now.y - g.mid.y) > 5;
      setZoom(
        clampZoom(
          { scale: g.zoom.scale, x: g.zoom.x + now.x - g.mid.x, y: g.zoom.y + now.y - g.mid.y },
          imageSize(),
        ),
      );
    } else {
      const now = local(pts[0]!);
      g.moved = g.moved || Math.hypot(now.x - g.mid.x, now.y - g.mid.y) > 5;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const start = pointers.current.get(e.pointerId);
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // One of two fingers lifted: carry on from here with the other one.
      beginPhase(zoom);
      return;
    }
    setGesturing(false);
    if (!g || !start || g.pinched) return;
    const end = local({ x: e.clientX, y: e.clientY });
    const dx = end.x - g.mid.x;
    const dy = end.y - g.mid.y;

    // Swipe: one finger, not zoomed, mostly sideways.
    if (onSwipe && g.zoom.scale === 1 && zoom.scale === 1 && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      onSwipe(dx < 0 ? "next" : "prev");
      return;
    }
    // Double-tap: toggle between 1× and a zoom on the tapped spot.
    if (!g.moved) {
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        setZoom(
          zoom.scale > 1
            ? NO_ZOOM
            : clampZoom(zoomAbout(NO_ZOOM, end, end, TAP_ZOOM), imageSize()),
        );
      } else {
        lastTap.current = now;
      }
    }
  }

  return (
    <div
      ref={boxRef}
      className="relative flex h-full max-h-[90vh] w-full max-w-[90vw] touch-none select-none items-center justify-center"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={img.src}
          srcSet={img.srcSet}
          sizes="90vw"
          alt={title}
          draggable={false}
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            // Smooth only for jumps (double-tap); follow the fingers exactly.
            transition: gesturing ? "none" : "transform 200ms ease-out",
          }}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      ) : (
        <div className="text-white/60">Loading...</div>
      )}
    </div>
  );
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
