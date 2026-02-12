#!/bin/bash
# embed-backfill.sh — Hourly embedding backfill for news clusters.
# Embeds clusters missing vectors, then populates related_cluster_ids.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Embedding Backfill ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Embed unembedded clusters (capped per run, throttled)
"$VENV_DIR/bin/python" main.py embed-backfill \
    --limit 500 \
    --order newest \
    --sleep-ms 100 \
    --no-populate-related

# Populate related clusters for recent embeddings (once daily at 03:xx UTC)
HOUR=$(date -u +%H)
if [ "$HOUR" = "03" ]; then
    echo "Running related-cluster population (daily)..."
    "$VENV_DIR/bin/python" main.py embed-backfill \
        --limit 500 \
        --order newest \
        --days 7 \
        --sleep-ms 200 \
        --populate-related
fi

echo "=== Embedding Backfill complete ==="
