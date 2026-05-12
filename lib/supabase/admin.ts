import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { env } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — only use from trusted server contexts:
 *   - Inngest functions
 *   - background jobs
 *   - admin operations after authorization checks have already run
 */
export function createSupabaseAdmin() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "recipe-planner-admin" } },
  });
}
