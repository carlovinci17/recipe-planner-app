"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import { commitSkimSelectionAction } from "./actions";

type SkimRecipe = {
  title: string;
  summary: string;
  source_page_index: number | null;
};

/**
 * Two-phase import: Phase 1 (skim) returns this list of recipe candidates.
 * The dialog lets the user uncheck false positives / unwanted recipes
 * before Phase 2 (deep extract) commits expensive Opus tokens.
 *
 * UX notes:
 *   - All recipes default-checked. The expected interaction is "scan,
 *     uncheck a few, hit Import".
 *   - Cancel is *not* a "close the dialog" — it commits an empty selection
 *     and marks the job failed. The dialog dismisses without choosing
 *     keeps the pipeline parked (the user can come back later).
 *   - "Import all" is a quick reset button for users who skipped through.
 */
export function SkimPreviewDialog({
  jobId,
  recipes,
  sourcePages,
  defaultSourceName,
  defaultSourceUrl,
  open,
  onOpenChange,
}: {
  jobId: string;
  recipes: SkimRecipe[];
  /**
   * All rasterized page paths (recipe-uploads bucket) from the import. Index
   * matches 1-based `source_page_index` minus 1. Used to render a thumbnail
   * next to each skim row so the user can see what they're agreeing to.
   */
  sourcePages: string[];
  /**
   * AI/derivation-suggested source for the whole batch. The user can edit
   * before committing; whatever they leave in the fields is applied to
   * every selected recipe (override). Pass nullish to start blank.
   */
  defaultSourceName?: string | null;
  defaultSourceUrl?: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  // Selection is by index in the recipes array — same indices the server
  // action consumes, so no name-matching ambiguity.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(recipes.map((_, i) => i)),
  );
  // Batch source override. Pre-filled from the AI/job-derived defaults; the
  // user can type to rebrand the whole import (e.g. "Health with Bec").
  const [sourceName, setSourceName] = useState<string>(defaultSourceName ?? "");
  const [sourceUrl, setSourceUrl] = useState<string>(defaultSourceUrl ?? "");
  const [committing, startCommit] = useTransition();

  // Re-sync selection + defaults when the dialog opens for a new job. The
  // defaults only re-apply on (re)open so partial typing doesn't get wiped
  // mid-edit by an incidental re-render.
  useEffect(() => {
    if (open) {
      setSelected(new Set(recipes.map((_, i) => i)));
      setSourceName(defaultSourceName ?? "");
      setSourceUrl(defaultSourceUrl ?? "");
    }
  }, [open, recipes, defaultSourceName, defaultSourceUrl]);

  function toggle(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  const total = recipes.length;
  const count = selected.size;

  const grouped = useMemo(() => {
    // Sort by source_page_index so a multi-recipe document scans top-to-bottom.
    const indexed = recipes.map((r, i) => ({ r, i }));
    indexed.sort((a, b) => (a.r.source_page_index ?? 999) - (b.r.source_page_index ?? 999));
    return indexed;
  }, [recipes]);

  function commit(indices: number[]) {
    startCommit(async () => {
      // Trim before forwarding so an empty-string source falls back to the
      // per-recipe AI default rather than overwriting it with whitespace.
      const trimmedName = sourceName.trim();
      const trimmedUrl = sourceUrl.trim();
      const result = await commitSkimSelectionAction({
        jobId,
        selectedIndices: indices,
        sourceName: trimmedName.length > 0 ? trimmedName : null,
        sourceUrl: trimmedUrl.length > 0 ? trimmedUrl : null,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't submit selection");
        return;
      }
      if (indices.length === 0) {
        toast.info("Import cancelled");
      } else {
        toast.success(
          `Importing ${indices.length} ${indices.length === 1 ? "recipe" : "recipes"}…`,
        );
      }
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !committing && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {total} {total === 1 ? "recipe" : "recipes"} found — pick what to import
          </DialogTitle>
          <DialogDescription>
            We did a quick skim. Uncheck anything you don&apos;t want before we
            do the slower, detailed extraction.
          </DialogDescription>
        </DialogHeader>

        {/* Batch source override — applies the same Source name + link to
            every recipe in this import. Whatever the user types wins over
            the per-recipe AI/URL default. Leave blank to keep per-recipe
            defaults. */}
        <div className="rounded-md border bg-muted/40 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Source for this batch
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="batch-source-name" className="text-xs">
                Name
              </Label>
              <Input
                id="batch-source-name"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="e.g. Health with Bec"
                maxLength={100}
                disabled={committing}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="batch-source-url" className="text-xs">
                Link (optional)
              </Label>
              <Input
                id="batch-source-url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                type="url"
                placeholder="https://..."
                maxLength={2000}
                disabled={committing}
                className="h-8"
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Applied to every recipe imported from this file. You can still edit
            individual recipes later.
          </p>
        </div>

        <ul className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {grouped.map(({ r, i }) => {
            const isSelected = selected.has(i);
            const pagePath =
              r.source_page_index && r.source_page_index >= 1
                ? sourcePages[r.source_page_index - 1] ?? null
                : null;
            return (
              <li
                key={i}
                className={`flex items-start gap-3 rounded-md border bg-background p-2 transition-colors ${
                  isSelected ? "" : "opacity-50"
                }`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggle(i)}
                  className="mt-1.5"
                  aria-label={`Toggle ${r.title}`}
                />
                <SkimRowThumb path={pagePath} />
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className="min-w-0 flex-1 cursor-pointer self-stretch text-left"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-medium">{r.title}</span>
                    {r.source_page_index ? (
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        page {r.source_page_index}
                      </span>
                    ) : null}
                  </div>
                  {r.summary ? (
                    <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {r.summary}
                    </div>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        <DialogFooter className="flex flex-row items-center justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => commit([])}
            disabled={committing}
            className="text-destructive hover:bg-destructive/10"
          >
            Cancel import
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set(recipes.map((_, i) => i)))}
              disabled={committing || count === total}
            >
              Select all
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => commit(Array.from(selected))}
              disabled={committing || count === 0}
            >
              {committing
                ? "Submitting…"
                : `Import ${count} of ${total}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Square thumbnail of the recipe's source page. Renders a placeholder
 * frame when no page is mapped (single-image imports, AI gave a null
 * page_index, or out-of-range index). 320px @ 2× DPI for the 80px slot.
 */
function SkimRowThumb({ path }: { path: string | null }) {
  const url = useSignedImage(path, "recipe-uploads", {
    width: 320,
    height: 320,
    resize: "cover",
    quality: 70,
  });
  return (
    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
          no preview
        </div>
      )}
    </div>
  );
}
