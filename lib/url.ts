import type { NextRequest } from "next/server";

/**
 * `request.nextUrl` but with the **public** host/proto taken from the proxy's
 * forwarded headers.
 *
 * Behind Azure Container Apps, TLS is terminated at the ingress and plain HTTP
 * is forwarded to the container on `0.0.0.0:3000`, so `request.nextUrl`'s host
 * is that internal address. Building a redirect from it sends the browser to
 * `http://0.0.0.0:3000/...` (unreachable → SSL error). This restores the real
 * public origin so redirects work behind the proxy.
 */
export function publicUrl(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto");
  if (host) url.host = host;
  if (proto) url.protocol = `${proto}:`;
  return url;
}
