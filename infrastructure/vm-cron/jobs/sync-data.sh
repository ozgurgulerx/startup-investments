#!/bin/bash
# sync-data.sh — Sync blob storage data, commit, push, and deploy frontend.
# Replaces: .github/workflows/sync-data.yml (scheduled runs)
#
# After syncing and pushing, triggers frontend-deploy.sh on this VM
# (previously relied on GitHub Actions frontend-deploy.yml).
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Sync Data ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Azure CLI login (managed identity, for blob storage access)
az_login() {
    for i in 1 2 3; do
        if az login --identity --output none 2>/dev/null; then
            return 0
        fi
        sleep 2
    done
    return 1
}
if ! az_login; then
    echo "ERROR: Azure managed identity login failed (needed for blob storage access)"
    exit 1
fi

cd "$REPO_DIR/packages/analysis"

# Step 1: Check for changes
echo "Checking blob storage for changes..."
SYNC_CHECK_LOG="/tmp/sync-changes.txt"
"$VENV_DIR/bin/python" -m src.sync.blob_sync --check --target "$REPO_DIR/apps/web/data" > "$SYNC_CHECK_LOG" 2>&1
cat "$SYNC_CHECK_LOG"

ADDED=$(grep "Added:" "$SYNC_CHECK_LOG" 2>/dev/null | awk '{print $2}' || echo "0")
MODIFIED=$(grep "Modified:" "$SYNC_CHECK_LOG" 2>/dev/null | awk '{print $2}' || echo "0")
TOTAL=$((ADDED + MODIFIED))

if [ "$TOTAL" -eq 0 ]; then
    echo "No changes detected. Done."
    exit 0
fi

echo "Found $TOTAL changes ($ADDED added, $MODIFIED modified). Syncing..."

# Step 2: Sync data from blob storage
"$VENV_DIR/bin/python" -m src.sync.blob_sync --target "$REPO_DIR/apps/web/data" --manifest

# Step 2.25: Validate that the synced analysis_store has vertical_taxonomy populated.
# If missing/incomplete, attempt an LLM-only backfill (no crawling) and re-check.
check_taxonomy() {
    local region="$1"
    local period_dir="$2"
    local period="$3"

    if [ -z "$period" ]; then
        return 0
    fi

    echo "Checking vertical_taxonomy completeness (region=$region period=$period)..."
    if "$VENV_DIR/bin/python" "$REPO_DIR/scripts/check-vertical-taxonomy.py" --period "$period" --region "$region"; then
        return 0
    fi

    echo "vertical_taxonomy incomplete; attempting backfill (region=$region period=$period)..."
    if [ -z "${AZURE_OPENAI_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
        echo "ERROR: Missing AZURE_OPENAI_API_KEY/OPENAI_API_KEY; cannot run LLM backfill for vertical_taxonomy."
        return 1
    fi
    "$VENV_DIR/bin/python" "$REPO_DIR/scripts/backfill-vertical-taxonomy.py" --period "$period" --region "$region" --only-incomplete --max-failures 20

    echo "Re-checking vertical_taxonomy (region=$region period=$period)..."
    "$VENV_DIR/bin/python" "$REPO_DIR/scripts/check-vertical-taxonomy.py" --period "$period" --region "$region"
}

# Latest global period
GLOBAL_PERIOD="$(ls -1 "$REPO_DIR/apps/web/data" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}$' | sort -r | head -n 1 || true)"
check_taxonomy "global" "$REPO_DIR/apps/web/data" "$GLOBAL_PERIOD"

# Latest Turkey period (optional)
TR_PERIOD="$(ls -1 "$REPO_DIR/apps/web/data/tr" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}$' | sort -r | head -n 1 || true)"
if [ -n "$TR_PERIOD" ]; then
    check_taxonomy "tr" "$REPO_DIR/apps/web/data/tr" "$TR_PERIOD"
fi

# Step 2.5: Materialize analysis_store into Postgres for DB-driven Dealbook filters.
# This makes vertical_taxonomy (and other analysis_data fields) queryable via the backend API.
if [ -n "${DATABASE_URL:-}" ]; then
    echo "Applying startup migrations..."
    bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" startups

    # Keep DB in sync with the on-disk datasets:
    # 1) Upsert startup rows from startups.csv via admin API
    # 2) Populate startups.analysis_data from analysis_store JSONs
    #
    # This is required so region-aware Dealbook/Dossiers can use the API for both global + turkey.
    if [ -n "${API_URL:-}" ] && [ -n "${API_KEY:-}" ] && [ -n "${ADMIN_KEY:-}" ]; then
        # Global dataset
        if [ -n "$GLOBAL_PERIOD" ] && [ -f "$REPO_DIR/apps/web/data/$GLOBAL_PERIOD/input/startups.csv" ]; then
            echo "Syncing startups.csv to API (region=global period=$GLOBAL_PERIOD)..."
            "$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync-startups-to-api.py" \
              --csv "$REPO_DIR/apps/web/data/$GLOBAL_PERIOD/input/startups.csv" \
              --region global
            echo "Populating analysis_data (region=global period=$GLOBAL_PERIOD)..."
            "$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" --period "$GLOBAL_PERIOD" --region global
        else
            echo "WARN: Global startups.csv not found for period $GLOBAL_PERIOD; skipping global DB sync."
        fi

        # Turkey dataset (optional)
        if [ -n "$TR_PERIOD" ] && [ -f "$REPO_DIR/apps/web/data/tr/$TR_PERIOD/input/startups.csv" ]; then
            echo "Syncing startups.csv to API (region=turkey period=$TR_PERIOD)..."
            "$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync-startups-to-api.py" \
              --csv "$REPO_DIR/apps/web/data/tr/$TR_PERIOD/input/startups.csv" \
              --region turkey
            echo "Populating analysis_data (region=turkey period=$TR_PERIOD)..."
            "$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" --period "$TR_PERIOD" --region turkey
        else
            echo "INFO: Turkey startups.csv not found for period $TR_PERIOD; skipping turkey DB sync."
        fi

        echo "DB startup sync complete."
    else
        echo "WARN: API_URL/API_KEY/ADMIN_KEY not set; skipping /api/admin/sync-startups (DB may miss new startups)."

        # Still attempt to populate analysis_data for existing rows (best-effort).
        if [ -n "$GLOBAL_PERIOD" ]; then
            "$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" --period "$GLOBAL_PERIOD" --region global || true
        fi
        if [ -n "$TR_PERIOD" ]; then
            "$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" --period "$TR_PERIOD" --region turkey || true
        fi
    fi
else
    echo "WARN: DATABASE_URL not set; skipping DB populate."
fi

# Step 3: Pull latest to avoid conflicts, then commit and push
# Serialize git operations with code-update/slack-commit-notify.
GIT_LOCK_FILE="/tmp/buildatlas-git.lock"
exec 201>"$GIT_LOCK_FILE"
flock -w 120 201

cd "$REPO_DIR"
git pull --rebase origin main 2>/dev/null || git pull origin main

git add apps/web/data/

if git diff --staged --quiet; then
    echo "No git changes after sync. Done."
    exit 0
fi

TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M UTC")
git config user.email "buildatlas-vm[bot]@users.noreply.github.com"
git config user.name "buildatlas-vm[bot]"
git commit -m "Sync blob storage data ($TOTAL updates)

Synced at: $TIMESTAMP
Trigger: vm-cron sync-data"

git push origin main

# Release lock early (deploy can take time).
exec 201>&-

echo "Pushed $TOTAL changes. Triggering frontend deploy..."

# Deploy frontend directly on VM (no longer relies on GitHub Actions)
"$SCRIPT_DIR/../lib/runner.sh" frontend-deploy 20 "$SCRIPT_DIR/frontend-deploy.sh"

echo "=== Sync Data complete ==="
