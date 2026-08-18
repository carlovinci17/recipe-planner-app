import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";

/**
 * Lesson 7.4 — the Foundry provider's retry/parse logic, verified without MSW,
 * tokens, or Azure auth.
 *
 * We fake the `openai` SDK client directly (and stub `@azure/identity` so no real
 * Managed-Identity credential is constructed), then drive the exact
 * corrective-retry path the golden set (7.3) relied on when a model returns
 * invalid JSON. This is why we chose SDK-level mocking over MSW here: it sidesteps
 * the credential's token fetch entirely.
 */
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => {
  class AzureOpenAI {
    chat = { completions: { create } };
    constructor(_opts: unknown) {}
  }
  return { default: class OpenAI {}, AzureOpenAI };
});
vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {},
  getBearerTokenProvider: () => async () => "fake-token",
}));

import { azureFoundryProvider } from "@/lib/ai/azure-foundry-provider";

const completion = (content: string) => ({
  model: "gpt-4o-mini",
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  choices: [{ message: { content } }],
});
const schema = z.object({ ok: z.boolean() });
const messages = [{ role: "user" as const, content: "return json" }];

beforeEach(() => create.mockReset());

describe("azureFoundryProvider — SDK-mocked (zero tokens, no network)", () => {
  it("parses valid JSON and computes cost from usage", async () => {
    create.mockResolvedValueOnce(completion('{"ok":true}'));
    const res = await azureFoundryProvider.callStructured({ schema, schemaName: "t", messages });
    expect(res.data).toEqual({ ok: true });
    expect(res.usage.totalTokens).toBe(150);
    expect(res.usage.costCents).toBeCloseTo(((100 * 0.15 + 50 * 0.6) / 1_000_000) * 100, 8);
    expect(create).toHaveBeenCalledOnce();
  });

  it("retries on invalid JSON with corrective feedback, then succeeds", async () => {
    create
      .mockResolvedValueOnce(completion("not json at all"))
      .mockResolvedValueOnce(completion('{"ok":true}'));
    const res = await azureFoundryProvider.callStructured({ schema, schemaName: "t", messages, maxRetries: 2 });
    expect(res.data).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
    const retryMessages = create.mock.calls[1]![0].messages;
    expect(retryMessages[retryMessages.length - 1].content).toMatch(/failed validation/i);
  });

  it("throws a clear error after exhausting retries", async () => {
    create.mockResolvedValue(completion("still not json"));
    await expect(
      azureFoundryProvider.callStructured({ schema, schemaName: "t", messages, maxRetries: 1 }),
    ).rejects.toThrow(/failed after 2 attempts/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("requests json_object mode and injects a JSON instruction when the prompt lacks one", async () => {
    create.mockResolvedValueOnce(completion('{"ok":true}'));
    await azureFoundryProvider.callStructured({
      schema,
      schemaName: "t",
      messages: [{ role: "user", content: "no keyword here" }],
    });
    const args = create.mock.calls[0]![0];
    expect(args.response_format).toEqual({ type: "json_object" });
    expect(args.messages[0].content).toMatch(/json/i);
  });
});
