#!/bin/bash
# weekly-brief.sh — Generate weekly briefs for all regions.
# Schedule: Monday 06:00 UTC
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Weekly Brief Generation ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Apply database migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"

# Generate global weekly brief
echo ""
echo "--- Global Weekly Brief ---"
"$VENV_DIR/bin/python" main.py generate-weekly-brief --region global || echo "Warning: global weekly brief failed"

# Generate Turkey weekly brief
echo ""
echo "--- Turkey Weekly Brief ---"
"$VENV_DIR/bin/python" main.py generate-weekly-brief --region turkey || echo "Warning: turkey weekly brief failed"

echo ""
echo "=== Weekly Brief Generation complete ==="
