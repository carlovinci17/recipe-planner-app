import type { NextConfig } from "next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require("./package.json") as { version: string };

const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    // Rendered in the app-shell footer. Read from GIT_SHA, which the Dockerfile
    // takes as a build arg and CI fills from `github.sha` — it has to be a build
    // arg because NEXT_PUBLIC_ values are inlined into the client bundle, where
    // a Container App runtime variable cannot reach them.
    //
    // This used to read VERCEL_GIT_COMMIT_SHA, so after the move to Azure it was
    // permanently "" and the footer silently dropped the commit.
    NEXT_PUBLIC_GIT_SHA: process.env.GIT_SHA?.slice(0, 7) ?? "",
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },
  images: {
    minimumCacheTTL: 3600,
    remotePatterns: [
      // Recipe images are NOT here: Azure Blob is keyless, so they are served
      // by our own /api/images route rather than fetched from a remote host.
      // These two are external avatars and placeholder photography.
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  serverExternalPackages: [
    "pdfjs-dist",
    "sharp",
    "pino",
    "@napi-rs/canvas",
    "@azure/monitor-opentelemetry",
    // Agent stack (Module 12) — heavy Node packages the bundler shouldn't inline.
    "langchain",
    "@langchain/core",
    "@langchain/langgraph",
    "@langchain/langgraph-supervisor",
    "@langchain/openai",
    "@langfuse/core",
    "@langfuse/langchain",
    "@langfuse/otel",
    "@opentelemetry/sdk-node",
  ],
  // pdfjs-dist loads its worker via a runtime string reference that Vercel's
  // file tracer can't see. Explicitly include it so it's present in the
  // serverless function bundle.
  outputFileTracingIncludes: {
    "**": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  logging: {
    fetches: { fullUrl: false },
  },
};

export default config;
