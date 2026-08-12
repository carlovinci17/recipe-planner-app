import type { NextRequest } from "next/server";
import sharp from "sharp";
import { getCurrentUser } from "@/lib/auth/current-user";
import { householdService } from "@/lib/services/household-service";
import { ingestionStorage } from "@/lib/ingestion/storage";

// Node runtime: sharp + the storage SDK are Node-only.
export const runtime = "nodejs";

const CONTAINERS = new Set(["recipe-uploads", "recipe-images"]);

/**
 * Authorized image route (Module 5 / ADR-0006 Decision 4). This is the ONLY gate
 * on private image blobs — Azure Blob has no path-based authorization, so this
 * route replaces the old Supabase Storage policy: it verifies the caller is a
 * member of the household in the blob path (`{container}/{householdId}/…`) before
 * streaming. Fetch is provider-gated inside `ingestionStorage.downloadFile`
 * (Azure Blob or Supabase), so one route serves both stacks. Optional `?w/h/q`
 * resize with sharp (the on-demand thumbnail path).
 *
 * URL shape: /api/images/{container}/{householdId}/{...blobPath}?w=&h=&q=
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const container = path[0];
  const householdId = path[1];
  const blobPath = path.slice(1).join("/"); // {householdId}/… — the key within the container
  if (!container || !CONTAINERS.has(container) || !householdId || path.length < 3) {
    return new Response("Bad request", { status: 400 });
  }
  // Reject empty / "." / ".." segments. Azure blob names are literal (no path
  // resolution), so this is defense in depth against a crafted key.
  if (path.some((seg) => seg === "" || seg === "." || seg === "..")) {
    return new Response("Bad path", { status: 400 });
  }

  // Authorize: signed in AND a member of the household this blob belongs to.
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const memberships = await householdService.listForCurrentUser();
  if (!memberships.some((m) => m.household.id === householdId)) {
    return new Response("Forbidden", { status: 403 });
  }

  let buffer: Buffer;
  try {
    buffer = await ingestionStorage.downloadFile({ bucket: container, path: blobPath });
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const sp = req.nextUrl.searchParams;
  const w = toDim(sp.get("w"));
  const h = toDim(sp.get("h"));
  const q = toDim(sp.get("q")) ?? 75;

  let body: Buffer = buffer;
  let contentType = typeFor(blobPath);
  if (w || h) {
    body = await sharp(buffer)
      .resize({ width: w, height: h, fit: "cover", withoutEnlargement: true })
      .webp({ quality: q })
      .toBuffer();
    contentType = "image/webp";
  }

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      // Never let the browser MIME-sniff a stored blob into something executable.
      "X-Content-Type-Options": "nosniff",
      // Per-user, per-size; the underlying blob at a path is immutable.
      "Cache-Control": "private, max-age=3600",
    },
  });
}

function toDim(v: string | null): number | undefined {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 4096 ? n : undefined;
}

function typeFor(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}
