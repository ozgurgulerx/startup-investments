#!/bin/bash
# compute-delta-events.sh — Generate delta events for all regions.
# Runs monthly (2nd of month 06:00 UTC) after investor DNA.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Compute Delta Events ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Determine current period (YYYY-MM)
PERIOD=$(date -u '+%Y-%m')

# Generate deltas for global
echo "Generating delta events for global (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py generate-deltas --period "$PERIOD" --region global || echo "Global delta events failed (non-fatal)"

# Generate deltas for turkey
echo "Generating delta events for turkey (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py generate-deltas --period "$PERIOD" --region turkey || echo "Turkey delta events failed (non-fatal)"

echo "=== Compute Delta Events complete ==="
