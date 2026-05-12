import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Link href="/" className="font-display text-2xl font-semibold">
            Recipe Planner
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">Create your account.</p>
        </div>
        <SignupForm />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
