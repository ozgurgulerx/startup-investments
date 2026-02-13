#!/bin/bash
# compute-investor-dna.sh — Compute investor DNA profiles for all regions.
# Runs monthly (2nd of month 05:00 UTC) after benchmarks.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Compute Investor DNA ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Determine current period (YYYY-MM)
PERIOD=$(date -u '+%Y-%m')

# Compute investor DNA for global
echo "Computing investor DNA for global (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py compute-investor-dna --period "$PERIOD" --scope global || echo "Global investor DNA failed (non-fatal)"

# Compute investor DNA for turkey
echo "Computing investor DNA for turkey (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py compute-investor-dna --period "$PERIOD" --scope turkey || echo "Turkey investor DNA failed (non-fatal)"

echo "=== Compute Investor DNA complete ==="
