#!/bin/bash
# compute-benchmarks.sh — Compute extended benchmarks for all regions.
# Runs monthly (2nd of month 04:00 UTC) after data sync.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Compute Extended Benchmarks ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Determine current period (YYYY-MM)
PERIOD=$(date -u '+%Y-%m')

# Compute extended benchmarks for global
echo "Computing extended benchmarks for global (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py compute-benchmarks-extended --period "$PERIOD" --region global || echo "Global extended benchmarks failed (non-fatal)"

# Compute extended benchmarks for turkey
echo "Computing extended benchmarks for turkey (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py compute-benchmarks-extended --period "$PERIOD" --region turkey || echo "Turkey extended benchmarks failed (non-fatal)"

echo "=== Compute Extended Benchmarks complete ==="
