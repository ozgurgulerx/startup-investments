#!/bin/bash
# event-processor.sh — Process startup_events and enqueue gated deep-research work.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
BATCH_SIZE="${EVENT_PROCESSOR_BATCH_SIZE:-100}"

echo "=== Event Processor ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Batch size: ${BATCH_SIZE}"

# Ensure onboarding + queue migrations exist.
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py process-events --batch-size "$BATCH_SIZE"

echo "=== Event Processor complete ==="

