import Link from "next/link";
import { FileUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getActiveHousehold } from "@/lib/services/active-household";
import { ImportUrl } from "./import-url";
import { ImportPhoto } from "./import-photo";
import { ImportDrive } from "./import-drive";
import { driveService } from "@/lib/services/drive-service";
import { ActiveJobs } from "./active-jobs";
import { BackLink } from "@/components/ui/back-link";

export const metadata = { title: "Add Recipes" };

export default async function ImportPage() {
  const household = await getActiveHousehold();
  const shareAddress = driveService.shareAddress();
  const driveFolders = shareAddress ? await driveService.listFolders(household.id) : [];

  return (
    <div className="container max-w-3xl space-y-6 py-6">
      <BackLink href="/recipes" label="Recipes" />
      <div>
        <h1 className="font-display text-2xl font-semibold">Add Recipes</h1>
        <p className="text-sm text-muted-foreground">
          Upload a photo or PDF, paste a link, sync a Google Drive folder, or write one out
          yourself.
        </p>
      </div>

      <Tabs defaultValue="photo">
        <TabsList>
          <TabsTrigger value="photo">
            <FileUp className="mr-1.5 h-3.5 w-3.5" />
            File
          </TabsTrigger>
          <TabsTrigger value="url">From URL</TabsTrigger>
          <TabsTrigger value="drive">Google Drive</TabsTrigger>
          <TabsTrigger value="new">Manual</TabsTrigger>
        </TabsList>

        <TabsContent value="photo" className="pt-4">
          <ImportPhoto householdId={household.id} />
        </TabsContent>

        <TabsContent value="new" className="pt-4">
          <div className="space-y-3 rounded-xl border bg-card p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent">
              <Plus className="h-6 w-6" />
            </div>
            <div>
              <p className="font-medium">Create a blank recipe</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Start from scratch and fill in the details yourself.
              </p>
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
          <ImportDrive
            householdId={household.id}
            shareAddress={shareAddress}
            folders={driveFolders}
          />
        </TabsContent>
      </Tabs>

      <ActiveJobs householdId={household.id} />
    </div>
  );
}
