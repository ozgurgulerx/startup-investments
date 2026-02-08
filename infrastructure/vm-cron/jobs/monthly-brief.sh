#!/bin/bash
# monthly-brief.sh — Generate monthly briefs for all regions.
# Schedule: 1st of month 06:00 UTC
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Monthly Brief Generation ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Apply database migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"

# Generate global monthly brief
echo ""
echo "--- Global Monthly Brief ---"
"$VENV_DIR/bin/python" main.py generate-monthly-brief-news --region global || echo "Warning: global monthly brief failed"

# Generate Turkey monthly brief
echo ""
echo "--- Turkey Monthly Brief ---"
"$VENV_DIR/bin/python" main.py generate-monthly-brief-news --region turkey || echo "Warning: turkey monthly brief failed"

echo ""
echo "=== Monthly Brief Generation complete ==="
