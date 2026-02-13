# apps/web/Dockerfile — Multi-stage build for the Next.js frontend.
#
# Build context MUST be the repo root (not apps/web/) because the monorepo
# workspace depends on packages/shared and uses outputFileTracingRoot: '../../'.
#
# Build:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_BUILD_SHA=$(git rev-parse --short HEAD) -t buildatlas-web .
#   az acr build --registry aistartuptr --image buildatlas-web:latest --file apps/web/Dockerfile .
#
# Run:
#   docker run -p 3000:8080 -e HOSTNAME=0.0.0.0 buildatlas-web

# ---- Stage 1: Install dependencies ----
FROM node:20-alpine AS deps

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copy only files needed for dependency resolution (maximizes layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

# Install all deps (including devDependencies needed for build)
RUN pnpm install --frozen-lockfile

# ---- Stage 2: Build ----
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copy deps from stage 1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy shared package source (workspace dependency)
COPY packages/shared/ packages/shared/

# Copy web app source
COPY apps/web/ apps/web/

# Build-time env vars (baked into client JS bundles)
ARG NEXT_PUBLIC_API_URL=https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net
ARG NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_POSTHOG_AUTOCAPTURE=false
ARG NEXT_PUBLIC_POSTHOG_CAPTURE_PAGELEAVE=false
ARG NEXT_PUBLIC_POSTHOG_CAPTURE_DEAD_CLICKS=false
ARG NEXT_PUBLIC_POSTHOG_CAPTURE_EXCEPTIONS=true
ARG NEXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE=0.03
ARG NEXT_PUBLIC_CLARITY_PROJECT_ID=
ARG NEXT_PUBLIC_BUILD_SHA=unknown

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_AUTOCAPTURE=$NEXT_PUBLIC_POSTHOG_AUTOCAPTURE
ENV NEXT_PUBLIC_POSTHOG_CAPTURE_PAGELEAVE=$NEXT_PUBLIC_POSTHOG_CAPTURE_PAGELEAVE
ENV NEXT_PUBLIC_POSTHOG_CAPTURE_DEAD_CLICKS=$NEXT_PUBLIC_POSTHOG_CAPTURE_DEAD_CLICKS
ENV NEXT_PUBLIC_POSTHOG_CAPTURE_EXCEPTIONS=$NEXT_PUBLIC_POSTHOG_CAPTURE_EXCEPTIONS
ENV NEXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE=$NEXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE
ENV NEXT_PUBLIC_CLARITY_PROJECT_ID=$NEXT_PUBLIC_CLARITY_PROJECT_ID
ENV NEXT_PUBLIC_BUILD_SHA=$NEXT_PUBLIC_BUILD_SHA
# Next.js standalone output needs this
ENV NEXT_TELEMETRY_DISABLED=1

# Run prebuild (generate-briefings) + next build
RUN cd apps/web && npx tsx scripts/generate-briefings.ts && npx next build

# ---- Stage 3: Production runtime ----
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Azure App Service Linux containers default to port 8080
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone server output (includes all traced dependencies — no symlinks)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./

# Copy static assets (not included in standalone output)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Copy public folder
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Copy data directory for API-down fallback (exclude raw_content to save ~58MB)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/data ./apps/web/data

USER nextjs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

# Next.js standalone server entry point
CMD ["node", "apps/web/server.js"]
