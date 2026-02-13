#!/bin/bash
# x-post-metrics.sh — Sync X post metrics into daily table.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== X Post Metrics Sync ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py sync-x-post-metrics \
  --days-back "${X_POST_METRICS_DAYS_BACK:-7}" \
  --max-posts "${X_POST_METRICS_MAX_POSTS:-100}"

echo "=== X Post Metrics Sync complete ==="
