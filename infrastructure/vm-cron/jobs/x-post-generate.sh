#!/bin/bash
# x-post-generate.sh — Build candidate X posts from latest clusters.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== X Post Generate ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py generate-x-posts \
  --region "${X_POST_GENERATE_REGION:-all}" \
  --max-items "${X_POST_GENERATE_MAX_ITEMS:-6}"

echo "=== X Post Generate complete ==="
