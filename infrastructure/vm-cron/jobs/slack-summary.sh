#!/bin/bash
# slack-summary.sh — Daily ops summary.
# Replaces: .github/workflows/slack-daily-summary.yml (scheduled runs)
set -uo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Slack Daily Summary ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR"
"$VENV_DIR/bin/python" scripts/slack_daily_summary.py

echo "=== Slack Daily Summary complete ==="
