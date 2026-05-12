import Link from "next/link";
import { ChevronRight, Cog, Link as LinkIcon, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Settings" };

const SECTIONS = [
  { href: "/settings/household", icon: Users, title: "Household", desc: "Members, invites, ownership" },
  { href: "/settings/integrations", icon: LinkIcon, title: "Integrations", desc: "Google Drive sync" },
  { href: "/settings/account", icon: Cog, title: "Account", desc: "Profile and preferences" },
];

export default function SettingsPage() {
  return (
    <div className="container max-w-2xl py-6">
      <h1 className="font-display text-2xl font-semibold">Settings</h1>
      <Card className="mt-4">
        <CardContent className="divide-y pt-2">
          {SECTIONS.map(({ href, icon: Icon, title, desc }) => (
            <Link
              key={href}
              href={href}
              className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 hover:bg-accent"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent">
                <Icon className="h-4 w-4 text-accent-foreground" />
              </div>
              <div className="flex-1">
                <div className="font-medium">{title}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
