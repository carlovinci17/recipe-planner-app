"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which shows the "chef is on the way" screen while a
 * scaled-to-zero container is starting. It can only help on visits after the
 * first, because the worker has to be installed before the slow request.
 * Production only: in dev the server is always up and a worker gets in the way.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Not fatal: without the worker a cold start is just a slower blank load.
    });
  }, []);
  return null;
}
