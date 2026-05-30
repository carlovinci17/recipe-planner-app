import Link from "next/link";
import { AlertTriangle, Cloud } from "lucide-react";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveHousehold } from "@/lib/services/active-household";
import { DriveFolderManager } from "./drive-folder-manager";
import { DriveAccountActions } from "./drive-account-actions";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const { error: oauthError, connected } = await searchParams;
  const household = await getActiveHousehold();
  const supabase = await createSupabaseServerClient();

  const { data: account } = await supabase
    .from("integration_accounts")
    .select("*")
    .eq("household_id", household.id)
    .eq("provider", "google_drive")
    .maybeSingle();

  const { data: folders } = await supabase
    .from("drive_watched_folders")
    .select("*")
    .eq("household_id", household.id)
    .order("created_at", { ascending: false });

  return (
    <div className="container max-w-2xl space-y-6 py-6">
      <BackLink href="/settings" label="Settings" />
      <div>
        <h1 className="font-display text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect external services to auto-import recipes.
        </p>
      </div>

      {oauthError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 flex items-start gap-2.5 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          {oauthError === "state"
            ? "Connection attempt failed (invalid state). Please try again."
            : "Google authorisation failed. Please try connecting again."}
        </div>
      )}

      {connected && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
          Google Drive connected successfully.
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">Google Drive</CardTitle>
                <CardDescription>
                  Watch folders for new PDFs, images, and Google Docs.
                </CardDescription>
              </div>
            </div>
            {account ? <Badge variant="default">Connected</Badge> : <Badge variant="outline">Not connected</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!account ? (
            <Button asChild>
              <Link href="/api/integrations/google/start">Connect Google Drive</Link>
            </Button>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm">
                  Connected as <span className="font-medium">{account.email ?? account.external_id}</span>
                </p>
                <DriveAccountActions accountId={account.id} />
              </div>
              <Separator />
              <DriveFolderManager
                householdId={household.id}
                accountId={account.id}
                initialFolders={folders ?? []}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
