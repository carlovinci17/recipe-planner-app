"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createHouseholdAction } from "./actions";

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const result = await createHouseholdAction(name.trim());
    setBusy(false);
    if (result.ok) {
      toast.success("Household created");
      router.push("/recipes");
      router.refresh();
    } else {
      toast.error(result.error ?? "Could not create household");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
      <div className="space-y-1">
        <Label htmlFor="hh-name">Household name</Label>
        <Input
          id="hh-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. The Vincis"
          required
          autoFocus
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Creating..." : "Create household"}
      </Button>
    </form>
  );
}
