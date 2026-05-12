import { getActiveHousehold } from "@/lib/services/active-household";
import { householdService } from "@/lib/services/household-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Household settings" };

export default async function HouseholdSettingsPage() {
  const household = await getActiveHousehold();
  const members = await householdService.members(household.id);

  return (
    <div className="container max-w-2xl space-y-6 py-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{household.name}</h1>
        <p className="text-sm text-muted-foreground">Manage household members and invites.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent className="divide-y pt-0">
          {members.map((m) => {
            const profile = (m as unknown as { profile: { id: string; email: string; display_name: string | null; avatar_url: string | null } | null }).profile;
            if (!profile) return null;
            const initials = (profile.display_name ?? profile.email)
              .split(/\s+/)
              .map((s) => s[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            return (
              <div key={profile.id} className="flex items-center gap-3 py-3">
                <Avatar className="h-9 w-9">
                  {profile.avatar_url ? <AvatarImage src={profile.avatar_url} /> : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="font-medium">{profile.display_name ?? profile.email}</div>
                  <div className="text-xs text-muted-foreground">{profile.email}</div>
                </div>
                <Badge variant={m.role === "owner" ? "default" : "secondary"}>{m.role}</Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {household.role === "owner" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite a member</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteForm householdId={household.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
