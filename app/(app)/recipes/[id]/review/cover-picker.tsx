"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, Check, Crop, Image as ImageIcon, Scissors } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import { cn } from "@/lib/utils";
import { setRecipeSourcePageCoverAction } from "../actions";
import { FocalPointPicker } from "./focal-point-picker";
import { CropTool } from "./crop-tool";

type CoverStep = "select" | "crop" | "focus";

/**
 * The actual thumbnail-grid UI. Extracted so it can be reused outside the
 * inline `<details>` disclosure on the review page — specifically by the
 * dialog wrapper exported from cover-picker-dialog.tsx that the Recent
 * imports rows use.
 *
 * `onPicked` fires after a successful server update — caller can use it to
 * close a modal or update local state. Internal to this component the
 * thumbnail click already does optimistic local + toast feedback.
 */
export function CoverPickerGrid({
  recipeId,
  currentCoverPath,
  sourcePages,
  hasUserUploads,
  initialFocalX = 50,
  initialFocalY = 50,
  onPicked,
}: {
  recipeId: string;
  currentCoverPath: string | null;
  sourcePages: string[];
  hasUserUploads: boolean;
  initialFocalX?: number;
  initialFocalY?: number;
  onPicked?: (path: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(currentCoverPath);
  const [pending, start] = useTransition();
  // Two-step wizard. Step 1 is "pick an image"; Step 2 is "nudge framing".
  // Picking a thumbnail (or re-tapping the already-selected one) advances
  // to step 2; the back button on step 2 returns to the grid. We start on
  // "select" even when there's already a cover so the user can re-pick
  // freely; advancing requires an explicit click.
  const [step, setStep] = useState<CoverStep>("select");

  // Re-sync the local selection if the parent's currentCoverPath changes
  // out from under us (e.g. another tab updated the recipe). Without this
  // the slider could land on stale focal coords.
  useEffect(() => {
    setSelected(currentCoverPath);
  }, [currentCoverPath]);

  if (sourcePages.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/40 px-4 py-6 text-center text-xs text-muted-foreground">
        No source pages saved for this recipe.
      </div>
    );
  }

  function pick(path: string) {
    if (pending) return;
    // Re-tap on the already-selected thumb is a no-op for the server but
    // still advances the wizard — that's the natural way to revisit the
    // focal step without changing the underlying page.
    if (path === selected) {
      setStep("focus");
      return;
    }
    const previous = selected;
    setSelected(path);
    start(async () => {
      const result = await setRecipeSourcePageCoverAction({ recipeId, sourcePath: path });
      if (!result.ok) {
        setSelected(previous);
        toast.error(result.error ?? "Couldn't set cover");
        return;
      }
      toast.success("Cover updated");
      onPicked?.(path);
      setStep("focus");
    });
  }

  const selectedIndex = selected ? sourcePages.indexOf(selected) : -1;
  const selectedLabel = selectedIndex >= 0 ? `Page ${selectedIndex + 1}` : null;

  return (
    <div className="space-y-3">
      {/* Step indicator — two dots so the user knows there's a second step
          even before they've picked an image. Click-to-jump on the focus
          dot, but only when a selection exists (you can't focus nothing). */}
      <StepBar
        step={step}
        canAdvance={selected !== null}
        onStep={(next) => {
          if ((next === "crop" || next === "focus") && selected === null) return;
          setStep(next);
        }}
      />

      {/* Horizontal slider — three equal panels, translate by 0 / -33% / -66% */}
      <div className="overflow-hidden">
        <div
          className={cn(
            "flex w-[300%] transition-transform duration-300 ease-out",
            step === "select" && "translate-x-0",
            step === "crop"   && "-translate-x-1/3",
            step === "focus"  && "-translate-x-2/3",
          )}
        >
          {/* Step 1 — page thumbnail grid */}
          <div className="w-1/3 shrink-0 pr-2">
            <div className="space-y-3">
              {hasUserUploads ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                  You have uploaded photos — those take priority over source pages.
                  Remove them in the uploader if you want a source page to show instead.
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {sourcePages.map((path, i) => (
                  <ThumbButton
                    key={path}
                    path={path}
                    label={`Page ${i + 1}`}
                    isSelected={path === selected}
                    disabled={pending}
                    onClick={() => pick(path)}
                  />
                ))}
              </div>
              {selected ? (
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setStep("crop")}
                    disabled={pending}
                  >
                    <Scissors className="mr-1.5 h-3.5 w-3.5" />
                    Crop image
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={() => setStep("focus")}
                    disabled={pending}
                  >
                    <Crop className="mr-1.5 h-3.5 w-3.5" />
                    Adjust framing
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Pick a page to crop or adjust framing.
                </p>
              )}
            </div>
          </div>

          {/* Step 2 — crop tool */}
          <div className="w-1/3 shrink-0 px-2">
            <div className="space-y-3 rounded-md border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep("select")}
                  className="-ml-2 h-8"
                >
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  Back
                </Button>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {selectedLabel ? `Crop · ${selectedLabel}` : "Crop"}
                </div>
              </div>
              {selected && step === "crop" ? (
                <CropTool
                  recipeId={recipeId}
                  sourcePath={selected}
                  onSaved={() => setStep("focus")}
                />
              ) : (
                <p className="text-xs text-muted-foreground">Select a page first.</p>
              )}
            </div>
          </div>

          {/* Step 3 — focal point picker */}
          <div className="w-1/3 shrink-0 pl-2">
            <div className="space-y-3 rounded-md border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep("select")}
                  className="-ml-2 h-8"
                >
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  Back
                </Button>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {selectedLabel ? `Framing · ${selectedLabel}` : "Framing"}
                </div>
              </div>
              {selected ? (
                <FocalPointPicker
                  recipeId={recipeId}
                  coverPath={selected}
                  coverBucket="recipe-uploads"
                  initialFocalX={initialFocalX}
                  initialFocalY={initialFocalY}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Pick a page on the previous step first.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepBar({
  step,
  canAdvance,
  onStep,
}: {
  step: CoverStep;
  canAdvance: boolean;
  onStep: (next: CoverStep) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <StepChip
        active={step === "select"}
        index={1}
        label="Select page"
        onClick={() => onStep("select")}
      />
      <div className="h-px flex-1 bg-border" />
      <StepChip
        active={step === "crop"}
        index={2}
        label="Crop"
        disabled={!canAdvance}
        onClick={() => onStep("crop")}
      />
      <div className="h-px flex-1 bg-border" />
      <StepChip
        active={step === "focus"}
        index={3}
        label="Framing"
        disabled={!canAdvance}
        onClick={() => onStep("focus")}
      />
    </div>
  );
}

function StepChip({
  active,
  index,
  label,
  disabled,
  onClick,
}: {
  active: boolean;
  index: number;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
      )}
      aria-current={active ? "step" : undefined}
    >
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold",
          active ? "bg-primary text-primary-foreground" : "bg-background text-foreground",
        )}
      >
        {index}
      </span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

/**
 * Cover picker for recipes imported from multi-page sources (PDFs, scanned
 * cookbooks). Surfaces every source page as a clickable thumbnail so the
 * user can re-attribute the recipe's cover if the AI picked the wrong page.
 *
 * Design rationale:
 *   - Collapsed by default — most imports get the right page on the first
 *     try (the AI's source_page_index drives this). The picker is a fallback,
 *     not a default-on chooser.
 *   - Inline thumbnails (no modal) — the user is already on the review
 *     page editing the rest of the recipe; picking a cover shouldn't yank
 *     them out of context.
 *   - Click commits — no separate save step. Each click optimistically
 *     updates the local current pointer + fires the server action.
 *   - When user-uploaded photos exist (image_paths), they still take
 *     precedence in resolveCoverImage. A one-line hint explains this so
 *     a user who picks a source page but doesn't see it become the cover
 *     understands why.
 */
export function CoverPicker({
  recipeId,
  currentCoverPath,
  sourcePages,
  hasUserUploads,
  initialFocalX = 50,
  initialFocalY = 50,
}: {
  recipeId: string;
  currentCoverPath: string | null;
  sourcePages: string[];
  hasUserUploads: boolean;
  initialFocalX?: number;
  initialFocalY?: number;
}) {
  const [open, setOpen] = useState(false);

  if (sourcePages.length === 0) return null;
  const onlyOnePage = sourcePages.length === 1;

  return (
    <details
      className="rounded-xl border bg-card"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer items-center justify-between p-3 text-sm font-medium">
        <span className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          {onlyOnePage ? "Source page & framing" : `Choose cover from source pages (${sourcePages.length})`}
        </span>
        <span className="text-xs text-muted-foreground">
          {open ? "Hide" : "Show"}
        </span>
      </summary>
      <div className="border-t bg-muted/30 p-3">
        <CoverPickerGrid
          recipeId={recipeId}
          currentCoverPath={currentCoverPath}
          sourcePages={sourcePages}
          hasUserUploads={hasUserUploads}
          initialFocalX={initialFocalX}
          initialFocalY={initialFocalY}
        />
      </div>
    </details>
  );
}

function ThumbButton({
  path,
  label,
  isSelected,
  disabled,
  onClick,
}: {
  path: string;
  label: string;
  isSelected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  // Generous thumbnails — easier to tell pages apart than the previous
  // 240px crop, which often clipped the recipe title. 480px @ 2× DPI
  // covers any reasonable grid cell width. CDN-cached after first request.
  const url = useSignedImage(path, "recipe-uploads", {
    width: 480,
    height: 480,
    resize: "cover",
    quality: 75,
  });
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isSelected}
      aria-label={`Set ${label} as cover`}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-md border-2 bg-muted transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected
          ? "border-primary ring-2 ring-primary/30"
          : "border-transparent hover:border-primary/40",
        disabled && "cursor-wait opacity-60",
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          …
        </div>
      )}
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {label}
      </span>
      {isSelected ? (
        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      ) : null}
    </button>
  );
}
