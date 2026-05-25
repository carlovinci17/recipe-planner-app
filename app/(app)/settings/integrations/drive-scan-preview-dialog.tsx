"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, FileWarning, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  type DriveScanItem,
  commitDriveFolderScanAction,
  previewDriveFolderScanAction,
} from "./actions";

type ItemAction = "skip" | "import" | "replace";

const STATUS_LABEL: Record<DriveScanItem["status"], string> = {
  new: "New",
  "in-flight": "Already importing",
  "recipe-exists": "Already imported",
  "name-match": "Possible duplicate",
};

const STATUS_BADGE_CLASS: Record<DriveScanItem["status"], string> = {
  new: "bg-emerald-100 text-emerald-800",
  "in-flight": "bg-sky-100 text-sky-800",
  "recipe-exists": "bg-amber-100 text-amber-900",
  "name-match": "bg-amber-100 text-amber-900",
};

/** Default action chosen by the dialog based on the dedup status. */
function defaultActionFor(status: DriveScanItem["status"]): ItemAction {
  if (status === "new") return "import";
  return "skip";
}

/**
 * Preview-then-commit Drive scan dialog. Opens when the user clicks
 * "Scan now" on a watched folder; replaces the previous one-shot toast
 * flow with explicit per-file decisions so duplicates can be skipped,
 * re-imported, or replaced (delete-existing + import-new).
 */
export function DriveScanPreviewDialog({
  folderId,
  open,
  onOpenChange,
}: {
  folderId: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DriveScanItem[] | null>(null);
  const [actions, setActions] = useState<Record<string, ItemAction>>({});
  const [committing, startCommit] = useTransition();

  // Load the preview whenever the dialog opens with a folder.
  useEffect(() => {
    if (!open || !folderId) return;
    let cancelled = false;
    setLoading(true);
    setItems(null);
    setActions({});
    void previewDriveFolderScanAction({ folderId }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't scan folder");
        onOpenChange(false);
        return;
      }
      setItems(result.items);
      const initial: Record<string, ItemAction> = {};
      for (const it of result.items) initial[it.driveFileId] = defaultActionFor(it.status);
      setActions(initial);
    });
    return () => {
      cancelled = true;
    };
  }, [open, folderId, onOpenChange]);

  const counts = useMemo(() => {
    if (!items) return { newCount: 0, dupeCount: 0 };
    let newCount = 0;
    let dupeCount = 0;
    for (const it of items) {
      if (it.status === "new") newCount++;
      else dupeCount++;
    }
    return { newCount, dupeCount };
  }, [items]);

  const actionTotals = useMemo(() => {
    let imp = 0;
    let rep = 0;
    let skip = 0;
    for (const a of Object.values(actions)) {
      if (a === "import") imp++;
      else if (a === "replace") rep++;
      else skip++;
    }
    return { import: imp, replace: rep, skip };
  }, [actions]);

  function setAction(driveFileId: string, action: ItemAction) {
    setActions((prev) => ({ ...prev, [driveFileId]: action }));
  }

  function bulkSet(target: ItemAction, predicate: (it: DriveScanItem) => boolean) {
    if (!items) return;
    setActions((prev) => {
      const next = { ...prev };
      for (const it of items) {
        if (predicate(it)) next[it.driveFileId] = target;
      }
      return next;
    });
  }

  function commit() {
    if (!folderId || !items) return;
    const payload = items.map((it) => ({
      driveFileId: it.driveFileId,
      fileName: it.fileName,
      mimeType: it.mimeType,
      modifiedTime: it.modifiedTime,
      action: actions[it.driveFileId] ?? "skip",
      existingRecipeId: it.existingRecipeId ?? null,
    }));

    if (payload.every((p) => p.action === "skip")) {
      toast.info("Nothing selected to import");
      return;
    }

    startCommit(async () => {
      const result = await commitDriveFolderScanAction({ folderId, items: payload });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't apply scan");
        return;
      }
      const parts: string[] = [];
      if (result.queued > 0) parts.push(`Queued ${result.queued}`);
      if (result.replaced > 0)
        parts.push(`replaced ${result.replaced} ${result.replaced === 1 ? "recipe" : "recipes"}`);
      if (result.skipped > 0) parts.push(`skipped ${result.skipped}`);
      toast.success(parts.length > 0 ? parts.join(" · ") : "Done");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !committing && onOpenChange(next)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Drive scan — review before importing</DialogTitle>
          <DialogDescription>
            {loading
              ? "Looking at your folder..."
              : items
                ? `${counts.newCount} new · ${counts.dupeCount} possible duplicate${counts.dupeCount === 1 ? "" : "s"}. Pick what to do with each file.`
                : "Preparing..."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Listing files in Drive...
          </div>
        ) : items && items.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No supported files found in this folder. Add PDFs, images, or Google Docs and try
            again.
          </div>
        ) : items ? (
          <>
            {/* Bulk-action helpers — handy when there are many duplicates */}
            <div className="flex flex-wrap items-center gap-2 border-b pb-3 text-xs">
              <span className="text-muted-foreground">Bulk:</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  bulkSet("skip", (it) => it.status !== "new")
                }
              >
                Skip all duplicates
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  bulkSet("import", () => true)
                }
              >
                Import everything
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  bulkSet("replace", (it) => !!it.existingRecipeId)
                }
              >
                Replace all matched
              </Button>
            </div>

            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {items.map((it) => (
                <Row
                  key={it.driveFileId}
                  item={it}
                  action={actions[it.driveFileId] ?? "skip"}
                  onActionChange={(a) => setAction(it.driveFileId, a)}
                />
              ))}
            </ul>
          </>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={committing}>
            Cancel
          </Button>
          <Button
            onClick={commit}
            disabled={
              committing ||
              loading ||
              !items ||
              items.length === 0 ||
              (actionTotals.import === 0 && actionTotals.replace === 0)
            }
          >
            {committing
              ? "Applying..."
              : `Apply (${actionTotals.import + actionTotals.replace} import${
                  actionTotals.import + actionTotals.replace === 1 ? "" : "s"
                }${actionTotals.replace > 0 ? `, ${actionTotals.replace} replace` : ""})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  item,
  action,
  onActionChange,
}: {
  item: DriveScanItem;
  action: ItemAction;
  onActionChange: (action: ItemAction) => void;
}) {
  const hasMatch = !!item.existingRecipeId;
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-background p-3 sm:flex-row sm:items-start sm:justify-between",
        action === "skip" && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              STATUS_BADGE_CLASS[item.status],
            )}
          >
            {STATUS_LABEL[item.status]}
          </span>
          <span className="truncate text-sm font-medium" title={item.fileName}>
            {item.fileName}
          </span>
        </div>
        {item.folderPath ? (
          <div className="mt-0.5 text-xs text-muted-foreground truncate">
            📁 {item.folderPath}
          </div>
        ) : null}
        {hasMatch && item.existingRecipeTitle ? (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <FileWarning className="h-3 w-3" aria-hidden="true" />
            <span>
              Matches existing recipe:{" "}
              <span className="font-medium text-foreground">{item.existingRecipeTitle}</span>
            </span>
            <Link
              href={`/recipes/${item.existingRecipeId}`}
              className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
              target="_blank"
            >
              <ExternalLink className="h-3 w-3" /> open
            </Link>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 gap-1">
        <ActionButton active={action === "skip"} onClick={() => onActionChange("skip")}>
          Skip
        </ActionButton>
        <ActionButton active={action === "import"} onClick={() => onActionChange("import")}>
          Import
        </ActionButton>
        <ActionButton
          active={action === "replace"}
          onClick={() => onActionChange("replace")}
          disabled={!hasMatch}
          title={
            hasMatch ? "Delete the existing recipe and import this file" : "No match to replace"
          }
        >
          Replace
        </ActionButton>
      </div>
    </li>
  );
}

function ActionButton({
  active,
  onClick,
  children,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="h-7 px-2.5 text-xs"
    >
      {active ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
      {children}
    </Button>
  );
}
