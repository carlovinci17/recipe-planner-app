"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import { env } from "@/lib/env";

let _client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** Browser Supabase client. Memoized — safe to call from any client component. */
export function createClient() {
  if (_client) return _client;
  _client = createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return _client;
}
