"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isDev = process.env.NODE_ENV !== "production";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-3xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground">
        We hit a snag. Try reloading — if it keeps happening, please reach out.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => reset()}>Try again</Button>
      </div>
      {error.digest ? <code className="text-xs text-muted-foreground">id: {error.digest}</code> : null}

      {isDev ? (
        <pre className="mt-6 max-w-3xl overflow-auto rounded-md bg-muted p-4 text-left text-xs">
          <strong>{error.name ?? "Error"}:</strong> {error.message}
          {error.stack ? `\n\n${error.stack}` : null}
        </pre>
      ) : null}
    </div>
  );
}
