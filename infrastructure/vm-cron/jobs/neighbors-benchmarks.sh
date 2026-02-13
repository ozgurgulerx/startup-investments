#!/bin/bash
# neighbors-benchmarks.sh — Compute startup neighbors and cohort benchmarks.
# Weekly job (e.g., Thu 07:00 UTC) — runs after state snapshots are current.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

# Apply database migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" benchmarks

echo "=== Neighbors & Benchmarks Computation ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Determine current period (YYYY-MM)
PERIOD=$(date -u '+%Y-%m')

# Compute neighbors (global)
echo "Computing neighbors for global (period=$PERIOD, k=10)..."
"$VENV_DIR/bin/python" main.py compute-neighbors --period "$PERIOD" --region global --k 10 || echo "Global neighbors failed (non-fatal)"

# Compute neighbors (turkey)
echo "Computing neighbors for turkey (period=$PERIOD, k=10)..."
"$VENV_DIR/bin/python" main.py compute-neighbors --period "$PERIOD" --region turkey --k 10 || echo "Turkey neighbors failed (non-fatal)"

# Compute benchmarks (global)
echo "Computing benchmarks for global (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py compute-benchmarks --period "$PERIOD" --region global || echo "Global benchmarks failed (non-fatal)"

# Compute benchmarks (turkey)
echo "Computing benchmarks for turkey (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py compute-benchmarks --period "$PERIOD" --region turkey || echo "Turkey benchmarks failed (non-fatal)"

echo "=== Neighbors & Benchmarks complete ==="
