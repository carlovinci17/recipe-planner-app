"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { RefreshCw, Unplug } from "lucide-react";
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
import { disconnectGoogleDriveAction } from "./actions";

export function DriveAccountActions({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      await disconnectGoogleDriveAction(accountId);
      toast.success("Google Drive disconnected");
      setOpen(false);
    });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/api/integrations/google/start">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Reconnect
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Unplug className="mr-1.5 h-3.5 w-3.5" />
          Disconnect
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Google Drive?</DialogTitle>
            <DialogDescription>
              This will remove all watched folders and stop auto-importing recipes. Your existing
              recipes will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={disconnect} disabled={pending}>
              {pending ? "Disconnecting..." : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
