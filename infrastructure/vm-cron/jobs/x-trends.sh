#!/bin/bash
# x-trends.sh — Ingest X/Twitter trend signals into the news pipeline.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== X Trends Ingest ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Ensure social tables exist (safe no-op when already applied)
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py ingest-x-trends --lookback-hours "${X_TRENDS_LOOKBACK_HOURS:-24}"

echo "=== X Trends Ingest complete ==="
