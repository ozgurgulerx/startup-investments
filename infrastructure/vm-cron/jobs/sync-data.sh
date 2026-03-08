#!/bin/bash
# sync-data.sh — Sync Blob-backed datasets into Postgres and trigger frontend deploys.
#
# This no longer commits generated data into git. The canonical dataset lives in
# Azure Blob Storage; this job hydrates it into a scratch workspace, keeps the
# database in sync, and dispatches a frontend rebuild when the period dataset
# changes.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
WORK_ROOT="$(mktemp -d /tmp/buildatlas-sync-data.XXXXXX)"
TARGET_DATA_ROOT="$WORK_ROOT/apps/web/data"
WORKFLOW_FILE="${SYNC_DATA_FRONTEND_WORKFLOW:-deploy-frontend.yml}"

cleanup() {
    rm -rf "$WORK_ROOT" 2>/dev/null || true
}
trap cleanup EXIT

compute_blob_manifest_hash() {
    cd "$REPO_DIR/packages/analysis"
    "$VENV_DIR/bin/python" - <<'PY'
import hashlib
import json

from src.storage.blob_client import ContainerName
from src.storage.period_artifacts import PeriodArtifactStore

store = PeriodArtifactStore()
if not store.is_available():
    raise SystemExit(1)

entries = []
for blob in store.client.list_blobs(ContainerName.PERIODS, prefix=""):
    entries.append({
        "name": blob.get("name"),
        "size": blob.get("size"),
        "last_modified": (
            blob.get("last_modified").isoformat()
            if getattr(blob.get("last_modified"), "isoformat", None)
            else str(blob.get("last_modified") or "")
        ),
    })
entries.sort(key=lambda item: str(item.get("name") or ""))
payload = json.dumps(entries, sort_keys=True, separators=(",", ":"))
print(hashlib.sha256(payload.encode("utf-8")).hexdigest())
PY
}

dispatch_frontend_deploy() {
    local token="${GITHUB_ACTIONS_WORKFLOW_TOKEN:-${GITHUB_TOKEN:-}}"
    local repo="${GITHUB_REPOSITORY:-}"

    if [ -z "$token" ] || [ -z "$repo" ]; then
        echo "WARN: Missing GITHUB_ACTIONS_WORKFLOW_TOKEN/GITHUB_TOKEN or GITHUB_REPOSITORY; skipping frontend dispatch."
        return 0
    fi

    local payload='{"ref":"main"}'
    local api_url="https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches"

    echo "Dispatching frontend deploy via GitHub Actions..."
    if ! curl -fsS -X POST "$api_url" \
        -H "Accept: application/vnd.github+json" \
        -H "Authorization: Bearer ${token}" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        -d "$payload" >/dev/null; then
        echo "WARN: GitHub workflow dispatch failed for ${WORKFLOW_FILE}"
        return 0
    fi
    echo "Frontend deploy dispatched."
}

echo "=== Sync Data ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

CURRENT_HASH="$(compute_blob_manifest_hash || true)"
if [ -z "$CURRENT_HASH" ]; then
    echo "ERROR: Could not compute Blob manifest hash"
    exit 1
fi

LAST_HASH="$("$VENV_DIR/bin/python" "$REPO_DIR/scripts/pipeline_job_state.py" \
    get --job sync-data --field manifest_hash --default "")"
LAST_DB_SYNC_AT="$("$VENV_DIR/bin/python" "$REPO_DIR/scripts/pipeline_job_state.py" \
    get --job sync-data --field last_db_sync_epoch --default "0")"

NOW_EPOCH="$(date +%s)"
DB_SYNC_AGE=$((NOW_EPOCH - ${LAST_DB_SYNC_AT:-0}))
HAS_DATA_CHANGES=1
if [ "$CURRENT_HASH" = "$LAST_HASH" ]; then
    HAS_DATA_CHANGES=0
fi

if [ "$HAS_DATA_CHANGES" -eq 0 ] && [ "$DB_SYNC_AGE" -lt 86400 ]; then
    echo "No Blob dataset changes detected and DB sync is fresh (${DB_SYNC_AGE}s old). Done."
    exit 0
fi

mkdir -p "$TARGET_DATA_ROOT"

echo "Hydrating period datasets from Blob..."
"$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync_period_data_from_blob.py" \
    --target "$TARGET_DATA_ROOT" \
    --all-periods \
    --region all

check_taxonomy() {
    local region="$1"
    local period="$2"
    if [ -z "$period" ]; then
        return 0
    fi

    echo "Checking vertical_taxonomy completeness (region=$region period=$period)..."
    if WEB_DATA_ROOT_OVERRIDE="$TARGET_DATA_ROOT" \
        "$VENV_DIR/bin/python" "$REPO_DIR/scripts/check-vertical-taxonomy.py" \
            --period "$period" --region "$region"; then
        return 0
    fi

    echo "vertical_taxonomy incomplete; attempting backfill (region=$region period=$period)..."
    if [ -z "${AZURE_OPENAI_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
        echo "ERROR: Missing AZURE_OPENAI_API_KEY/OPENAI_API_KEY; cannot run LLM backfill for vertical_taxonomy."
        return 1
    fi

    WEB_DATA_ROOT_OVERRIDE="$TARGET_DATA_ROOT" \
        "$VENV_DIR/bin/python" "$REPO_DIR/scripts/backfill-vertical-taxonomy.py" \
            --period "$period" --region "$region" --only-incomplete --max-failures 20

    echo "Re-checking vertical_taxonomy (region=$region period=$period)..."
    WEB_DATA_ROOT_OVERRIDE="$TARGET_DATA_ROOT" \
        "$VENV_DIR/bin/python" "$REPO_DIR/scripts/check-vertical-taxonomy.py" \
            --period "$period" --region "$region"
}

GLOBAL_PERIOD="$(find "$TARGET_DATA_ROOT" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null \
    | grep -E '^[0-9]{4}-[0-9]{2}$' | sort -r | head -n 1 || true)"
TR_PERIOD="$(find "$TARGET_DATA_ROOT/tr" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null \
    | grep -E '^[0-9]{4}-[0-9]{2}$' | sort -r | head -n 1 || true)"

check_taxonomy "global" "$GLOBAL_PERIOD"
if [ -n "$TR_PERIOD" ]; then
    check_taxonomy "tr" "$TR_PERIOD"
fi

if [ -n "${DATABASE_URL:-}" ]; then
    echo "Applying startup migrations..."
    bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" startups

    if [ -n "$GLOBAL_PERIOD" ] && [ -f "$TARGET_DATA_ROOT/$GLOBAL_PERIOD/input/startups.csv" ]; then
        echo "Syncing startups.csv to Postgres (region=global period=$GLOBAL_PERIOD)..."
        "$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync-startups-to-db.py" \
            --csv "$TARGET_DATA_ROOT/$GLOBAL_PERIOD/input/startups.csv" \
            --region global
        WEB_DATA_ROOT_OVERRIDE="$TARGET_DATA_ROOT" \
            "$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" \
                --period "$GLOBAL_PERIOD" --region global
    else
        echo "WARN: Global startups.csv not found for period $GLOBAL_PERIOD; skipping global upsert."
    fi

    if [ -n "$TR_PERIOD" ] && [ -f "$TARGET_DATA_ROOT/tr/$TR_PERIOD/input/startups.csv" ]; then
        echo "Syncing startups.csv to Postgres (region=turkey period=$TR_PERIOD)..."
        "$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync-startups-to-db.py" \
            --csv "$TARGET_DATA_ROOT/tr/$TR_PERIOD/input/startups.csv" \
            --region turkey
        WEB_DATA_ROOT_OVERRIDE="$TARGET_DATA_ROOT" \
            "$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" \
                --period "$TR_PERIOD" --region turkey
    else
        echo "INFO: Turkey startups.csv not found for period $TR_PERIOD; skipping turkey upsert."
    fi

    echo "Extracting logos for startups missing them..."
    cd "$REPO_DIR/packages/analysis"
    "$VENV_DIR/bin/python" main.py extract-logos --concurrent 10 || echo "WARN: Logo extraction had errors (non-fatal)"
else
    echo "WARN: DATABASE_URL not set; skipping DB sync."
fi

"$VENV_DIR/bin/python" "$REPO_DIR/scripts/pipeline_job_state.py" \
    set --job sync-data --json "{\"manifest_hash\":\"$CURRENT_HASH\",\"last_db_sync_epoch\":\"$NOW_EPOCH\"}"

if [ "$HAS_DATA_CHANGES" -eq 1 ]; then
    dispatch_frontend_deploy
else
    echo "Blob dataset unchanged; frontend deploy not required."
fi

echo "=== Sync Data complete ==="
