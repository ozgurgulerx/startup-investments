#!/bin/bash
# news-digest.sh — Daily digest sender for both regions.
# Replaces: .github/workflows/news-digest-daily.yml (scheduled runs)
set -uo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== News Digest ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Apply migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news-digest

cd "$REPO_DIR/packages/analysis"

# Send for global region
echo "--- Sending global digest ---"
"$VENV_DIR/bin/python" main.py send-news-digest --region global

# Send for turkey region
echo "--- Sending turkey digest ---"
"$VENV_DIR/bin/python" main.py send-news-digest --region turkey

echo "=== News Digest complete ==="
