"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createUrlJobAction } from "./actions";

export function ImportUrl({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [pending, start] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const result = await createUrlJobAction({ householdId, url });
      if (result.ok) {
        toast.success("Import started — we'll notify you when it's ready");
        setUrl("");
        router.refresh();
      } else {
        toast.error(result.error ?? "Could not start import");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-6">
      <div className="space-y-1.5">
        <Label htmlFor="url">Recipe URL</Label>
        <div className="relative">
          <LinkIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            placeholder="https://example.com/recipes/..."
            className="pl-9"
            required
          />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Starting..." : "Import from URL"}
      </Button>
    </form>
  );
}
