"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Move, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import { setRecipeCoverFocalAction } from "../actions";

/**
 * Click-anywhere focal point picker for a recipe's cover image.
 *
 * UX:
 *   - The source image renders at its natural aspect ratio (no crop) so
 *     the user sees the whole page they're picking a focal point on.
 *   - Click moves the marker (and commits via server action). The marker
 *     is a thin white-bordered crosshair so it's visible against any
 *     background — light or dark page.
 *   - A right-side preview shows what the 4:3 card thumbnail looks like
 *     with the current focal point, so the user can see the actual
 *     framing effect without leaving the picker.
 *   - "Reset to center" reverts to 50/50 (the historical default).
 *
 * The picker stays inert if there's no cover image yet (single-image
 * imports waiting for upload, etc.) — callers can skip rendering it.
 */
export function FocalPointPicker({
  recipeId,
  coverPath,
  coverBucket,
  initialFocalX,
  initialFocalY,
}: {
  recipeId: string;
  coverPath: string;
  coverBucket: "recipe-uploads" | "recipe-images";
  initialFocalX: number;
  initialFocalY: number;
}) {
  const [x, setX] = useState(initialFocalX);
  const [y, setY] = useState(initialFocalY);
  const [pending, start] = useTransition();
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Keep state in sync if the cover path changes underneath us (e.g. user
  // picked a different source page in the same review session).
  useEffect(() => {
    setX(initialFocalX);
    setY(initialFocalY);
  }, [coverPath, initialFocalX, initialFocalY]);

  // Full-resolution preview — no resize transform; the natural-size image
  // lets the user click precisely. Browser caches it for the lifetime of
  // the page so subsequent clicks don't re-fetch.
  const fullUrl = useSignedImage(coverPath, coverBucket, {
    width: 1000,
    resize: "contain",
    quality: 80,
  });
  // The smaller side-by-side preview reuses transforms — same display
  // size as a real card thumbnail so the user gets honest WYSIWYG.
  const previewUrl = useSignedImage(coverPath, coverBucket, {
    width: 640,
    resize: "contain",
    quality: 80,
  });

  function commit(nextX: number, nextY: number) {
    setX(nextX);
    setY(nextY);
    start(async () => {
      const result = await setRecipeCoverFocalAction({
        recipeId,
        focalX: nextX,
        focalY: nextY,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't save framing");
      }
    });
  }

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const nx = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const ny = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    commit(clamp(nx), clamp(ny));
  }

  function reset() {
    commit(50, 50);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2 text-xs">
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Move className="h-3.5 w-3.5" />
          Click the image to set the focal point — card thumbnails will keep
          this spot in view.
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={reset}
          disabled={pending || (x === 50 && y === 50)}
          className="h-7 text-xs"
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          Reset
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[3fr_2fr]">
        {/* Click target — full page render with focal marker */}
        <div className="relative overflow-hidden rounded-md border bg-muted">
          {fullUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={fullUrl}
              alt="Source page"
              onClick={handleImageClick}
              className="block max-h-[480px] w-full cursor-crosshair select-none object-contain"
              draggable={false}
            />
          ) : (
            <div className="flex aspect-[3/4] w-full items-center justify-center text-xs text-muted-foreground">
              Loading source…
            </div>
          )}
          {fullUrl ? (
            <div
              className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-2 ring-primary"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                background: "rgba(var(--primary) / 0.85)",
              }}
              aria-hidden
            >
              <div className="absolute inset-1.5 rounded-full bg-primary" />
            </div>
          ) : null}
        </div>

        {/* WYSIWYG preview — same aspect ratio as a recipe card thumb */}
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Card preview
          </div>
          <div className="aspect-[4/3] overflow-hidden rounded-md border bg-muted">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt=""
                className="h-full w-full object-cover"
                style={{ objectPosition: `${x}% ${y}%` }}
              />
            ) : null}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Focal: {x}% × {y}%
          </div>
        </div>
      </div>
    </div>
  );
}

function clamp(v: number): number {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}
