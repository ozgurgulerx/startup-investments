#!/bin/bash
# generate-weekly-digest.sh — Generate weekly digest for all regions.
# Runs weekly (Monday 06:00 UTC).
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Generate Weekly Digest ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Generate weekly digest for global
echo "Generating weekly digest for global..."
"$VENV_DIR/bin/python" main.py generate-weekly-digest --scope global || echo "Global weekly digest failed (non-fatal)"

# Generate weekly digest for turkey
echo "Generating weekly digest for turkey..."
"$VENV_DIR/bin/python" main.py generate-weekly-digest --scope turkey || echo "Turkey weekly digest failed (non-fatal)"

echo "=== Generate Weekly Digest complete ==="
