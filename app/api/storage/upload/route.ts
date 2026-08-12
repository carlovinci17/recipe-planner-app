import type { NextRequest } from "next/server";
import sharp from "sharp";
import { getCurrentUser } from "@/lib/auth/current-user";
import { householdService } from "@/lib/services/household-service";
import { ingestionStorage } from "@/lib/ingestion/storage";

// Node runtime: sharp + the storage SDK are Node-only.
export const runtime = "nodejs";
export const maxDuration = 60;

const CONTAINERS = new Set(["recipe-uploads", "recipe-images"]);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — above the 20 MB client caps, with headroom.
const COVER_MAX_DIM = 2560; // ADR-0006 Decision 1/2 — cap the longest edge.

/**
 * Server-proxied upload (Module 5 / ADR-0006 Decision 2). Keyless Azure Blob
 * can't be written from the browser (no SAS), so the browser POSTs the file here
 * and the server writes it with its Managed Identity. Authorization mirrors the
 * read route: the caller must be a member of the household in the target path
 * (`{householdId}/…`). `cap=cover` re-encodes to a capped WebP for user photos;
 * otherwise bytes are stored as-is (e.g. ingestion page photos the pipeline
 * rasterizes later). Provider-gated inside `ingestionStorage` — this route is
 * only wired on the Azure client path.
 *
 * multipart/form-data: file, container, path, cap?("cover")
 * → { path } (the FINAL stored path; `cover` changes the extension to .webp)
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const container = String(form.get("container") ?? "");
  const path = String(form.get("path") ?? "");
  const cap = String(form.get("cap") ?? "");
  const file = form.get("file");

  if (!CONTAINERS.has(container) || !path || !(file instanceof Blob)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const householdId = path.split("/")[0];
  if (!householdId) return Response.json({ error: "Bad path" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "File too large" }, { status: 413 });

  // Authorize: signed in AND a member of the household this path belongs to.
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const memberships = await householdService.listForCurrentUser();
  if (!memberships.some((m) => m.household.id === householdId)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  let finalPath = path;
  let contentType = file.type || "application/octet-stream";

  if (cap === "cover") {
    buffer = await sharp(buffer)
      .rotate() // honour EXIF orientation, then drop metadata on re-encode
      .resize(COVER_MAX_DIM, COVER_MAX_DIM, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    finalPath = path.replace(/\.[^./]+$/, "") + ".webp";
    contentType = "image/webp";
  }

  await ingestionStorage.uploadTo({ bucket: container, path: finalPath, buffer, contentType });
  return Response.json({ path: finalPath });
}
