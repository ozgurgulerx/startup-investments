#!/bin/bash
# investor-onboarding.sh — Consume investor_onboarding_queue with budget caps.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
BATCH_SIZE="${INVESTOR_ONBOARDING_BATCH_SIZE:-10}"
MAX_CONCURRENT="${INVESTOR_ONBOARDING_MAX_CONCURRENT:-3}"

echo "=== Investor Onboarding ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

ENABLED_RAW="${INVESTOR_ONBOARDING_ENABLED:-false}"
ENABLED="$(echo "$ENABLED_RAW" | tr '[:upper:]' '[:lower:]')"
if [ "$ENABLED" = "0" ] || [ "$ENABLED" = "false" ] || [ "$ENABLED" = "no" ] || [ "$ENABLED" = "off" ]; then
  echo "Investor onboarding disabled via INVESTOR_ONBOARDING_ENABLED=${ENABLED_RAW}"
  exit 0
fi

# Ensure schema is present.
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py consume-investor-onboarding --batch-size "$BATCH_SIZE" --max-concurrent "$MAX_CONCURRENT"

echo "=== Investor Onboarding complete ==="

