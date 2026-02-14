#!/bin/bash
# onboarding-eod-report.sh — Post end-of-day onboarding/graph/news relationship report to Slack.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/buildatlas/startup-analysis}"
VENV_DIR="${VENV_DIR:-/opt/buildatlas/venv}"

cd "$REPO_DIR"

BODY="$("$VENV_DIR/bin/python" scripts/onboarding_eod_report.py --max-items 15 --slack-max-chars 3400)"

echo ""
echo "=== EOD report body ==="
echo "$BODY"
echo "=== /EOD report body ==="

SLACK_TITLE="EOD Onboarding/Graph/News Report (UTC $(date -u '+%Y-%m-%d'))" \
SLACK_STATUS="info" \
SLACK_BODY="$BODY" \
"$VENV_DIR/bin/python" "$REPO_DIR/scripts/slack_notify.py"

