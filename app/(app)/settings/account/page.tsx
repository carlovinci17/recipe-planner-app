import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AccountForm } from "./account-form";
import { BackLink } from "@/components/ui/back-link";
import { ThemeSwitcher } from "@/components/shell/theme-switcher";

export const metadata = { title: "Account" };

export default async function AccountSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, email, avatar_url")
    .eq("id", user.id)
    .single();

  return (
    <div className="container max-w-xl space-y-6 py-6">
      <BackLink href="/settings" label="Settings" />
      <h1 className="font-display text-2xl font-semibold">Account</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountForm
            email={profile?.email ?? user.email ?? ""}
            displayName={profile?.display_name ?? ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Choose how the app looks. System follows your device setting.
          </p>
          <ThemeSwitcher />
        </CardContent>
      </Card>
    </div>
  );
}
