"use client";
import { useEffect, useRef } from "react";
import { WebPubSubClient } from "@azure/web-pubsub-client";
import type { RealtimeEvent } from "./events";

/**
 * Browser side of the realtime seam (ADR-0009). Subscribes to this user's
 * household group(s) over Azure Web PubSub and calls `onEvent` for each.
 *
 * The server is the single authority on whether realtime is available:
 * `/api/realtime/negotiate` mints a keyless, short-lived access URL and answers
 * 503 when Web PubSub is not configured. So this hook simply tries, and treats
 * failure as "no live updates" — every page still works, it just needs a
 * refresh to see someone else's change.
 *
 * It used to gate on NEXT_PUBLIC_REALTIME_PROVIDER as well, which meant a
 * missing build-time variable silently disabled realtime while the server was
 * perfectly willing to serve it. One source of truth is harder to get wrong.
 *
 * The access URL is fetched through a callback rather than passed in, because
 * the SDK re-invokes it on every reconnect — which is what lets the token be
 * short-lived.
 */
export function useHouseholdRealtime(onEvent: (event: RealtimeEvent) => void, enabled = true): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let client: WebPubSubClient | undefined;
    let stopped = false;

    void (async () => {
      try {
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
      } catch {
        // Realtime is an enhancement, not a dependency: a 503 (not configured),
        // a 401 (session expired mid-session) or a dropped socket must not
        // surface as an error to someone reading a recipe.
      }
    })();

    return () => {
      stopped = true;
      client?.stop();
    };
  }, [enabled]);
}
