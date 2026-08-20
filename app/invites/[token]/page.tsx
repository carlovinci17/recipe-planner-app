import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/auth/current-user";
import { householdService } from "@/lib/services/household-service";
import { setActiveHouseholdCookie } from "@/lib/services/active-household";
import { signOutAction } from "@/components/shell/actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user, invite] = await Promise.all([
    getCurrentUser(),
    householdService.getInviteByToken(token),
  ]);

  // Invalid / expired / already accepted.
  if (!invite) return <InvalidInvite />;

  const emailMatches = !!user?.email && user.email.toLowerCase() === invite.email.toLowerCase();

  // Signed in as the invited person → accept and go in.
  if (user && emailMatches) {
    try {
      const householdId = await householdService.acceptInvite(token);
      await setActiveHouseholdCookie(householdId);
    } catch {
      return <InvalidInvite />;
    }
    redirect("/recipes");
  }

  // Not signed in, or signed in as the wrong account → steer sign-in to the
  // invited email. Invites are email-scoped: you must sign in as invite.email.
  const useEntra = env.AUTH_PROVIDER === "entra";
  return (
    <div className="container max-w-md py-16 text-center">
      <h1 className="font-display text-2xl font-semibold">
        You&apos;re invited to {invite.householdName}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This invite is for{" "}
        <span className="font-medium text-foreground">{invite.email}</span>. Sign in with that email to
        accept — a new account is created automatically if you don&apos;t have one.
      </p>
      {user && !emailMatches ? (
        <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
          You&apos;re currently signed in as {user.email}. Switch to {invite.email} to accept this invite.
        </p>
      ) : null}
      <div className="mt-6 flex flex-col items-center gap-2">
        {useEntra ? (
          <form
            action={async () => {
              "use server";
              // login_hint pre-fills the invited email; prompt=login forces a
              // fresh sign-in instead of silently reusing an existing session
              // (which was logging the tester in as the wrong account).
              await signIn(
                "microsoft-entra-id",
                { redirectTo: `/invites/${token}` },
                { login_hint: invite.email, prompt: "login" },
              );
            }}
          >
            <Button size="lg">Sign in as {invite.email}</Button>
          </form>
        ) : (
          <Button size="lg" asChild>
            <Link href={`/login?next=/invites/${token}`}>Log in</Link>
          </Button>
        )}
        {user && !emailMatches ? (
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
              Sign out of {user.email}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function InvalidInvite() {
  return (
    <div className="container max-w-md py-16 text-center">
      <h1 className="font-display text-2xl font-semibold">This invite isn&apos;t valid</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may have expired, already been used, or been issued to a different email address. Ask the
        household owner to send a new one.
      </p>
      <Button className="mt-6" asChild>
        <Link href="/recipes">Go to recipes</Link>
      </Button>
    </div>
  );
}
