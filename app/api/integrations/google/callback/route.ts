import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { driveClient } from "@/lib/integrations/google-drive";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const expected = cookieStore.get("g_oauth_state")?.value;
  cookieStore.delete("g_oauth_state");

  if (!code || !state || state !== expected) {
    return NextResponse.redirect(new URL("/settings/integrations?error=state", url));
  }

  const householdId = state.split(":")[0]!;

  try {
    const tokens = await driveClient.exchangeCode(code);
    if (!tokens.access_token) throw new Error("No access token returned");

    // Fetch the user's Google profile so we can store email + external id
    const oauth = new google.auth.OAuth2();
    oauth.setCredentials({ access_token: tokens.access_token });
    const oauth2 = google.oauth2({ version: "v2", auth: oauth });
    const profile = await oauth2.userinfo.get();

    const user = await getCurrentUser();
    if (!user) return NextResponse.redirect(new URL("/login", url));

    // NOTE: Drive integration writes still use the Supabase client (Supabase-path
    // feature). Migrating integration_accounts to Drizzle is Module 5/6 work.
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("integration_accounts").upsert(
      {
        household_id: householdId,
        user_id: user.id,
        provider: "google_drive",
        external_id: profile.data.id ?? "",
        email: profile.data.email ?? null,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      },
      { onConflict: "household_id,provider,external_id" },
    );
    if (error) throw error;
  } catch (err) {
    logger.error({ err }, "google callback failed");
    return NextResponse.redirect(new URL("/settings/integrations?error=oauth", url));
  }

  return NextResponse.redirect(new URL("/settings/integrations?connected=1", url));
}
