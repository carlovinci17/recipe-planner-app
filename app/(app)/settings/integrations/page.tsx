import Link from "next/link";
import { Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveHousehold } from "@/lib/services/active-household";
import { DriveFolderManager } from "./drive-folder-manager";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
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
      <div>
        <h1 className="font-display text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect external services to auto-import recipes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
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
              <div className="text-sm">
                Connected as <span className="font-medium">{account.email ?? account.external_id}</span>
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
