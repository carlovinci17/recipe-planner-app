/**
 * Module 8 / Lesson 8.2 — keyless Web PubSub round-trip smoke test.
 *
 * Proves the whole realtime seam without a browser or the write-path wiring:
 * mint a client access token (keyless, DefaultAzureCredential → az login),
 * connect a client to a household group, publish to that group as the server,
 * and assert the client receives it.
 *
 * Run: `npx tsx scripts/webpubsub-roundtrip.ts` (needs `az login`).
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });

import { WebPubSubServiceClient } from "@azure/web-pubsub";
import { WebPubSubClient } from "@azure/web-pubsub-client";
import { DefaultAzureCredential } from "@azure/identity";
import { householdGroup, REALTIME_HUB } from "../lib/realtime/events";

async function main(): Promise<void> {
  const endpoint = process.env.AZURE_WEBPUBSUB_ENDPOINT;
  if (!endpoint) throw new Error("AZURE_WEBPUBSUB_ENDPOINT not set in .env.local");

  const group = householdGroup("roundtrip-test");
  const service = new WebPubSubServiceClient(endpoint, new DefaultAzureCredential(), REALTIME_HUB);

  // 1. Negotiate a keyless client access URL scoped to the test group.
  const token = await service.getClientAccessToken({
    userId: "roundtrip",
    groups: [group],
    roles: [`webpubsub.joinLeaveGroup.${group}`],
    expirationTimeInMinutes: 5,
  });
  console.log("✓ minted client access token (keyless)");

  // 2. Connect a client; wait for a group message.
  const client = new WebPubSubClient(token.url);
  const received = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), 15_000);
    client.on("group-message", (e) => {
      clearTimeout(timer);
      resolve(e.message.data);
    });
  });
  await client.start();
  console.log("✓ client connected + auto-joined group");
  await new Promise((r) => setTimeout(r, 1000)); // let the join settle

  // 3. Publish as the server.
  const payload = { type: "shopping.changed", listId: "abc-123" } as const;
  await service.group(group).sendToAll({ ...payload });
  console.log("✓ published to group");

  // 4. Assert receipt.
  const got = await received;
  const parsed = (typeof got === "string" ? JSON.parse(got) : got) as { listId?: string };
  console.log("← received:", parsed);
  if (parsed?.listId !== "abc-123") throw new Error("payload mismatch");
  console.log("✅ keyless Web PubSub round-trip OK");
  await client.stop();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  });
