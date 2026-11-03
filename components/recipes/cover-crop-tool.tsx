"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import ReactCrop, {
  type Crop,
  type PercentCrop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import type { CoverImageRef } from "@/lib/recipes/cover-image";
import { cropRecipeCoverAction } from "@/app/(app)/recipes/[id]/actions";

/** Box shapes on offer. `null` = Free: any edge or corner resizes to any shape. */
const SHAPES: { label: string; aspect: number | null }[] = [
  { label: "Free", aspect: null },
  { label: "Card 4:3", aspect: 4 / 3 },
  { label: "Square", aspect: 1 },
  { label: "Wide 16:9", aspect: 16 / 9 },
];

/**
 * The box a crop starts with: Free covers most of the image in its own shape;
 * a fixed shape is the largest centred box of that shape.
 */
function startingCrop(width: number, height: number, aspect: number | null): Crop {
  if (aspect === null) return { unit: "%", x: 5, y: 5, width: 90, height: 90 };
  return centerCrop(makeAspectCrop({ unit: "%", width: 90 }, aspect, width, height), width, height);
}

/**
 * Saves an unsaved crop; resolves false if it failed (an error is shown). Handed
 * to the surrounding form so its own Save button saves the crop too.
 */
export type PendingCropSave = () => Promise<boolean>;

/**
 * Drag a box over one of the recipe's images and save it as the new cover.
 * The selection travels as percentages, so it doesn't matter that the image
 * shown here is a resized copy: the server crops the full-size original.
 */
export function CoverCropTool({
  recipeId,
  source,
  onSaved,
  onCancel,
  registerPendingSave,
}: {
  recipeId: string;
  source: CoverImageRef;
  onSaved: () => void;
  onCancel: () => void;
  /**
   * Called with a save function while this crop is open (and with null when it
   * closes), so pressing the recipe's Save also saves the crop. Without it, a
   * crop only saved through "Save as cover" — and was lost when the user
   * pressed the form's Save instead.
   */
  registerPendingSave?: (save: PendingCropSave | null) => void;
}) {
  const [crop, setCrop] = useState<Crop>();
  const [percent, setPercent] = useState<PercentCrop>();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [saving, startSave] = useTransition();
  const url = useSignedImage(source.path, source.bucket, { width: 1600, resize: "contain" });

  function startBox(w: number, h: number, nextAspect: number | null) {
    const c = startingCrop(w, h, nextAspect);
    setCrop(c);
    setPercent(c as PercentCrop);
  }

  function chooseShape(nextAspect: number | null) {
    setAspect(nextAspect);
    if (size) startBox(size.w, size.h, nextAspect);
  }

  function reset() {
    if (size) startBox(size.w, size.h, aspect);
  }

  // The latest selection, for the save function the form holds on to.
  const percentRef = useRef(percent);
  percentRef.current = percent;

  async function saveCrop(): Promise<boolean> {
    const p = percentRef.current;
    if (!p || p.width < 1 || p.height < 1) {
      toast.error("Drag a box over the part you want as the cover.");
      return false;
    }
    const result = await cropRecipeCoverAction({
      recipeId,
      source,
      crop: { x: p.x, y: p.y, width: p.width, height: p.height },
    });
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't save the crop");
      return false;
    }
    toast.success("New cover saved. The original image is still on the recipe.");
    onSaved();
    return true;
  }

  // While open, let the form's Save button save this crop too.
  const saveCropRef = useRef(saveCrop);
  saveCropRef.current = saveCrop;
  useEffect(() => {
    registerPendingSave?.(() => saveCropRef.current());
    return () => registerPendingSave?.(null);
  }, [registerPendingSave]);

  function save() {
    startSave(async () => {
      await saveCrop();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Drag the box over the food, and drag its edges or corners to resize it. Free lets the box be
        any shape; pick a shape to keep it to that shape. Press Save as cover, or just save the
        recipe — the crop is saved with it.
      </p>
      <div role="radiogroup" aria-label="Crop shape" className="flex flex-wrap gap-1">
        {SHAPES.map((shape) => (
          <Button
            key={shape.label}
            type="button"
            role="radio"
            aria-checked={aspect === shape.aspect}
            size="sm"
            variant={aspect === shape.aspect ? "secondary" : "outline"}
            className="h-7 px-2.5 text-xs"
            onClick={() => chooseShape(shape.aspect)}
            disabled={saving}
          >
            {shape.label}
          </Button>
        ))}
      </div>
      <div className="flex justify-center overflow-hidden rounded-md border bg-muted/30">
        {url ? (
          <ReactCrop
            crop={crop}
            onChange={(c, pc) => {
              setCrop(c);
              setPercent(pc);
            }}
            aspect={aspect ?? undefined}
            keepSelection
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="Image to crop"
              className="max-h-[60vh] w-auto max-w-full"
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                setSize({ w, h });
                startBox(w, h, aspect);
              }}
            />
          </ReactCrop>
        ) : (
          <div className="flex h-40 w-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={saving || !size}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Reset
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={saving || !percent}>
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save as cover
          </Button>
        </div>
      </div>
    </div>
  );
}
