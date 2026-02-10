# Analysis pipeline Dockerfile — Python 3.11 + Scrapy + Playwright + Chromium
#
# Build context: repo root (.)
# Build: az acr build --registry aistartuptr --image startup-analysis:latest -f packages/analysis/Dockerfile .
#
# Two-stage build:
#   1. deps — install Python deps + Playwright browsers
#   2. runtime — slim image with just what's needed

# ---------------------------------------------------------------------------
# Stage 1: Dependencies
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libxml2-dev libxslt1-dev libffi-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY packages/analysis/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install chromium \
    && playwright install-deps chromium

# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

# Install runtime libraries needed by lxml, Playwright/Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 libxslt1.1 libffi8 \
    # Chromium runtime deps
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages
COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy Playwright browsers
COPY --from=deps /root/.cache/ms-playwright /root/.cache/ms-playwright

WORKDIR /app

# Copy analysis package
COPY packages/analysis/ ./packages/analysis/

# Copy web data (input CSVs + existing output for reference)
COPY apps/web/data/ ./apps/web/data/

WORKDIR /app/packages/analysis
ENV PYTHONPATH=/app/packages/analysis
ENV PYTHONUNBUFFERED=1

# Default: run analysis for Feb 2026 with deep crawl
CMD ["python", "main.py", "analyze", \
     "../../apps/web/data/2026-02/input/startups.csv", \
     "--period", "2026-02", \
     "--output", "../../apps/web/data/2026-02/output", \
     "--force-crawl", \
     "--min-content-chars", "10000", \
     "--upload-to-blob", \
     "--blob-output-prefix", "periods/2026-02/"]
