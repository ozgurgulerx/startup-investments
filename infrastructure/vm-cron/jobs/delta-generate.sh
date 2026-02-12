#!/bin/bash
# delta-generate.sh — Generate delta events after state backfill.
# Runs after signal-aggregate.sh to detect changes across periods.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Delta Event Generation ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Determine current period (YYYY-MM)
PERIOD=$(date -u '+%Y-%m')

# Generate deltas for both regions
echo "Generating deltas for global (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py generate-deltas --period "$PERIOD" --region global || echo "Global delta generation failed (non-fatal)"

echo "Generating deltas for turkey (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py generate-deltas --period "$PERIOD" --region turkey || echo "Turkey delta generation failed (non-fatal)"

echo "=== Delta Event Generation complete ==="
