import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { householdService } from "@/lib/services/household-service";
import { setActiveHouseholdCookie } from "@/lib/services/active-household";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="container max-w-md py-16 text-center">
        <h1 className="font-display text-2xl font-semibold">You've been invited</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Log in or create an account with the email this invite was sent to in order to accept.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild>
            <Link href={`/login?next=/invites/${token}`}>Log in</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/signup?next=/invites/${token}`}>Sign up</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Try acceptance immediately; on success redirect into the household.
  try {
    const householdId = await householdService.acceptInvite(token);
    await setActiveHouseholdCookie(householdId);
  } catch {
    return (
      <div className="container max-w-md py-16 text-center">
        <h1 className="font-display text-2xl font-semibold">This invite isn't valid</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have expired, or it was issued to a different email address. Ask the household owner to send
          a new one.
        </p>
        <Button className="mt-6" asChild>
          <Link href="/recipes">Go to recipes</Link>
        </Button>
      </div>
    );
  }

  redirect("/recipes");
}
