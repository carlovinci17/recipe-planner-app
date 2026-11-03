"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { resolveBookPages, bookPageForImage } from "@/lib/ingestion/page-mapping";
import {
  choicesToCommit,
  defaultChoices,
  type SkimChoice,
} from "@/lib/ingestion/skim-choices";

type SkimRecipe = {
  title: string;
  summary: string;
  source_page_index: number | null;
  /** Set by the skim step when the household already has a recipe with this title. */
  in_library?: boolean;
  /** Set by the skim step when the household chose "Don't import again" for it. */
  ignored?: boolean;
};

const CHOICES: { value: SkimChoice; label: string }[] = [
  { value: "import", label: "Import" },
  { value: "skip", label: "Skip" },
  { value: "ignore", label: "Don't import again" },
];

/**
 * Two-phase import: Phase 1 (skim) returns this list of recipe candidates.
 * The dialog lets the user decide, per recipe, before Phase 2 (deep extract)
 * spends the expensive tokens. Every Drive file with anything new lands here —
 * nothing is imported without being chosen.
 *
 * UX notes:
 *   - Three choices per recipe (lib/ingestion/skim-choices): Import, Skip (asked
 *     again next time the file is read) and Don't import again (remembered;
 *     undone from the import page). New recipes start as Import, ones already
 *     in the library as Skip, and ones already on the Don't-import-again list
 *     are hidden, with a count.
 *   - Cancel is *not* a "close the dialog" — it commits an empty selection
 *     and marks the job cancelled. Dismissing the dialog without choosing
 *     keeps the pipeline parked (the user can come back later).
 *   - With nothing set to Import, the main button becomes "Done": the file is
 *     recorded as skipped (not cancelled) and any Don't-import-again choices kept.
 */
export function SkimPreviewDialog({
  jobId,
  recipes,
  sourcePages,
  sourcePageNumbers,
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
   * Real 1-based source PDF page behind each entry of `sourcePages`, when the
   * user narrowed the import up front ("2, 5-8, 13-15"). Without it the dialog
   * would label a recipe on book page 14 as "page 2", because the model counts
   * the images it was shown, not the pages of the book. Null when the whole
   * document was rasterized, where the two are the same thing.
   */
  sourcePageNumbers?: number[] | null;
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
  // One choice per recipe, by index in the recipes array — same indices the
  // server action consumes, so no name-matching ambiguity. null = hidden.
  const [choices, setChoices] = useState<(SkimChoice | null)[]>(() => defaultChoices(recipes));
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
      setChoices(defaultChoices(recipes));
      setSourceName(defaultSourceName ?? "");
      setSourceUrl(defaultSourceUrl ?? "");
    }
  }, [open, recipes, defaultSourceName, defaultSourceUrl]);

  function choose(idx: number, choice: SkimChoice) {
    setChoices((prev) => prev.map((c, i) => (i === idx ? choice : c)));
  }

  const hidden = choices.filter((c) => c === null).length;
  const total = recipes.length - hidden;
  const count = choices.filter((c) => c === "import").length;

  // Real book page behind each rasterized image. Without this the picker
  // labels a recipe on book page 14 as "page 2", because the model counts the
  // images it was shown rather than the pages of the document.
  const bookPages = useMemo(
    () => resolveBookPages(sourcePages.length, sourcePageNumbers),
    [sourcePages.length, sourcePageNumbers],
  );

  const grouped = useMemo(() => {
    // Sort by source_page_index so a multi-recipe document scans top-to-bottom.
    const indexed = recipes.map((r, i) => ({ r, i })).filter(({ r }) => !r.ignored);
    indexed.sort((a, b) => (a.r.source_page_index ?? 999) - (b.r.source_page_index ?? 999));
    return indexed;
  }, [recipes]);

  /** "cancel" throws away the import; "choices" sends what the user picked. */
  function commit(mode: "choices" | "cancel") {
    const { selectedIndices, ignoreIndices } =
      mode === "cancel" ? { selectedIndices: [], ignoreIndices: [] } : choicesToCommit(choices);
    startCommit(async () => {
      // Trim before forwarding so an empty-string source falls back to the
      // per-recipe AI default rather than overwriting it with whitespace.
      const trimmedName = sourceName.trim();
      const trimmedUrl = sourceUrl.trim();
      const result = await commitSkimSelectionAction({
        jobId,
        selectedIndices,
        ignoreIndices,
        allSkipped: mode === "choices" && selectedIndices.length === 0,
        sourceName: trimmedName.length > 0 ? trimmedName : null,
        sourceUrl: trimmedUrl.length > 0 ? trimmedUrl : null,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't submit selection");
        return;
      }
      const remembered =
        ignoreIndices.length > 0
          ? ` ${ignoreIndices.length} won't be offered again.`
          : "";
      if (mode === "cancel") {
        toast.info("Import cancelled");
      } else if (selectedIndices.length === 0) {
        toast.info(`Nothing imported from this file.${remembered}`);
      } else {
        toast.success(
          `Importing ${selectedIndices.length} ${selectedIndices.length === 1 ? "recipe" : "recipes"}…${remembered}`,
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
            {total} {total === 1 ? "recipe" : "recipes"} found — choose what to import
          </DialogTitle>
          <DialogDescription>
            We did a quick skim. For each recipe choose Import, Skip (we&apos;ll ask
            again next time this file is read) or Don&apos;t import again (we&apos;ll
            remember; undo it in the Recent imports tab of the same name) before the
            slower, detailed extraction.
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
            const choice = choices[i];
            const pagePath =
              r.source_page_index && r.source_page_index >= 1
                ? sourcePages[r.source_page_index - 1] ?? null
                : null;
            // Translate the model's image position into the real book page.
            const bookPage = bookPageForImage(r.source_page_index, bookPages);
            return (
              <li
                key={i}
                className={`flex items-start gap-3 rounded-md border bg-background p-2 transition-colors ${
                  choice === "import" ? "" : "opacity-60"
                }`}
              >
                <SkimRowThumb path={pagePath} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-medium">{r.title}</span>
                    {bookPage ? (
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        page {bookPage}
                      </span>
                    ) : null}
                    {r.in_library ? (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Already in your library
                      </span>
                    ) : null}
                  </div>
                  {r.summary ? (
                    <div className="text-xs leading-snug text-muted-foreground">{r.summary}</div>
                  ) : null}
                  <div
                    role="radiogroup"
                    aria-label={`What to do with ${r.title}`}
                    className="inline-flex flex-wrap gap-1"
                  >
                    {CHOICES.map((c) => (
                      <Button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={choice === c.value}
                        size="sm"
                        variant={choice === c.value ? (c.value === "import" ? "default" : "secondary") : "outline"}
                        className="h-7 px-2.5 text-xs"
                        onClick={() => choose(i, c.value)}
                        disabled={committing}
                      >
                        {c.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {hidden > 0 ? (
          <p className="text-xs text-muted-foreground">
            {hidden} more {hidden === 1 ? "recipe is" : "recipes are"} hidden because you chose
            Don&apos;t import again. Undo that in the &ldquo;Don&apos;t import again&rdquo; tab of
            Recent imports.
          </p>
        ) : null}

        <DialogFooter className="flex flex-row items-center justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => commit("cancel")}
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
              onClick={() => setChoices((prev) => prev.map((c) => (c === null ? null : "import")))}
              disabled={committing || count === total}
            >
              Import all
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => commit("choices")}
              disabled={committing}
            >
              {committing
                ? "Submitting…"
                : count === 0
                  ? "Done — import nothing"
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
