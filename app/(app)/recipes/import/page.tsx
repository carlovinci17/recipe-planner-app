import Link from "next/link";
import { Camera, Cloud, List, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { getActiveHousehold } from "@/lib/services/active-household";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DriveFolderManager } from "@/app/(app)/settings/integrations/drive-folder-manager";
import { ImportUrl } from "./import-url";
import { ImportPhoto } from "./import-photo";
import { ImportBulk } from "./import-bulk";
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
          Add a new recipe manually, paste a URL, or pull from Google Drive.
        </p>
      </div>

      <Tabs defaultValue="photo">
        <TabsList>
          <TabsTrigger value="photo">
            <Camera className="mr-1.5 h-3.5 w-3.5" />
            Photo
          </TabsTrigger>
          <TabsTrigger value="url">From URL</TabsTrigger>
          <TabsTrigger value="new">Manual</TabsTrigger>
          <TabsTrigger value="drive">Google Drive</TabsTrigger>
          {account && (
            <TabsTrigger value="bulk">
              <List className="mr-1.5 h-3.5 w-3.5" />
              Bulk import
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="photo" className="pt-4">
          <ImportPhoto householdId={household.id} />
        </TabsContent>

        <TabsContent value="new" className="pt-4">
          <div className="rounded-xl border bg-card p-6 text-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent mx-auto">
              <Plus className="h-6 w-6" />
            </div>
            <div>
              <p className="font-medium">Create a blank recipe</p>
              <p className="text-sm text-muted-foreground mt-1">Start from scratch and fill in the details yourself.</p>
            </div>
            <Button asChild>
              <Link href="/recipes/new">Create new recipe</Link>
            </Button>
          </div>
        </TabsContent>

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

        {account && (
          <TabsContent value="bulk" className="pt-4">
            <ImportBulk householdId={household.id} />
          </TabsContent>
        )}
      </Tabs>

      <ActiveJobs householdId={household.id} />
    </div>
  );
}
