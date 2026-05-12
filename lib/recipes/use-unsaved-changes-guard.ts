"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PendingNavigation = { kind: "link"; href: string } | { kind: "back" };

/**
 * Guards a form against accidental navigation while it has unsaved changes.
 *
 * Two layers:
 *   1. `beforeunload` — covers tab close, refresh, browser back to external.
 *      Renders a native browser dialog (ugly but always available).
 *   2. Document-level `click` capture on <a> elements with non-bypass intent.
 *      When dirty, prevents default and surfaces a `pending` navigation that
 *      the host can show in a custom dialog with Save / Discard / Cancel.
 *
 * Usage:
 *   const guard = useUnsavedChangesGuard({ when: isDirty });
 *   // when guard.pending !== null, render an AlertDialog.
 *   // call guard.proceed() to navigate, guard.cancel() to dismiss.
 */
export function useUnsavedChangesGuard({ when }: { when: boolean }) {
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  const whenRef = useRef(when);
  whenRef.current = when;

  // Layer 1: native beforeunload.
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (!whenRef.current) return;
      e.preventDefault();
      e.returnValue = ""; // Chromium needs this.
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Layer 2: capture <a> clicks at document level. Use capture phase so we
  // run before Next.js' Link click handler.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!whenRef.current) return;

      // Respect modified clicks (cmd/ctrl/shift/middle-click) — those open
      // new tabs and don't navigate the current page, so no need to guard.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

      // Find the nearest anchor element from the click target.
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      // Skip downloads + new tabs — they don't unmount this page.
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      // Skip same-page anchors and external URLs that go to a new origin.
      // External clicks are handled by `beforeunload`.
      try {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search)
          return;
      } catch {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "link", href: anchor.href });
    }

    document.addEventListener("click", handler, { capture: true });
    return () => document.removeEventListener("click", handler, { capture: true });
  }, []);

  const proceed = useCallback(() => {
    const p = pending;
    setPending(null);
    if (p?.kind === "link") {
      // Use full navigation rather than router.push — this fires AFTER the
      // user has confirmed (so dirty state is already resolved on the host).
      window.location.href = p.href;
    }
  }, [pending]);

  const cancel = useCallback(() => setPending(null), []);

  return { pending, proceed, cancel };
}
