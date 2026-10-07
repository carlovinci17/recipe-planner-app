import { test as setup, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cookieNameFor, loadFixtures, mintSessionToken } from "./session";

export const STORAGE_STATE = "tests/e2e/.auth/state.json";

/**
 * Write a signed-in browser state once, which every other project reuses via
 * `storageState`. Playwright then starts each test already authenticated, with
 * no sign-in steps and no shared mutable session between specs.
 */
setup("authenticate", async ({ baseURL, request }) => {
  const base = baseURL ?? "http://localhost:3000";
  const name = cookieNameFor(base);
  const fixtures = await loadFixtures();
  const token = await mintSessionToken(fixtures, name);

  const { hostname, protocol } = new URL(base);
  const state = {
    cookies: [
      {
        name,
        value: token,
        domain: hostname,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 60 * 30,
        httpOnly: true,
        // The `__Secure-` prefix is only honoured on a secure cookie, and the
        // name we chose above depends on the scheme — so these must agree.
        secure: protocol === "https:",
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };

  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  writeFileSync(STORAGE_STATE, JSON.stringify(state, null, 2));

  // Fail here rather than in every spec if the token is not actually accepted:
  // a wrong AUTH_SECRET or cookie name produces a silent redirect to /login,
  // and debugging that from a dozen failing specs is miserable.
  const res = await request.get(`${base}/recipes`, {
    headers: { cookie: `${name}=${token}` },
    maxRedirects: 0,
  });
  expect(
    res.status(),
    "minted session was rejected — check AUTH_SECRET matches the running app",
  ).toBe(200);
});
