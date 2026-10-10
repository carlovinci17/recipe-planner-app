"use client";

import { useState, useTransition } from "react";
import { Check, Copy, FolderSync, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DriveFolderSummary, DrivePreview } from "@/lib/services/drive-service";
import {
  confirmDriveFolderAction,
  connectDriveFolderAction,
  removeDriveFolderAction,
  retryDriveFilesAction,
  syncDriveFolderAction,
} from "./actions";

/**
 * Google Drive tab: share a folder with the app, preview it, start the import.
 * After that the `driveSync` timer keeps it in step — new files every 30 min,
 * a few at a time. Recipes already in the library are skipped by title.
 */
export function ImportDrive({
  householdId,
  shareAddress,
  folders,
}: {
  householdId: string;
  shareAddress: string | null;
  folders: DriveFolderSummary[];
}) {
  const [link, setLink] = useState("");
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<{
    folderRowId: string;
    folderName: string;
    preview: DrivePreview;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!shareAddress) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Google Drive import isn&apos;t set up on this server yet.
      </div>
    );
  }

  function copyAddress() {
    void navigator.clipboard.writeText(shareAddress!).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function connect() {
    start(async () => {
      const r = await connectDriveFolderAction({ householdId, link });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setPreview({ folderRowId: r.folderId, folderName: r.folderName, preview: r.preview });
      setLink("");
    });
  }

  function confirm(folderRowId: string) {
    start(async () => {
      const r = await confirmDriveFolderAction({ householdId, folderRowId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setPreview(null);
      toast.success("Import started — files are processed a few at a time.");
    });
  }

  function sync(folderRowId: string) {
    start(async () => {
      const r = await syncDriveFolderAction({ householdId, folderRowId });
      if (!r.ok) toast.error(r.error);
      else toast.success(`Checked — ${r.preview.pending} new file(s) found.`);
    });
  }

  function retry(folderRowId: string, fileRowId?: string) {
    start(async () => {
      const r = await retryDriveFilesAction({ householdId, folderRowId, fileRowId });
      if (!r.ok) toast.error(r.error);
      else if (fileRowId)
        toast.success("Importing again — pick the recipes you want when it's ready.");
      else toast.success(r.count ? `${r.count} file(s) queued again.` : "Nothing to retry.");
    });
  }

  function remove(folderRowId: string) {
    if (!window.confirm("Stop syncing this folder? Recipes already imported stay.")) return;
    start(async () => {
      const r = await removeDriveFolderAction({ householdId, folderRowId });
      if (!r.ok) toast.error(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <p className="text-sm font-medium">Sync a Google Drive folder</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            In Google Drive, share your recipes folder with this address (Viewer is enough).
            Everything inside it — subfolders too — is included.
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 truncate rounded bg-muted px-2 py-1 text-xs text-foreground">
                {shareAddress}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={copyAddress}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
              </Button>
            </div>
          </li>
          <li>Paste the folder&apos;s link below.</li>
        </ol>
        <div className="flex gap-2">
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            disabled={pending}
          />
          <Button type="button" onClick={connect} disabled={pending || link.trim().length < 5}>
            {pending ? "Checking…" : "Check folder"}
          </Button>
        </div>
      </div>

      {preview && (
        <div className="space-y-3 rounded-xl border border-primary/40 bg-card p-4">
          <p className="text-sm font-medium">“{preview.folderName}” is ready to import</p>
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">{preview.preview.pending}</span> file(s)
              to read
            </li>
            {preview.preview.alreadySeen > 0 && (
              <li>{preview.preview.alreadySeen} already synced before</li>
            )}
            {preview.preview.unsupported > 0 && (
              <li>{preview.preview.unsupported} skipped (not a PDF, image or Google Doc)</li>
            )}
          </ul>
          <p className="text-xs text-muted-foreground">
            Recipes already in your library are skipped by title. Files of up to 10 pages import
            automatically; longer cookbooks ask you which recipes to keep.
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => confirm(preview.folderRowId)} disabled={pending}>
              Start import
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPreview(null)}
              disabled={pending}
            >
              Not now
            </Button>
          </div>
        </div>
      )}

      {folders.map((f) => (
        <div key={f.id} className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                <FolderSync className="h-4 w-4 shrink-0 text-primary" />
                {f.folderName ?? "Drive folder"}
              </p>
              <p className="text-xs text-muted-foreground">
                {f.confirmed ? "Syncing every 30 minutes" : "Not started yet"}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              {f.confirmed ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => sync(f.id)}
                  disabled={pending}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Sync now
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={() => confirm(f.id)} disabled={pending}>
                  Start import
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(f.id)}
                disabled={pending}
                aria-label="Stop syncing this folder"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{f.counts.imported} imported</span>
            {f.counts.importing > 0 && <span>{f.counts.importing} in progress</span>}
            {f.counts.waiting > 0 && <span>{f.counts.waiting} waiting</span>}
            {f.counts.skipped > 0 && <span>{f.counts.skipped} skipped (already in library)</span>}
            {f.counts.failed > 0 && (
              <span className="text-destructive">{f.counts.failed} failed</span>
            )}
            {f.counts.unsupported > 0 && <span>{f.counts.unsupported} unsupported</span>}
          </div>
          {f.lastError && <p className="text-xs text-destructive">{f.lastError}</p>}
          {f.notImported.length > 0 && (
            <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Not imported ({f.notImported.length}) — skipped, cancelled or failed
              </summary>
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => retry(f.id)}
                  disabled={pending}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry all failed
                </Button>
              </div>
              <ul className="mt-2 divide-y">
                {f.notImported.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">
                        {n.path ? `${n.path}/` : ""}
                        {n.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{n.reason}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => retry(f.id, n.id)}
                      disabled={pending}
                    >
                      Import again
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
