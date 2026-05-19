import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Download, ShoppingCart, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/recipes");

  return (
    <main className="min-h-dvh bg-background">
      <header className="container flex items-center justify-between py-6">
        <div className="font-display text-xl font-semibold">BiteBuddy</div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="container grid gap-12 py-16 md:grid-cols-2 md:py-24">
        <div className="flex flex-col justify-center gap-6">
          <h1 className="font-display text-4xl font-semibold leading-tight md:text-5xl">
            Your household's kitchen, finally organized.
          </h1>
          <p className="max-w-prose text-lg text-muted-foreground">
            Drop in messy PDFs, screenshots, or links — get clean recipes, a shared weekly planner, and an
            automatic shopping list.
          </p>
          <div className="flex gap-3">
            <Button size="lg" asChild>
              <Link href="/signup">
                Start free <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">Log in</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4">
          <FeatureCard icon={Download} title="Import Recipes">
            Import recipes from URLs, PDFs, or screenshots — instantly structured and ready to cook.
          </FeatureCard>
          <FeatureCard icon={Users} title="Plan together">
            Build a shared weekly meal plan with your household. Everyone stays on the same page.
          </FeatureCard>
          <FeatureCard icon={Sparkles} title="AI Chef">
            Get personalised recipe suggestions based on what's in your kitchen and your household's tastes.
          </FeatureCard>
          <FeatureCard icon={ShoppingCart} title="Auto shopping list">
            Generate a smart, deduplicated grocery list from the week's meals automatically.
          </FeatureCard>
        </div>
      </section>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
