#!/bin/bash
# news-ingest.sh — Hourly news ingestion.
# Replaces: .github/workflows/news-ingest.yml (scheduled runs)
set -uo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== News Ingest ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Apply database migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

# Run ingestion
cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py ingest-news --lookback-hours 48

echo "=== News Ingest complete ==="
