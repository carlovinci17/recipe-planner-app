"use client";

import { useCallback, useState, useTransition } from "react";
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import { cropAndSaveCoverAction } from "../actions";

function centerAspectCrop(mediaWidth: number, mediaHeight: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 80 }, 4 / 3, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight,
  );
}

export function CropTool({
  recipeId,
  sourcePath,
  onSaved,
}: {
  recipeId: string;
  sourcePath: string;
  /** Called with the new cover path after a successful crop save. */
  onSaved?: (newPath: string) => void;
}) {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [saving, startSave] = useTransition();

  const signedUrl = useSignedImage(sourcePath, "recipe-uploads", { width: 1200 });

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    setNaturalSize({ w, h });
    setCrop(centerAspectCrop(w, h));
  }, []);

  function reset() {
    if (!naturalSize) return;
    setCrop(centerAspectCrop(naturalSize.w, naturalSize.h));
    setCompletedCrop(undefined);
  }

  function handleSave() {
    if (!completedCrop || !naturalSize) {
      toast.error("Draw a crop selection first.");
      return;
    }
    // Convert pixel crop on the displayed image to % of natural image size.
    // completedCrop is in pixels relative to the *rendered* img element —
    // we need to scale to natural dimensions.
    const el = document.querySelector<HTMLImageElement>("[data-crop-image]");
    const scaleX = el ? naturalSize.w / el.width : 1;
    const scaleY = el ? naturalSize.h / el.height : 1;

    const cropX = ((completedCrop.x * scaleX) / naturalSize.w) * 100;
    const cropY = ((completedCrop.y * scaleY) / naturalSize.h) * 100;
    const cropWidth = ((completedCrop.width * scaleX) / naturalSize.w) * 100;
    const cropHeight = ((completedCrop.height * scaleY) / naturalSize.h) * 100;

    startSave(async () => {
      const result = await cropAndSaveCoverAction({
        recipeId,
        sourcePath,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Crop failed");
        return;
      }
      toast.success("Cover cropped and saved");
      onSaved?.(result.croppedPath);
    });
  }

  if (!signedUrl) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md bg-muted">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Drag to select the area to use as the cover image. The selection defaults to 4:3
        — drag any handle to resize freely.
      </p>

      <div className="overflow-auto rounded-md border bg-muted/30">
        <ReactCrop
          crop={crop}
          onChange={(c) => setCrop(c)}
          onComplete={(c) => setCompletedCrop(c)}
          className="max-h-[480px]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={signedUrl}
            alt="Source page"
            onLoad={onImageLoad}
            data-crop-image
            className="max-w-full"
          />
        </ReactCrop>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={saving}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Reset
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={saving || !completedCrop}>
          {saving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-3.5 w-3.5" />
          )}
          Crop &amp; save cover
        </Button>
      </div>
    </div>
  );
}
