# syntax=docker/dockerfile:1

# ── Stage 1: deps ── install ALL deps (dev included) so we can build
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: builder ── compile the app into .next/standalone
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time values only. NEXT_PUBLIC_ values are inlined into the client bundle,
# so a Container App runtime variable cannot reach them — they must arrive here.
#
# There used to be four: the Supabase URL and anon key, plus realtime/storage
# provider gates. All four went with Supabase — storage and realtime each have
# one implementation now, and the client asks the server
# (/api/realtime/negotiate) instead of reading a flag.
#
# GIT_SHA is the one that remains: next.config.ts turns it into
# NEXT_PUBLIC_GIT_SHA for the app-shell footer. CI fills it from `github.sha`.
# Unset in a local build, which just means the footer shows no commit.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: runner ── the slim image that actually ships & runs
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
