"use client";

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
