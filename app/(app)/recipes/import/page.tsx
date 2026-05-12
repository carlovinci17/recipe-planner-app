import Link from "next/link";
import { Cloud } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { getActiveHousehold } from "@/lib/services/active-household";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DriveFolderManager } from "@/app/(app)/settings/integrations/drive-folder-manager";
import { ImportUrl } from "./import-url";
import { ActiveJobs } from "./active-jobs";

export const metadata = { title: "Import recipe" };

export default async function ImportPage() {
  const household = await getActiveHousehold();
  const supabase = await createSupabaseServerClient();

  const [{ data: account }, { data: folders }] = await Promise.all([
    supabase
      .from("integration_accounts")
      .select("*")
      .eq("household_id", household.id)
      .eq("provider", "google_drive")
      .maybeSingle(),
    supabase
      .from("drive_watched_folders")
      .select("*")
      .eq("household_id", household.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="container max-w-3xl space-y-6 py-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Import a recipe</h1>
        <p className="text-sm text-muted-foreground">
          Drop in a recipe URL, or pull files from a watched Google Drive folder.
        </p>
      </div>

      <Tabs defaultValue="url">
        <TabsList>
          <TabsTrigger value="url">From URL</TabsTrigger>
          <TabsTrigger value="drive">Google Drive</TabsTrigger>
        </TabsList>

        <TabsContent value="url" className="pt-4">
          <ImportUrl householdId={household.id} />
        </TabsContent>
        <TabsContent value="drive" className="pt-4">
          {account ? (
            <div className="space-y-4 rounded-xl border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent">
                    <Cloud className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium">Google Drive</div>
                    <div className="text-sm text-muted-foreground">
                      Connected as{" "}
                      <span className="font-medium text-foreground">
                        {account.email ?? account.external_id}
                      </span>
                    </div>
                  </div>
                </div>
                <Badge variant="default" className="shrink-0">
                  Connected
                </Badge>
              </div>
              <DriveFolderManager
                householdId={household.id}
                accountId={account.id}
                initialFolders={folders ?? []}
              />
              <div className="text-xs text-muted-foreground">
                Manage account or disconnect in{" "}
                <Link
                  href="/settings/integrations"
                  className="font-medium text-foreground underline"
                >
                  Settings → Integrations
                </Link>
                .
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
              Connect Google Drive in{" "}
              <Link
                href="/settings/integrations"
                className="font-medium text-foreground underline"
              >
                Settings → Integrations
              </Link>{" "}
              to auto-ingest recipes from watched folders.
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ActiveJobs householdId={household.id} />
    </div>
  );
}
