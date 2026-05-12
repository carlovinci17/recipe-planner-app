"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  ChefHat,
  ChevronsUpDown,
  LogOut,
  Settings,
  ShoppingBasket,
  Upload,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { switchHouseholdAction } from "./actions";

type HouseholdSummary = { id: string; name: string; role: "owner" | "member" };

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: ChefHat },
  { href: "/recipes", label: "Recipes", icon: ChefHat },
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/shopping", label: "Shopping", icon: ShoppingBasket },
  { href: "/recipes/import", label: "Import", icon: Upload, primary: true },
];

export function AppShell({
  user,
  activeHousehold,
  households,
  children,
}: {
  user: { email: string; displayName: string; avatarUrl: string | null };
  activeHousehold: HouseholdSummary;
  households: HouseholdSummary[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function switchHousehold(id: string) {
    await switchHouseholdAction(id);
    router.refresh();
  }

  const initials = (user.displayName || user.email || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar (mobile + desktop) */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="font-display text-lg font-semibold">
            Recipes
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <span className="max-w-[10rem] truncate">{activeHousehold.name}</span>
                <ChevronsUpDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Households</DropdownMenuLabel>
              {households.map((h) => (
                <DropdownMenuItem
                  key={h.id}
                  onSelect={() => switchHousehold(h.id)}
                  className={cn(h.id === activeHousehold.id && "font-medium")}
                >
                  {h.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings/household">Manage</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full">
              <Avatar className="h-8 w-8">
                {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.displayName} /> : null}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4" /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={logout}>
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 border-r p-3 md:block">
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 pb-24 md:pb-8">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 border-t bg-background md:hidden">
        {NAV.filter((n) => !n.primary).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 py-2 text-[11px]",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
