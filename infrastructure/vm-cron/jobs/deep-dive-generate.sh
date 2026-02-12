#!/bin/bash
# deep-dive-generate.sh — Weekly deep dive generation for signals.
# Runs after signal aggregation to compute occurrence scores and
# generate deep dives with LLM-extracted moves and synthesis.
# Schedule: Wednesday 07:00 UTC (after signal aggregation Mon/Tue)
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Deep Dive Generation ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Step 1: Compute per-startup occurrence scores (deterministic, zero LLM)
echo "Computing signal occurrences..."
"$VENV_DIR/bin/python" main.py compute-signal-occurrences

# Step 2: Generate deep dives (move extraction + synthesis, uses LLM)
echo "Generating deep dives..."
"$VENV_DIR/bin/python" main.py generate-deep-dives --top-n 15

echo "=== Deep Dive Generation complete ==="
