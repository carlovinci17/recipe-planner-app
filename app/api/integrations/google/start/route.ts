import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { driveClient } from "@/lib/integrations/google-drive";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getActiveHousehold } from "@/lib/services/active-household";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL!));

  const household = await getActiveHousehold();
  // Pack the household id into state — verified on callback to prevent CSRF.
  const state = `${household.id}:${crypto.randomUUID()}`;

  const cookieStore = await cookies();
  cookieStore.set("g_oauth_state", state, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
  });

  return NextResponse.redirect(driveClient.authUrl(state));
}
