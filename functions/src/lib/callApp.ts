/**
 * Call an internal ingestion endpoint on the Next.js app (Module 6, architecture B).
 * The heavy work — rasterize, AI extraction, persist — lives in the app where its
 * deps/env already work; this Durable Functions app only orchestrates and calls out.
 */
export async function callApp<T = unknown>(step: string, body: unknown): Promise<T> {
  const base = process.env.APP_BASE_URL;
  const secret = process.env.INGESTION_INTERNAL_SECRET;
  if (!base || !secret) {
    throw new Error("APP_BASE_URL and INGESTION_INTERNAL_SECRET must be set on the Functions app.");
  }
  const res = await fetch(`${base}/api/internal/ingestion/${step}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    throw new Error(`app/${step} failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}
