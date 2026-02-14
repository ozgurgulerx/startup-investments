# BuildAtlas pipelines image (AKS CronJobs).
#
# Goal: run the existing VM cron job scripts inside AKS with minimal drift.
# Layout mirrors the VM:
#   - Repo: /opt/buildatlas/startup-analysis
#   - Venv: /opt/buildatlas/venv
#
# Build context: repo root (.)
# Build: docker build -f infrastructure/pipelines/Dockerfile -t buildatlas-pipelines:latest .

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


FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

# Runtime deps:
# - bash: vm-cron job scripts
# - util-linux: flock
# - curl + ca-certs: dealbook-brief (HTTP) + general egress
# - git: optional (runner derives SHA/repo when available)
# - libxml2/libxslt/libffi: runtime libs for lxml stack
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash curl git util-linux ca-certificates \
    libxml2 libxslt1.1 libffi8 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /opt/buildatlas/venv /opt/buildatlas/venv

ENV PATH=/opt/buildatlas/venv/bin:/usr/local/bin:/usr/bin:/bin

WORKDIR /opt/buildatlas/startup-analysis

# Minimal repo subset needed to run pipeline jobs.
COPY packages/analysis/ ./packages/analysis/
COPY scripts/ ./scripts/
COPY database/migrations/ ./database/migrations/
COPY infrastructure/vm-cron/ ./infrastructure/vm-cron/

# Defensive: some build environments may check out with CRLF line endings even
# when the repo enforces LF via .gitattributes. CR bytes can break bash options
# (e.g. `set -euo pipefail` -> `pipefail\r`).
RUN python - <<'PY'
from __future__ import annotations

import sys
from pathlib import Path

roots = [
    Path("scripts"),
    Path("infrastructure") / "vm-cron",
]

shell_scripts: list[Path] = []
for root in roots:
    if root.exists():
        shell_scripts.extend(root.rglob("*.sh"))

normalized = 0
bad: list[str] = []

for path in shell_scripts:
    data = path.read_bytes()
    if b"\r" in data:
        new = data.replace(b"\r\n", b"\n").replace(b"\r", b"")
        path.write_bytes(new)
        normalized += 1

    if b"\r" in path.read_bytes():
        bad.append(str(path))

if bad:
    sys.stderr.write("CRLF normalization failed for: " + ", ".join(bad) + "\n")
    raise SystemExit(1)

print(f"Shell script EOL check: {len(shell_scripts)} checked, {normalized} normalized")
PY

# Default: no-op. CronJobs set command/args.
CMD ["bash", "-lc", "echo 'buildatlas-pipelines image: ready' && sleep 3600"]
