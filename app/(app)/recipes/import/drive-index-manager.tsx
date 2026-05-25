"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  cancelDriveIndexAction,
  getDriveIndexStatusAction,
  startDriveIndexAction,
  type DriveIndexStatus,
} from "@/app/(app)/settings/integrations/actions";

export function DriveIndexManager({ householdId }: { householdId: string }) {
  const [status, setStatus] = useState<DriveIndexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    const res = await getDriveIndexStatusAction({ householdId });
    if (res.ok) setStatus(res.status);
    setLoading(false);
    return res.ok ? res.status : null;
  }, [householdId]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const s = await fetchStatus();
      if (s && !s.isBuilding) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 4000);
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus().then((s) => {
      if (s?.isBuilding) startPolling();
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus, startPolling]);

  async function handleCancel() {
    setCancelling(true);
    const res = await cancelDriveIndexAction({ householdId });
    setCancelling(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.info(`Indexing cancelled — ${res.cancelled} file${res.cancelled === 1 ? "" : "s"} skipped.`);
    await fetchStatus();
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
    toast.success(`Indexing ${res.queued} file${res.queued === 1 ? "" : "s"}…`);
    await fetchStatus();
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

  const hasIndex = status && status.total > 0;
  const hasFailed = hasIndex && status.failed > 0;
  const allFailed = hasIndex && status.failed === status.total && !status.isBuilding;
  const pct = hasIndex ? Math.round(((status.done + status.failed) / status.total) * 100) : 0;

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
              <p className="text-xs text-muted-foreground">
                Indexing {status.total} files — {status.done} done
                {status.failed > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 ml-1">
                    · {status.failed} failed
                  </span>
                )}
                …
              </p>
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
          {!hasIndex && (
            <Button
              size="sm"
              variant="secondary"
              disabled={starting || status?.isBuilding}
              onClick={() => handleBuild(false)}
            >
              {starting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Starting…
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
    </div>
  );
}
