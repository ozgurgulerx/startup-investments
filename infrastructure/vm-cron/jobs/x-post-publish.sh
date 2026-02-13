#!/bin/bash
# x-post-publish.sh — Publish queued X posts with caps/cooldowns.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== X Post Publish ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py publish-x-posts --max-items "${X_POST_PUBLISH_MAX_ITEMS:-5}"

echo "=== X Post Publish complete ==="
