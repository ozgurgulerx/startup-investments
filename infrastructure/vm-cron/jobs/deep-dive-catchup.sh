#!/bin/bash
# deep-dive-catchup.sh — Backfill missing deep dives so the UI isn't empty.
# Strategy: coverage-first (trend-only synthesis) + optional deep-research enqueue.
# Schedule: see infrastructure/vm-cron/crontab (UTC)
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Deep Dive Catchup ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Ensure deep-dive tables/indexes exist before pipeline steps run.
echo "Applying required migrations..."
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"

echo "Backfilling missing deep dives (coverage mode)..."
"$VENV_DIR/bin/python" main.py backfill-deep-dives \
  --mode coverage \
  --limit 50 \
  --enqueue-research \
  --research-per-signal 1 \
  --research-depth quick

echo "=== Deep Dive Catchup complete ==="

