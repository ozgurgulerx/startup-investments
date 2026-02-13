#!/bin/bash
# generate-alerts.sh — Generate user alerts for all regions.
# Runs monthly (2nd of month 07:00 UTC) after delta events.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Generate Alerts ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Determine current period (YYYY-MM)
PERIOD=$(date -u '+%Y-%m')

# Generate alerts for global
echo "Generating alerts for global (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py generate-alerts --period "$PERIOD" --scope global || echo "Global alert generation failed (non-fatal)"

# Generate alerts for turkey
echo "Generating alerts for turkey (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py generate-alerts --period "$PERIOD" --scope turkey || echo "Turkey alert generation failed (non-fatal)"

echo "=== Generate Alerts complete ==="
