"use client";
import { useEffect, useRef } from "react";
import { WebPubSubClient } from "@azure/web-pubsub-client";
import type { RealtimeEvent } from "./events";

/**
 * Browser side of the realtime seam (Module 8 / ADR-0009). Subscribes to this
 * user's household group(s) over Azure Web PubSub and calls `onEvent` for each.
 *
 * No-op unless NEXT_PUBLIC_REALTIME_PROVIDER=azure, so components can call it
 * unconditionally while Supabase Realtime is still the transport (dual-run).
 * The client fetches a fresh, keyless access URL from /api/realtime/negotiate —
 * the SDK re-calls it on reconnect, so tokens can be short-lived.
 */
const IS_AZURE = process.env.NEXT_PUBLIC_REALTIME_PROVIDER === "azure";

export function useHouseholdRealtime(onEvent: (event: RealtimeEvent) => void, enabled = true): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!IS_AZURE || !enabled) return;
    let client: WebPubSubClient | undefined;
    let stopped = false;

    void (async () => {
      const c = new WebPubSubClient({
        getClientAccessUrl: async () => {
          const res = await fetch("/api/realtime/negotiate");
          if (!res.ok) throw new Error(`realtime negotiate failed: ${res.status}`);
          const { url } = (await res.json()) as { url: string };
          return url;
        },
      });
      c.on("group-message", (e) => {
        const raw = e.message.data;
        try {
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
          cb.current(parsed as RealtimeEvent);
        } catch {
          /* ignore malformed frames */
        }
      });
      if (stopped) return;
      client = c;
      await c.start();
    })();

    return () => {
      stopped = true;
      client?.stop();
    };
  }, [enabled]);
}
