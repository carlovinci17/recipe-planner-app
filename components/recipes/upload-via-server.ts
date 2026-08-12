"use client";

/**
 * Whether the browser should upload through our server (keyless Azure) instead
 * of a signed PUT straight to storage (Supabase). Mirrors the server's
 * STORAGE_PROVIDER via the NEXT_PUBLIC_ copy so the client can branch.
 */
export const STORAGE_IS_AZURE = process.env.NEXT_PUBLIC_STORAGE_PROVIDER === "azure";

/**
 * POST a file to the server-proxied upload route (Module 5 / ADR-0006). The
 * route authorizes (household-from-path), optionally `sharp`-caps a cover photo,
 * and writes to Blob with its Managed Identity. Returns the FINAL stored path —
 * for `cap: "cover"` the extension becomes `.webp`, so always use what's
 * returned, not the path you sent.
 */
export async function uploadViaServer(args: {
  container: "recipe-images" | "recipe-uploads";
  path: string;
  file: File;
  cap?: "cover";
}): Promise<string> {
  const fd = new FormData();
  fd.set("container", args.container);
  fd.set("path", args.path);
  if (args.cap) fd.set("cap", args.cap);
  fd.set("file", args.file);
  const res = await fetch("/api/storage/upload", { method: "POST", body: fd });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Upload failed (${res.status})`);
  }
  const { path } = (await res.json()) as { path: string };
  return path;
}
