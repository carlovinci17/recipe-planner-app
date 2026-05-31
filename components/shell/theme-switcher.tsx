"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark",  label: "Dark",  icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex gap-2">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          className={cn(
            "flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-xs font-medium transition-colors",
            theme === value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Icon className="h-5 w-5" />
          {label}
        </button>
      ))}
    </div>
  );
}
