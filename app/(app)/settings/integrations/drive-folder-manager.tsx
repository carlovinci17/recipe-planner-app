"use client";

import { useState, useTransition } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addWatchedFolderAction,
  removeWatchedFolderAction,
} from "./actions";
import { DriveScanPreviewDialog } from "./drive-scan-preview-dialog";
import type { Tables } from "@/types/database.types";

type Folder = Tables<"drive_watched_folders">;

export function DriveFolderManager({
  householdId,
  accountId,
  initialFolders,
}: {
  householdId: string;
  accountId: string;
  initialFolders: Folder[];
}) {
  const [folders, setFolders] = useState(initialFolders);
  const [folderId, setFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [pending, start] = useTransition();

  function add() {
    if (!folderId.trim()) return;
    start(async () => {
      const result = await addWatchedFolderAction({
        householdId,
        accountId,
        folderId: folderId.trim(),
        folderName: folderName.trim() || null,
      });
      if (result.ok) {
        setFolders((prev) => [result.folder, ...prev]);
        setFolderId("");
        setFolderName("");
        toast.success("Folder added");
      } else {
        toast.error(result.error ?? "Failed");
      }
    });
  }

  async function remove(id: string) {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    await removeWatchedFolderAction(id);
  }

  // Scan now opens the preview dialog instead of queueing immediately. The
  // dialog runs the dedup, surfaces possible duplicates, and lets the user
  // pick per-file actions (skip / import / replace existing).
  const [previewFolderId, setPreviewFolderId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Watched folders</div>
      <ul className="space-y-2">
        {folders.length === 0 ? (
          <li className="text-sm text-muted-foreground">No folders watched yet.</li>
        ) : (
          folders.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{f.folder_name ?? "Drive folder"}</div>
                <div className="font-mono text-xs text-muted-foreground">{f.folder_id}</div>
                {f.last_synced_at ? (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Last synced: {new Date(f.last_synced_at).toLocaleString()}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPreviewFolderId(f.id)}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  Scan now
                </Button>
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  className="p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Remove folder"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))
        )}
      </ul>

      <div className="rounded-md border bg-accent/30 p-3 space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Add folder by ID
        </div>
        <p className="text-xs text-muted-foreground">
          Open the folder in Drive — the URL ends with the folder ID.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Folder ID"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          />
          <Input
            placeholder="Display name (optional)"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
          />
          <Button type="button" onClick={add} disabled={pending}>
            <Plus className="mr-1 h-4 w-4" /> Watch
          </Button>
        </div>
      </div>

      <DriveScanPreviewDialog
        folderId={previewFolderId}
        open={previewFolderId !== null}
        onOpenChange={(next) => {
          if (!next) setPreviewFolderId(null);
        }}
      />
    </div>
  );
}
