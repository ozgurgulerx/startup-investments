#!/bin/bash
# signal-aggregate.sh — Daily signal aggregation.
# Runs after news-ingest to aggregate events into signals,
# score them, and update lifecycle statuses.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Signal Aggregation ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Seed event_registry (36 types incl. analysis_diff) and pattern_registry (26 patterns)
# Idempotent (ON CONFLICT DO NOTHING / DO UPDATE) — safe to run every time
echo "Seeding event/pattern registries..."
"$VENV_DIR/bin/python" main.py seed-signals

# Step 1: Backfill state snapshots from analysis_data
# Extracts structured state, computes diffs, emits transition events
echo "Backfilling state snapshots..."
"$VENV_DIR/bin/python" main.py backfill-state --diffs --events --no-embeddings || echo "State backfill failed (non-fatal)"

# Step 2: Run signal aggregation for both regions
# Picks up analysis_diff events emitted by state backfill
"$VENV_DIR/bin/python" main.py aggregate-signals --lookback-days 30

echo "=== Signal Aggregation complete ==="
