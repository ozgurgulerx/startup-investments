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
            # Warm the Storage token cache (helps avoid rare races right after login).
            az account get-access-token --resource https://storage.azure.com/ -o none 2>/dev/null || true
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
SYNC_CHECK_LOG_RETRY="/tmp/sync-changes.retry.txt"
SYNC_CHECK_RC=0
"$VENV_DIR/bin/python" -m src.sync.blob_sync --check --target "$REPO_DIR/apps/web/data" > "$SYNC_CHECK_LOG" 2>&1 || SYNC_CHECK_RC=$?
cat "$SYNC_CHECK_LOG"

# Intermittent storage auth/network issues can surface as exit code 2.
# Retry once after re-auth to reduce flakiness without hiding persistent misconfigurations.
if [ "$SYNC_CHECK_RC" -eq 2 ]; then
    echo ""
    echo "WARN: Blob storage auth failed (exit code 2). Retrying once after az login warmup..."
    sleep 2
    if az_login; then
        SYNC_CHECK_RC_RETRY=0
        "$VENV_DIR/bin/python" -m src.sync.blob_sync --check --target "$REPO_DIR/apps/web/data" > "$SYNC_CHECK_LOG_RETRY" 2>&1 || SYNC_CHECK_RC_RETRY=$?
        echo "--- retry output ---"
        cat "$SYNC_CHECK_LOG_RETRY"
        if [ "$SYNC_CHECK_RC_RETRY" -eq 0 ]; then
            SYNC_CHECK_LOG="$SYNC_CHECK_LOG_RETRY"
            SYNC_CHECK_RC=0
        else
            SYNC_CHECK_RC="$SYNC_CHECK_RC_RETRY"
        fi
    else
        echo "WARN: Retry az login failed; continuing in degraded mode."
    fi
fi

if [ "$SYNC_CHECK_RC" -eq 2 ]; then
    echo "WARN: Blob storage auth failed (exit code 2). Change detection is degraded."
    echo "      Fix: verify (1) VM managed identity RBAC (Storage Blob Data Reader/Contributor) and"
    echo "           (2) storage account network access (publicNetworkAccess/private endpoint/VNet)."
    echo "           If the storage account has public network access disabled, the VM must reach it via a private endpoint."
    BLOB_DEGRADED=1
    TOTAL=0
elif [ "$SYNC_CHECK_RC" -ne 0 ]; then
    echo "ERROR: blob_sync --check failed with exit code $SYNC_CHECK_RC"
    exit 1
else
    BLOB_DEGRADED=0
    ADDED=$(grep "Added:" "$SYNC_CHECK_LOG" 2>/dev/null | awk '{print $2}' || echo "0")
    MODIFIED=$(grep "Modified:" "$SYNC_CHECK_LOG" 2>/dev/null | awk '{print $2}' || echo "0")
    TOTAL=$((ADDED + MODIFIED))
fi

if [ "$TOTAL" -eq 0 ]; then
    # Even if blob data hasn't changed, the DB can lag (e.g. after VM upgrades or missed runs).
    # Run a low-frequency "DB sync-only" pass so region pages (global + turkey) don't look empty.
    STATE_DIR="/var/lib/buildatlas"
    if [ ! -d "$STATE_DIR" ] || [ ! -w "$STATE_DIR" ]; then
        STATE_DIR="/tmp"
    fi
    DB_SYNC_SENTINEL="$STATE_DIR/sync-data.db-sync.last"

    if [ -n "${DATABASE_URL:-}" ]; then
        SHOULD_DB_SYNC=1
        if [ -f "$DB_SYNC_SENTINEL" ]; then
            LAST_TS="$(stat -c %Y "$DB_SYNC_SENTINEL" 2>/dev/null || echo 0)"
            AGE_SEC=$(( $(date +%s) - LAST_TS ))
            # Default: once per day
            if [ "$AGE_SEC" -lt 86400 ] 2>/dev/null; then
                SHOULD_DB_SYNC=0
            fi
        fi

        if [ "$SHOULD_DB_SYNC" -eq 1 ]; then
            echo "No blob changes detected. Running daily DB sync-only pass..."

            GLOBAL_PERIOD="$(ls -1 "$REPO_DIR/apps/web/data" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}$' | sort -r | head -n 1 || true)"
            TR_PERIOD="$(ls -1 "$REPO_DIR/apps/web/data/tr" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}$' | sort -r | head -n 1 || true)"

            bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" startups

            if [ -n "$GLOBAL_PERIOD" ] && [ -f "$REPO_DIR/apps/web/data/$GLOBAL_PERIOD/input/startups.csv" ]; then
                "$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync-startups-to-db.py" \
                  --csv "$REPO_DIR/apps/web/data/$GLOBAL_PERIOD/input/startups.csv" \
                  --region global
                "$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" --period "$GLOBAL_PERIOD" --region global
            fi

            if [ -n "$TR_PERIOD" ] && [ -f "$REPO_DIR/apps/web/data/tr/$TR_PERIOD/input/startups.csv" ]; then
                "$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync-startups-to-db.py" \
                  --csv "$REPO_DIR/apps/web/data/tr/$TR_PERIOD/input/startups.csv" \
                  --region turkey
                "$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" --period "$TR_PERIOD" --region turkey
            fi

            # Extract logos for any startups missing them
            echo "Extracting logos for startups missing them..."
            cd "$REPO_DIR/packages/analysis"
            "$VENV_DIR/bin/python" main.py extract-logos --concurrent 10 || echo "WARN: Logo extraction had errors (non-fatal)"

            touch "$DB_SYNC_SENTINEL"
            echo "DB sync-only pass complete. Done."
            exit 0
        fi
    fi

    if [ "${BLOB_DEGRADED:-0}" -eq 1 ]; then
        echo "WARN: No blob changes detected (blob auth degraded — results may be stale)."
    else
        echo "No changes detected. Done."
    fi
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

# Step 2.5: Keep Postgres in sync with the on-disk datasets (global + turkey).
# This enables region-aware API queries (Dealbook filters, company pages, stats).
if [ -n "${DATABASE_URL:-}" ]; then
    echo "Applying startup migrations..."
    bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" startups

    # 1) Upsert startup rows from startups.csv directly into Postgres.
    # (Avoids Azure Front Door timeouts on admin HTTP endpoints; period/analysis fields are set in step (2).)
    if [ -n "$GLOBAL_PERIOD" ] && [ -f "$REPO_DIR/apps/web/data/$GLOBAL_PERIOD/input/startups.csv" ]; then
        echo "Syncing startups.csv to Postgres (region=global period=$GLOBAL_PERIOD)..."
        "$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync-startups-to-db.py" \
          --csv "$REPO_DIR/apps/web/data/$GLOBAL_PERIOD/input/startups.csv" \
          --region global
    else
        echo "WARN: Global startups.csv not found for period $GLOBAL_PERIOD; skipping global upsert."
    fi

    if [ -n "$TR_PERIOD" ] && [ -f "$REPO_DIR/apps/web/data/tr/$TR_PERIOD/input/startups.csv" ]; then
        echo "Syncing startups.csv to Postgres (region=turkey period=$TR_PERIOD)..."
        "$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync-startups-to-db.py" \
          --csv "$REPO_DIR/apps/web/data/tr/$TR_PERIOD/input/startups.csv" \
          --region turkey
    else
        echo "INFO: Turkey startups.csv not found for period $TR_PERIOD; skipping turkey upsert."
    fi

    # 2) Populate analysis_data JSONB from analysis_store (region-aware).
    if [ -n "$GLOBAL_PERIOD" ]; then
        echo "Populating analysis_data (region=global period=$GLOBAL_PERIOD)..."
        "$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" --period "$GLOBAL_PERIOD" --region global
    fi
    if [ -n "$TR_PERIOD" ]; then
        echo "Populating analysis_data (region=turkey period=$TR_PERIOD)..."
        "$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" --period "$TR_PERIOD" --region turkey
    fi

    # 3) Extract logos for any startups that don't have one yet.
    # Non-blocking: logo failures should not prevent sync from completing.
    echo "Extracting logos for startups missing them..."
    cd "$REPO_DIR/packages/analysis"
    "$VENV_DIR/bin/python" main.py extract-logos --concurrent 10 || echo "WARN: Logo extraction had errors (non-fatal)"

    echo "DB sync complete."
else
    echo "WARN: DATABASE_URL not set; skipping DB sync."
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

echo "Pushed $TOTAL changes. Triggering frontend deploy via GitHub Actions..."

# Trigger frontend deploy via GitHub Actions (replaces local VM deploy)
if command -v gh >/dev/null 2>&1; then
    gh workflow run deploy-frontend.yml --ref main || echo "WARN: gh workflow run failed; frontend deploy must be triggered manually."
else
    echo "WARN: gh CLI not available; frontend deploy must be triggered manually."
fi

echo "=== Sync Data complete ==="
