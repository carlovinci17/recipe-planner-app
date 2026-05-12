import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
  } catch {
    return null;
  }
})();

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  images: {
    remotePatterns: [
      ...(supabaseHost
        ? [{ protocol: "https" as const, hostname: supabaseHost, pathname: "/storage/v1/object/**" }]
        : []),
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  serverExternalPackages: ["pdfjs-dist", "sharp", "pino", "@napi-rs/canvas"],
  logging: {
    fetches: { fullUrl: false },
  },
};

export default config;
