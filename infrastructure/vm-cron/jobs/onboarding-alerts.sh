#!/bin/bash
# onboarding-alerts.sh — Dispatch actionable onboarding/deep-research traces to Slack.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
BATCH_SIZE="${ONBOARDING_ALERTS_BATCH_SIZE:-25}"

echo "=== Onboarding Alerts ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Batch size: ${BATCH_SIZE}"

ENABLED_RAW="${ONBOARDING_ALERTS_ENABLED:-true}"
ENABLED="$(echo "$ENABLED_RAW" | tr '[:upper:]' '[:lower:]')"
if [ "$ENABLED" = "0" ] || [ "$ENABLED" = "false" ] || [ "$ENABLED" = "no" ] || [ "$ENABLED" = "off" ]; then
  echo "Onboarding alert dispatcher disabled via ONBOARDING_ALERTS_ENABLED=${ENABLED_RAW}"
  exit 0
fi

# Ensure trace/context tables exist.
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py dispatch-onboarding-alerts --batch-size "$BATCH_SIZE"

echo "=== Onboarding Alerts complete ==="
