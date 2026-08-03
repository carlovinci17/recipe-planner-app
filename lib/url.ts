import type { NextRequest } from "next/server";

/** First value of a possibly comma-separated forwarded header (`"a, b"` → `"a"`). */
function firstForwarded(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

/**
 * `request.nextUrl` rebuilt with the **public** origin — for redirects behind a
 * reverse proxy.
 *
 * Azure Container Apps terminates TLS at its ingress and forwards plain HTTP to
 * the container on `0.0.0.0:3000`, so `request.nextUrl` carries that internal
 * host *and* port. A redirect built from it sends the browser to
 * `http://0.0.0.0:3000/…` or `https://<fqdn>:3000/…` — both unreachable (the
 * ingress serves on 443). We take the origin from the proxy's forwarded headers.
 *
 * SECURITY: this trusts `x-forwarded-*`, which is safe here because the Container
 * Apps ingress is the only entry point and sets these headers. Don't expose the
 * container directly to untrusted clients without host allowlisting.
 */
export function publicUrl(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  const host = firstForwarded(request.headers.get("x-forwarded-host")) ?? request.headers.get("host");
  const proto = firstForwarded(request.headers.get("x-forwarded-proto"));
  if (host) {
    url.hostname = host.replace(/:\d+$/, ""); // hostname only — strip any :port
    url.port = ""; // ingress serves on the default 443/80, not the container's 3000
  }
  if (proto) url.protocol = `${proto}:`;
  return url;
}
