#!/bin/bash
# news-digest.sh — Daily digest sender for both regions.
# Replaces: .github/workflows/news-digest-daily.yml (scheduled runs)
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== News Digest ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Apply migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news-digest

cd "$REPO_DIR/packages/analysis"

set +e
echo "--- Sending global digest ---"
"$VENV_DIR/bin/python" main.py send-news-digest --region global
GLOBAL_EXIT=$?

echo "--- Sending turkey digest ---"
"$VENV_DIR/bin/python" main.py send-news-digest --region turkey
TURKEY_EXIT=$?
set -e

if [ "$GLOBAL_EXIT" -ne 0 ] || [ "$TURKEY_EXIT" -ne 0 ]; then
    echo "ERROR: Digest send failed (global=$GLOBAL_EXIT, turkey=$TURKEY_EXIT)"
    exit 1
fi

echo "=== News Digest complete ==="
