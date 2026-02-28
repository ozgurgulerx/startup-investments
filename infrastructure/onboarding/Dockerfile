# BuildAtlas onboarding image — full startup analysis pipeline on AKS.
#
# Like the pipelines image but adds:
#   - Playwright + Chromium (JS-rendered site crawling)
#   - apps/web/data/ baked in (CSV + existing analysis store for delta detection)
#
# Build context: repo root (.)
# Build: docker build -f infrastructure/onboarding/Dockerfile -t buildatlas-onboarding:latest .

FROM python:3.11-slim AS deps

ENV PIP_DISABLE_PIP_VERSION_CHECK=1

# Build deps for lxml/trafilatura/etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libxml2-dev libxslt1-dev libffi-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Create venv first so pip installs land in a stable path we can copy.
RUN python -m venv /opt/buildatlas/venv
ENV PATH=/opt/buildatlas/venv/bin:$PATH

COPY packages/analysis/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Install Playwright + Chromium for JS-rendered site crawling
RUN pip install --no-cache-dir playwright \
    && playwright install chromium \
    && playwright install-deps chromium


FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

# Runtime deps:
# - bash: vm-cron job scripts
# - util-linux: flock
# - curl + ca-certs: HTTP egress
# - git: optional (runner derives SHA/repo when available)
# - libxml2/libxslt/libffi: runtime libs for lxml stack
# - Chromium runtime deps (libnss3, libatk, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash curl git util-linux ca-certificates \
    libxml2 libxslt1.1 libffi8 \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /opt/buildatlas/venv /opt/buildatlas/venv

# Copy Playwright browsers from deps stage
COPY --from=deps /root/.cache/ms-playwright /root/.cache/ms-playwright

ENV PATH=/opt/buildatlas/venv/bin:/usr/local/bin:/usr/bin:/bin
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

WORKDIR /opt/buildatlas/startup-analysis

# Minimal repo subset needed to run pipeline jobs.
COPY packages/analysis/ ./packages/analysis/
COPY scripts/ ./scripts/
COPY database/migrations/ ./database/migrations/
COPY infrastructure/vm-cron/ ./infrastructure/vm-cron/

# Bake in CSV + existing analysis store for delta detection on restart.
COPY apps/web/data/ ./apps/web/data/

# Defensive: normalize CRLF line endings in shell scripts.
COPY infrastructure/pipelines/normalize_crlf.py /tmp/normalize_crlf.py
RUN python /tmp/normalize_crlf.py

# Default: no-op. Job manifest sets command/args.
CMD ["bash", "-lc", "echo 'buildatlas-onboarding image: ready' && sleep 3600"]
