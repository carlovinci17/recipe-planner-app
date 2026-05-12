import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const Body = z.object({
  householdId: z.string().uuid(),
  accountId: z.string().uuid(),
  driveFileId: z.string().min(1),
  mimeType: z.string().min(1),
  fileName: z.string().min(1),
});

/**
 * Webhook intended for n8n flows that watch Drive folders.
 *
 * n8n config:
 *   - Trigger: Google Drive "On New File" in folder X
 *   - HTTP Request: POST { householdId, accountId, driveFileId, mimeType, fileName }
 *     to ${APP_URL}/api/webhooks/drive
 *     Header: x-webhook-secret = N8N_WEBHOOK_SECRET
 *
 * The Inngest cron poller is the fallback if n8n isn't configured.
 */
export async function POST(request: NextRequest) {
  const provided = request.headers.get("x-webhook-secret");
  if (!env.N8N_WEBHOOK_SECRET || provided !== env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.flatten() }, { status: 400 });
  }

  await inngest.send({
    name: "ingestion/drive.file.detected",
    data: parsed.data,
  });

  logger.info({ driveFileId: parsed.data.driveFileId }, "drive webhook received");
  return NextResponse.json({ ok: true });
}
