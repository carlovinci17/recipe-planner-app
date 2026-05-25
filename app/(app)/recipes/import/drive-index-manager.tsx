"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getDriveIndexStatusAction,
  startDriveIndexAction,
  type DriveIndexStatus,
} from "@/app/(app)/settings/integrations/actions";

export function DriveIndexManager({ householdId }: { householdId: string }) {
  const [status, setStatus] = useState<DriveIndexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    const res = await getDriveIndexStatusAction({ householdId });
    if (res.ok) setStatus(res.status);
    setLoading(false);
    return res.ok ? res.status : null;
  }, [householdId]);

  // Poll while building; stop once done.
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
    toast.success(
      `Indexing ${res.queued} file${res.queued === 1 ? "" : "s"}…`,
    );
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
  const pct = hasIndex ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent">
            <BookOpen className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium leading-tight">Recipe title index</p>
            {!hasIndex ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                Build the index to search for recipe names <em>inside</em> your PDF cookbooks.
              </p>
            ) : status.isBuilding ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                Indexing {status.total} files — {status.done} done…
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                {status.totalRecipes} recipes found in {status.done} file
                {status.done === 1 ? "" : "s"}
                {status.lastIndexedAt && (
                  <span className="ml-1 text-muted-foreground/60">
                    · updated {new Date(status.lastIndexedAt).toLocaleDateString("en-GB")}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {hasIndex && !status.isBuilding && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={starting}
              title="Rebuild index"
              onClick={() => handleBuild(true)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
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
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
