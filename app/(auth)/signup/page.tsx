import Link from "next/link";
import { SignupForm } from "./signup-form";
import { env } from "@/lib/env";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Create account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const useEntra = env.AUTH_PROVIDER === "entra";
  // Same-site paths only — reject absolute/protocol-relative URLs so ?next=
  // can't be abused as an open redirect (Auth.js validates too).
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
          <p className="mt-2 text-sm text-muted-foreground">Create your account.</p>
        </div>

        {useEntra ? (
          // Under Entra there's no separate sign-up: the account is auto-created
          // on first sign-in, so the same branded hosted page serves both. `next`
          // is preserved so an invited user returns to accept their invite.
          <div className="space-y-2">
            <form
              action={async () => {
                "use server";
                await signIn("microsoft-entra-id", { redirectTo: nextPath });
              }}
            >
              <Button type="submit" size="lg" className="w-full">
                Create account
              </Button>
            </form>
            <p className="text-center text-xs text-muted-foreground">
              Sign up with your email, password, or Google account.
            </p>
          </div>
        ) : (
          <>
            <SignupForm />
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-foreground hover:underline">
                Log in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
