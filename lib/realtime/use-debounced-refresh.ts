"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Returns a debounced `router.refresh()`.
 *
 * Web PubSub events carry ids only, so clients refetch on change by re-running
 * the server component (`router.refresh()`). A burst of changes — select-all,
 * bulk edits, or another member editing quickly — would otherwise fire one full
 * server round-trip per event, which feels slow. Debouncing collapses a burst
 * into a single refetch. The optimistic local state stays on screen in the gap,
 * so the UI updates instantly and the refetch just reconciles.
 */
export function useDebouncedRouterRefresh(delayMs = 300) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), delayMs);
  }, [router, delayMs]);
}
