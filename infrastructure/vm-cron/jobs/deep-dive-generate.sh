#!/bin/bash
# deep-dive-generate.sh — Deep dive generation for signals.
# Runs after signal aggregation to compute occurrence scores and
# generate deep dives with LLM-extracted moves and synthesis.
# Schedule: Daily 05:15 UTC
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Deep Dive Generation ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Ensure deep-dive tables/indexes exist before pipeline steps run.
echo "Applying required migrations..."
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"

# Step 1: Compute per-startup occurrence scores (deterministic, zero LLM)
echo "Computing signal occurrences..."
"$VENV_DIR/bin/python" main.py compute-signal-occurrences

# Step 2: Generate deep dives (move extraction + synthesis, uses LLM)
echo "Generating deep dives..."
"$VENV_DIR/bin/python" main.py generate-deep-dives --top-n 15

echo "=== Deep Dive Generation complete ==="
