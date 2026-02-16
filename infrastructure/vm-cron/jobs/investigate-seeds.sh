#!/bin/bash
# investigate-seeds.sh — Triage + investigate paid headline seeds, then recheck corroboration.
# Runs every 2 hours at :50 (after topic research at :40).
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Investigation Pipeline ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Apply database migrations (in case 077_investigation_queue.sql is new)
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" investigation

# Step 1: Triage + enqueue + investigate + promote
cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py investigate-seeds --max-items 5

# Step 2: Recheck corroboration for promoted investigations
"$VENV_DIR/bin/python" main.py recheck-corroboration

echo "=== Investigation Pipeline complete ==="
