"use client";

import { useState, useTransition } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteAction } from "./actions";

export function InviteForm({ householdId }: { householdId: string }) {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const result = await inviteAction({ householdId, email });
      if (result.ok) {
        const url = `${window.location.origin}/invites/${result.token}`;
        setLink(url);
        setEmail("");
        toast.success("Invite created");
      } else {
        toast.error(result.error ?? "Failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          placeholder="them@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create invite"}
      </Button>

      {link ? (
        <div className="flex items-center gap-2 rounded-md border bg-accent/40 px-3 py-2 text-xs">
          <span className="flex-1 truncate font-mono">{link}</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(link);
              toast.success("Copied");
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </form>
  );
}
