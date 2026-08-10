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
 * the container on `0.0.0.0:3000`. The ingress serves the public site on 443/80,
 * so a redirect must target the public host with **no** `:3000`. Container Apps
 * sets `X-Forwarded-Proto` (verified via MS Learn) and preserves the public host
 * in the `Host` header; an App Gateway in front may additionally send
 * `X-Forwarded-Host`.
 *
 * We only rewrite the origin when one of those forwarded headers is present —
 * i.e. when we're actually behind the proxy. Without them (local dev/prod, or a
 * direct hit) `request.nextUrl` already carries the correct `host:port`, so we
 * leave it untouched. Stripping the port unconditionally used to rewrite
 * `localhost:3000` → `localhost` (:80) and break every local redirect.
 *
 * SECURITY: this trusts `x-forwarded-*`, which is safe here because the Container
 * Apps ingress is the only entry point and sets these headers. Don't expose the
 * container directly to untrusted clients without host allowlisting.
 */
export function publicUrl(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  const forwardedHost = firstForwarded(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstForwarded(request.headers.get("x-forwarded-proto"));

  if (forwardedHost || forwardedProto) {
    const host = forwardedHost ?? request.headers.get("host");
    if (host) {
      url.hostname = host.replace(/:\d+$/, ""); // hostname only — strip any :port
      url.port = ""; // ingress serves on the default 443/80, not the container's 3000
    }
    if (forwardedProto) url.protocol = `${forwardedProto}:`;
  }
  return url;
}
