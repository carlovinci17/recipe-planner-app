"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronUp, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  cancelDriveIndexAction,
  getDriveIndexStatusAction,
  startDriveIndexAction,
  type DriveIndexStatus,
} from "@/app/(app)/settings/integrations/actions";

function methodLabel(method: string | null): string {
  if (method === "text") return "Text reading";
  if (method === "vision") return "Vision";
  if (method === "text+vision") return "Vision (text fallback)";
  return "Indexing";
}

function problemReason(
  status: "failed" | "no_titles",
  error: string | null,
  method: string | null,
): string {
  if (status === "no_titles") {
    if (method === "text+vision") return "No titles found — text + vision tried";
    if (method === "vision") return "No titles found — vision scan";
    if (method === "text") return "No titles found — text reading";
    return "No titles found";
  }
  if (error === "Cancelled by user") return "Cancelled";
  if (error?.includes("detached ArrayBuffer")) return "PDF rendering failed (unsupported format)";
  if (error?.includes("not found")) return "Drive connection error";
  if (error?.includes("invalid_grant")) return "Google auth expired — reconnect Drive";
  return error?.slice(0, 100) ?? "Unknown error";
}

export function DriveIndexManager({ householdId }: { householdId: string }) {
  const [status, setStatus] = useState<DriveIndexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    const res = await getDriveIndexStatusAction({ householdId });
    if (res.ok) {
      setStatus(res.status);
      setFetchError(null);
    } else {
      setFetchError(res.error);
    }
    setLoading(false);
    return res.ok ? res.status : null;
  }, [householdId]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    // Poll every 2 s while building — cheap DB query, gives responsive feedback.
    pollRef.current = setInterval(async () => {
      const s = await fetchStatus();
      if (s && !s.isBuilding) stopPolling();
    }, 2000);
  }, [fetchStatus, stopPolling]);

  useEffect(() => {
    fetchStatus().then((s) => {
      if (s?.isBuilding) startPolling();
    });
    return stopPolling;
  }, [fetchStatus, startPolling, stopPolling]);

  async function handleCancel() {
    setCancelling(true);
    const res = await cancelDriveIndexAction({ householdId });
    setCancelling(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.info(
      `Indexing cancelled — ${res.cancelled} file${res.cancelled === 1 ? "" : "s"} skipped.`,
    );
    await fetchStatus();
    stopPolling();
  }

  async function handleBuild(force = false) {
    setStarting(true);
    const res = await startDriveIndexAction({ householdId, force });
    setStarting(false);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }

    if (res.queued === 0 && res.skipped > 0) {
      toast.success("All files are already indexed.");
      fetchStatus();
      return;
    }

    if (res.queued === 0) {
      toast.info("No indexable PDF files found in watched folders.");
      return;
    }

    // Optimistically transition to building state immediately — don't wait for
    // fetchStatus() to round-trip back to the DB.
    setStatus((prev) => ({
      total: (prev?.done ?? 0) + (prev?.failed ?? 0) + res.queued,
      done: prev?.done ?? 0,
      pending: res.queued,
      indexing: 0,
      failed: prev?.failed ?? 0,
      totalRecipes: prev?.totalRecipes ?? 0,
      lastIndexedAt: prev?.lastIndexedAt ?? null,
      isBuilding: true,
    }));

    toast.success(`Indexing ${res.queued} file${res.queued === 1 ? "" : "s"}…`);
    fetchStatus(); // sync real counts in background
    startPolling();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking index…
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-2.5">
        <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Recipe title index unavailable</p>
          <p className="text-xs text-muted-foreground">{fetchError}</p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={fetchStatus}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const hasIndex = status && status.total > 0;
  const hasFailed = hasIndex && status.failed > 0;
  const allFailed = hasIndex && status.failed === status.total && !status.isBuilding;
  const pct = hasIndex ? Math.round(((status.done + status.failed) / status.total) * 100) : 0;
  const problemFiles = status?.problemFiles ?? [];
  const hasProblemFiles = !status?.isBuilding && problemFiles.length > 0;

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${hasFailed && !status.isBuilding ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20" : "bg-muted/30"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${hasFailed && !status.isBuilding ? "bg-amber-100 dark:bg-amber-900/40" : "bg-accent"}`}
          >
            {hasFailed && !status.isBuilding ? (
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            ) : (
              <BookOpen className="h-4 w-4" />
            )}
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-medium leading-tight">Recipe title index</p>

            {!hasIndex ? (
              <p className="text-xs text-muted-foreground">
                Build the index to search recipe names <em>inside</em> your PDF cookbooks.
              </p>
            ) : status.isBuilding ? (
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">
                  Indexing {status.total} files — {status.done} done
                  {status.failed > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 ml-1">
                      · {status.failed} failed
                    </span>
                  )}
                  …
                </p>
                {status.currentFile && (
                  <p className="text-xs text-muted-foreground/70 truncate max-w-xs">
                    {status.currentFile.fileName}
                    {status.currentFile.indexMethod && (
                      <span className="ml-1 font-medium text-muted-foreground">
                        · {methodLabel(status.currentFile.indexMethod)}
                      </span>
                    )}
                    {status.currentFile.totalPages != null && (
                      <span className="ml-1">
                        {"— "}
                        {status.currentFile.currentPage != null &&
                        status.currentFile.currentPage < status.currentFile.totalPages
                          ? `page ${status.currentFile.currentPage + 1} of ${status.currentFile.totalPages}`
                          : `reading ${status.currentFile.totalPages} pages`}
                      </span>
                    )}
                  </p>
                )}
              </div>
            ) : allFailed ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                All {status.failed} files failed to index. Check your Drive connection and retry.
              </p>
            ) : (
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                  {status.totalRecipes} recipes in {status.done} file{status.done === 1 ? "" : "s"}
                  {status.lastIndexedAt && (
                    <span className="text-muted-foreground/60">
                      · updated {new Date(status.lastIndexedAt).toLocaleDateString("en-GB")}
                    </span>
                  )}
                </p>
                {hasFailed && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {status.failed} file{status.failed === 1 ? "" : "s"} failed — use Rebuild to
                    retry
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {hasIndex && !status.isBuilding && (
            <Button
              variant={hasFailed ? "secondary" : "ghost"}
              size={hasFailed ? "sm" : "icon"}
              className={hasFailed ? "" : "h-8 w-8"}
              disabled={starting}
              title="Rebuild index"
              onClick={() => handleBuild(true)}
            >
              {starting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  {hasFailed && <span className="ml-1.5">Rebuild</span>}
                </>
              )}
            </Button>
          )}
          {!hasIndex && !status?.isBuilding && (
            <Button
              size="sm"
              variant="secondary"
              disabled={starting}
              onClick={() => handleBuild(false)}
            >
              {starting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Scanning folders…
                </>
              ) : (
                "Build index"
              )}
            </Button>
          )}
        </div>
      </div>

      {hasIndex && status.isBuilding && (
        <div className="space-y-2">
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              disabled={cancelling}
              onClick={handleCancel}
            >
              {cancelling ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <X className="mr-1.5 h-3 w-3" />
              )}
              Cancel
            </Button>
          </div>
        </div>
      )}

      {hasProblemFiles && (
        <div className="border-t pt-2.5 space-y-1.5">
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
            onClick={() => setShowProblems((v) => !v)}
          >
            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
            <span>
              {problemFiles.length} file{problemFiles.length === 1 ? "" : "s"} could not be fully
              indexed
            </span>
            {showProblems ? (
              <ChevronUp className="h-3 w-3 ml-auto" />
            ) : (
              <ChevronDown className="h-3 w-3 ml-auto" />
            )}
          </button>

          {showProblems && (
            <div className="space-y-1 max-h-48 overflow-y-auto rounded-md bg-muted/40 p-2">
              {problemFiles.map((f) => (
                <div key={f.fileName} className="flex items-start gap-1.5 text-xs">
                  <AlertTriangle
                    className={`h-3 w-3 shrink-0 mt-0.5 ${f.status === "failed" ? "text-destructive" : "text-amber-500"}`}
                  />
                  <div className="min-w-0">
                    <span className="font-medium truncate block">{f.fileName}</span>
                    <span className="text-muted-foreground">
                      {problemReason(f.status, f.error, f.indexMethod)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
