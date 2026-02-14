#!/bin/bash
# embed-backfill.sh — Hourly embedding backfill for news clusters.
# Embeds clusters missing vectors, then populates related_cluster_ids.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

LIMIT="${EMBED_BACKFILL_LIMIT:-500}"
ORDER="${EMBED_BACKFILL_ORDER:-newest}"
SLEEP_MS="${EMBED_BACKFILL_SLEEP_MS:-100}"

RELATED_LIMIT="${EMBED_BACKFILL_RELATED_LIMIT:-$LIMIT}"
RELATED_DAYS="${EMBED_BACKFILL_RELATED_DAYS:-7}"
RELATED_SLEEP_MS="${EMBED_BACKFILL_RELATED_SLEEP_MS:-200}"

DRY_RUN_RAW="${EMBED_BACKFILL_DRY_RUN:-false}"
DRY_RUN="$(echo "$DRY_RUN_RAW" | tr '[:upper:]' '[:lower:]')"

echo "=== Embedding Backfill ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Config: dry_run=${DRY_RUN_RAW} limit=${LIMIT} order=${ORDER} sleep_ms=${SLEEP_MS}"

cd "$REPO_DIR/packages/analysis"

DRY_ARGS=()
if [ "$DRY_RUN" = "1" ] || [ "$DRY_RUN" = "true" ] || [ "$DRY_RUN" = "yes" ] || [ "$DRY_RUN" = "on" ]; then
    echo "Dry-run mode enabled: will not call Azure OpenAI or populate related clusters."
    DRY_ARGS=(--dry-run)
fi

# Embed unembedded clusters (capped per run, throttled)
"$VENV_DIR/bin/python" main.py embed-backfill \
    --limit "$LIMIT" \
    --order "$ORDER" \
    --sleep-ms "$SLEEP_MS" \
    --no-populate-related \
    "${DRY_ARGS[@]}"

# Populate related clusters for recent embeddings (once daily at 03:xx UTC)
HOUR=$(date -u +%H)
if [ -n "${DRY_ARGS[*]:-}" ]; then
    echo "Skipping related-cluster population (dry-run mode)."
elif [ "$HOUR" = "03" ]; then
    echo "Running related-cluster population (daily)..."
    "$VENV_DIR/bin/python" main.py embed-backfill \
        --limit "$RELATED_LIMIT" \
        --order "$ORDER" \
        --days "$RELATED_DAYS" \
        --sleep-ms "$RELATED_SLEEP_MS" \
        --populate-related
fi

echo "=== Embedding Backfill complete ==="
