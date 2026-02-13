# Build stage — context must be repo root (for pnpm workspace lockfile resolution)
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copy workspace config + lockfile first (layer cached when only source changes)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json

# Install API deps only
RUN pnpm install --frozen-lockfile --filter @startup-investments/api

# Copy API source and build
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src/ apps/api/src/
RUN cd apps/api && pnpm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# pnpm --filter installs produce workspace-aware symlinks. Keep both the
# workspace root node_modules store and package-local node_modules links.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

WORKDIR /app/apps/api

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
