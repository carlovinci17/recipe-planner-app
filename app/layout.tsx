import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "next-themes";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const display = Source_Serif_4({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: { default: "BiteBuddy", template: "%s · BiteBuddy" },
  description: "Centralize, plan, and shop for your household's meals.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "BiteBuddy" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf6" },
    { media: "(prefers-color-scheme: dark)", color: "#171513" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(inter.variable, display.variable)}>
      <body className="min-h-dvh bg-background font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster richColors position="bottom-center" closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
