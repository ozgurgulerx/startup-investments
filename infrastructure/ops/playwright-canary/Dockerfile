# Playwright-based browser canary image (AKS CronJobs).
#
# Build context: repo root (.)
# Build: docker build -f infrastructure/ops/playwright-canary/Dockerfile -t buildatlas-playwright-canary:latest .
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

RUN npm init -y >/dev/null 2>&1 \
  && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --silent playwright@1.58.2

COPY scripts/playwright_canary_landscapes.mjs ./playwright_canary_landscapes.mjs

ENV NODE_ENV=production

CMD ["node", "/app/playwright_canary_landscapes.mjs"]
