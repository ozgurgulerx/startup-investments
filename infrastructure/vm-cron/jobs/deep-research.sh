#!/bin/bash
# deep-research.sh — Consume deep_research_queue with budget caps.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
BATCH_SIZE="${DEEP_RESEARCH_BATCH_SIZE:-8}"
MAX_CONCURRENT="${DEEP_RESEARCH_MAX_CONCURRENT:-3}"

echo "=== Deep Research ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

ENABLED_RAW="${DEEP_RESEARCH_ENABLED:-true}"
ENABLED="$(echo "$ENABLED_RAW" | tr '[:upper:]' '[:lower:]')"
if [ "$ENABLED" = "0" ] || [ "$ENABLED" = "false" ] || [ "$ENABLED" = "no" ] || [ "$ENABLED" = "off" ]; then
  echo "Deep research disabled via DEEP_RESEARCH_ENABLED=${ENABLED_RAW}"
  exit 0
fi

# Ensure queue schema is present.
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py consume-deep-research --batch-size "$BATCH_SIZE" --max-concurrent "$MAX_CONCURRENT"

echo "=== Deep Research complete ==="

