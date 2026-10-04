import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { publicUrl } from "@/lib/url";

/**
 * `publicUrl` has eight call sites and every one of them is an auth redirect,
 * so getting it wrong breaks sign-in — which it has done in both directions:
 * once by stripping the port everywhere (local redirects → port 80), once by
 * keying off header presence (Next sets x-forwarded-* in dev, so local
 * redirects → port 80 again).
 *
 * The two environments that must both work:
 *   - local dev: Next.js itself sets x-forwarded-host/proto, and :3000 is the
 *     only way back to the dev server.
 *   - Azure Container Apps: the ingress terminates TLS and forwards plain HTTP
 *     to :3000, so a redirect must name the public host with no port.
 */
function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url), { headers: new Headers(headers) });
}

describe("publicUrl — local development", () => {
  it("keeps :3000 when Next.js sets the forwarded headers itself", () => {
    // The exact regression: these headers are present locally, so treating
    // "header present" as "behind a proxy" sent every redirect to port 80.
    const url = publicUrl(
      req("http://localhost:3000/recipes", {
        host: "localhost:3000",
        "x-forwarded-host": "localhost:3000",
        "x-forwarded-proto": "http",
        "x-forwarded-port": "3000",
      }),
    );
    url.pathname = "/login";
    expect(url.toString()).toBe("http://localhost:3000/login");
    expect(url.port).toBe("3000");
  });

  it("keeps :3000 when only the proto header is present", () => {
    const url = publicUrl(
      req("http://localhost:3000/recipes", {
        host: "localhost:3000",
        "x-forwarded-proto": "http",
      }),
    );
    expect(url.host).toBe("localhost:3000");
    expect(url.protocol).toBe("http:");
  });

  it("leaves the URL untouched with no forwarded headers at all", () => {
    const url = publicUrl(req("http://localhost:3000/recipes", { host: "localhost:3000" }));
    expect(url.toString()).toBe("http://localhost:3000/recipes");
  });

  it("preserves the query string, which carries the ?next= return path", () => {
    const url = publicUrl(
      req("http://localhost:3000/recipes?page=2", {
        host: "localhost:3000",
        "x-forwarded-host": "localhost:3000",
        "x-forwarded-proto": "http",
      }),
    );
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.port).toBe("3000");
  });

  it("keeps a non-default dev port other than 3000", () => {
    const url = publicUrl(
      req("http://localhost:3001/recipes", {
        host: "localhost:3001",
        "x-forwarded-host": "localhost:3001",
        "x-forwarded-proto": "http",
      }),
    );
    expect(url.host).toBe("localhost:3001");
  });
});

describe("publicUrl — behind the Container Apps ingress", () => {
  const PUBLIC = "recipe-planner.delightfulrock-67fe0b09.australiaeast.azurecontainerapps.io";

  it("rewrites to the public https origin and drops the container port", () => {
    const url = publicUrl(
      req("http://localhost:3000/recipes", {
        host: PUBLIC,
        "x-forwarded-host": PUBLIC,
        "x-forwarded-proto": "https",
      }),
    );
    url.pathname = "/login";
    expect(url.toString()).toBe(`https://${PUBLIC}/login`);
    expect(url.port).toBe("");
  });

  it("drops the port on an https forward even without x-forwarded-host", () => {
    // Container Apps preserves the public host in `Host` and may not send
    // x-forwarded-host unless an App Gateway sits in front.
    const url = publicUrl(
      req("http://localhost:3000/recipes", {
        host: PUBLIC,
        "x-forwarded-proto": "https",
      }),
    );
    expect(url.hostname).toBe(PUBLIC);
    expect(url.port).toBe("");
    expect(url.protocol).toBe("https:");
  });

  it("strips a port carried on the forwarded host header", () => {
    const url = publicUrl(
      req("http://localhost:3000/recipes", {
        host: "localhost:3000",
        "x-forwarded-host": `${PUBLIC}:443`,
        "x-forwarded-proto": "https",
      }),
    );
    expect(url.hostname).toBe(PUBLIC);
    expect(url.port).toBe("");
  });

  it("takes the first value from a comma-separated chain of proxies", () => {
    const url = publicUrl(
      req("http://localhost:3000/recipes", {
        host: "localhost:3000",
        "x-forwarded-host": `${PUBLIC}, internal.proxy.local`,
        "x-forwarded-proto": "https, http",
      }),
    );
    expect(url.hostname).toBe(PUBLIC);
    expect(url.protocol).toBe("https:");
    expect(url.port).toBe("");
  });

  it("rewrites when the forwarded host differs, even over plain http", () => {
    // An http-only proxy in front still means the container's port is wrong.
    const url = publicUrl(
      req("http://localhost:3000/recipes", {
        host: "localhost:3000",
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "http",
      }),
    );
    expect(url.hostname).toBe("app.example.com");
    expect(url.port).toBe("");
    expect(url.protocol).toBe("http:");
  });
});
