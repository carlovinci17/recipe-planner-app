import Link from "next/link";
import { LoginForm } from "./login-form";
import { env } from "@/lib/env";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const useEntra = env.AUTH_PROVIDER === "entra";
  // Only ever redirect to a same-site path — reject absolute/protocol-relative
  // URLs so ?next= can't be used as an open redirect (Auth.js also validates).
  const nextPath =
    params.next && params.next.startsWith("/") && !params.next.startsWith("//")
      ? params.next
      : "/recipes";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Link href="/" className="font-display text-2xl font-semibold">
            BiteBuddy
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">Log in to your household.</p>
        </div>

        {useEntra ? (
          // One button into the Entra External ID hosted sign-in page, which is
          // branded to look like BiteBuddy (Company Branding) and shows every
          // configured provider — Google, email, and later Facebook/Apple.
          // Account is auto-created on first sign-in.
          <div className="space-y-2">
            <form
              action={async () => {
                "use server";
                await signIn("microsoft-entra-id", { redirectTo: nextPath });
              }}
            >
              <Button type="submit" size="lg" className="w-full">
                Sign in
              </Button>
            </form>
            <p className="text-center text-xs text-muted-foreground">
              Continue with your email, password, or Google account.
            </p>
          </div>
        ) : (
          <>
            <LoginForm next={params.next} />
            <p className="text-center text-sm text-muted-foreground">
              New here?{" "}
              <Link href="/signup" className="font-medium text-foreground hover:underline">
                Create an account
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
