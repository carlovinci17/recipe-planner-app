import type { NextRequest } from "next/server";

/** First value of a possibly comma-separated forwarded header (`"a, b"` → `"a"`). */
function firstForwarded(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

/** Drop any `:port` suffix, leaving the bare hostname. */
function hostnameOf(hostHeader: string): string {
  return hostHeader.replace(/:\d+$/, "");
}

/**
 * `request.nextUrl` rebuilt with the **public** origin — for redirects behind a
 * reverse proxy.
 *
 * Azure Container Apps terminates TLS at its ingress and forwards plain HTTP to
 * the container on `0.0.0.0:3000`. The ingress serves the public site on 443/80,
 * so a redirect must target the public host with **no** `:3000`.
 *
 * ## Detecting "actually behind the proxy"
 *
 * The hard part is knowing when to rewrite, because rewriting means dropping
 * the port — correct behind the ingress, and wrong locally where `:3000` is the
 * only way back to the dev server.
 *
 * An earlier version keyed off the mere *presence* of `x-forwarded-host` /
 * `x-forwarded-proto`. That looks right and isn't: **Next.js sets those headers
 * itself in development**, so every local redirect was rewritten to
 * `http://localhost/login` (port 80) and went nowhere.
 *
 * So presence is not the signal. Two things are:
 *
 *   - a forwarded host naming a *different* hostname than the request URL —
 *     which is what an ingress in front of the container looks like; or
 *   - `x-forwarded-proto: https` — the ingress terminates TLS, and the dev
 *     server only ever reports `http`.
 *
 * `x-forwarded-proto` is still honoured on its own whenever present, because it
 * only ever says http or https and cannot strand a redirect on the wrong port.
 *
 * SECURITY: this trusts `x-forwarded-*`, which is safe here because the
 * Container Apps ingress is the only entry point and sets these headers. Don't
 * expose the container directly to untrusted clients without host allowlisting.
 *
 * Covered by tests/unit/url.test.ts — this function has eight call sites, all
 * of them auth redirects, and it has broken sign-in in both directions now.
 */
export function publicUrl(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  const forwardedHost = firstForwarded(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstForwarded(request.headers.get("x-forwarded-proto"));

  // Safe unconditionally: http vs https only, never the port.
  if (forwardedProto) url.protocol = `${forwardedProto}:`;

  const candidate = forwardedHost ?? request.headers.get("host") ?? undefined;
  const candidateHostname = candidate ? hostnameOf(candidate) : undefined;

  const behindProxy =
    (candidateHostname !== undefined && candidateHostname !== url.hostname) ||
    forwardedProto === "https";

  if (behindProxy && candidateHostname) {
    url.hostname = candidateHostname;
    url.port = ""; // ingress serves the default 443/80, not the container's 3000
  }

  return url;
}
