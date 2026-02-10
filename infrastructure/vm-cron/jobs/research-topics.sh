#!/bin/bash
# research-topics.sh — Process hot topic research queue.
# Runs hourly at :45 (30 min after news-ingest at :15).
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Topic Research ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Apply database migrations (in case 032_topic_research.sql is new)
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" research

# Process research queue
cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py research-topics --max-items 5

echo "=== Topic Research complete ==="
