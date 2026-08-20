"use client";

import { useEffect, useRef, useState } from "react";
import { ChefHat, Check, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { confirmProposalAction } from "@/components/assistant/actions";
import type { AssistantProposal } from "@/lib/agents/proposals";

/**
 * The "Ask AI" Kitchen Assistant chat (Module 12.5 / ADR-0010). A floating button
 * opens a chat that talks to /api/assistant (the LangGraph supervisor). Each reply
 * renders with the avatar of whichever specialist answered — the per-turn avatar.
 * (Emoji avatars are placeholders; the illustrated faces are a tracked design TODO.)
 */
const AVATAR: Record<string, { face: string; label: string }> = {
  finder: { face: "🔎", label: "Finder" },
  planner: { face: "📅", label: "Planner" },
  shopping: { face: "🛒", label: "Shopping" },
};
const COORDINATOR = { face: "🧑‍🍳", label: "Kitchen Assistant" };

type Msg = {
  role: "user" | "assistant";
  content: string;
  specialist?: string | null;
  proposals?: AssistantProposal[];
};

/**
 * Render assistant text. The agents are told to reply in plain prose, but if a
 * model still emits `**bold**` we convert it rather than showing literal stars.
 * Newlines are preserved by the container's `whitespace-pre-wrap`.
 */
function renderRichText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

/** One-line human summary of a proposal for the Confirm card. */
function describeProposal(p: AssistantProposal): string {
  return p.kind === "generate_shopping_list"
    ? `Generate a shopping list for the week of ${p.weekStartIso}`
    : `Add “${p.recipeTitle}” to ${p.date} (${p.slot})`;
}

export function KitchenAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Per-proposal confirm state, keyed `${msgIndex}-${proposalIndex}`:
  // "running" | "done" | an error string.
  const [confirming, setConfirming] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history }),
      });
      const data = (await res.json()) as {
        specialist?: string | null;
        answer?: string;
        error?: string;
        proposals?: AssistantProposal[];
      };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer ?? data.error ?? "Sorry, something went wrong.",
          specialist: data.specialist,
          proposals: data.proposals,
        },
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't reach the kitchen right now." }]);
    } finally {
      setLoading(false);
    }
  }

  async function confirm(key: string, p: AssistantProposal) {
    if (confirming[key] === "running" || confirming[key] === "done") return;
    setConfirming((s) => ({ ...s, [key]: "running" }));
    try {
      const res = await confirmProposalAction(p);
      if (res.ok) {
        setConfirming((s) => ({ ...s, [key]: "done" }));
        setMessages((prev) => [...prev, { role: "assistant", content: `✅ ${res.message}`, specialist: null }]);
      } else {
        setConfirming((s) => ({ ...s, [key]: res.error }));
      }
    } catch {
      setConfirming((s) => ({ ...s, [key]: "Couldn't complete that — try again." }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          className="fixed bottom-24 right-4 z-40 h-14 w-14 rounded-full shadow-lg md:bottom-6"
          aria-label="Ask the Kitchen Assistant"
        >
          <ChefHat className="h-6 w-6" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[80vh] max-w-md flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl">{COORDINATOR.face}</span> Kitchen Assistant
          </DialogTitle>
        </DialogHeader>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask me to find a recipe, plan your week, or check your shopping list.
            </p>
          )}
          {messages.map((m, i) => {
            const av = m.specialist ? (AVATAR[m.specialist] ?? COORDINATOR) : COORDINATOR;
            return (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex items-start gap-2"}>
                {m.role === "assistant" && (
                  <span className="mt-1 text-lg" title={av.label} aria-label={av.label}>
                    {av.face}
                  </span>
                )}
                <div className="flex max-w-[80%] flex-col gap-2">
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                      m.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-muted"
                    }`}
                  >
                    {m.role === "assistant" ? renderRichText(m.content) : m.content}
                  </div>
                  {m.proposals?.map((p, pi) => {
                    const key = `${i}-${pi}`;
                    const st = confirming[key];
                    return (
                      <div key={pi} className="rounded-xl border bg-background p-3 text-sm">
                        <p className="mb-2">{describeProposal(p)}</p>
                        {st === "done" ? (
                          <p className="flex items-center gap-1 text-xs font-medium text-green-600">
                            <Check className="h-3 w-3" /> Done
                          </p>
                        ) : (
                          <>
                            <Button size="sm" disabled={st === "running"} onClick={() => void confirm(key, p)}>
                              {st === "running" ? "Working…" : "Confirm"}
                            </Button>
                            {st && st !== "running" && <p className="mt-1 text-xs text-destructive">{st}</p>}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 animate-pulse" /> thinking…
            </div>
          )}
        </div>

        <form
          className="flex gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the kitchen…"
            disabled={loading}
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
