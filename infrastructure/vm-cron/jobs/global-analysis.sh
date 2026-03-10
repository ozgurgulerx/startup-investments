#!/bin/bash
# global-analysis.sh — Run full analysis pipeline for global startups.
#
# VM-era behavior committed output artifacts back into git. The AKS/Blob model
# instead hydrates the latest period tree into scratch space, persists
# checkpoints/base analyses back to Blob during the run, and republishes the
# period dataset on completion.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
PERIOD="${1:-latest}"
CONCURRENT="${2:-2}"
MAX_STARTUPS="${3:-15}"
STARTUP_FILE="${4:-}"
SKIP_FILE="${5:-}"

WORK_ROOT="$(mktemp -d /tmp/buildatlas-global-analysis.XXXXXX)"
TARGET_DATA_ROOT="$WORK_ROOT/apps/web/data"
cleanup() {
    rm -rf "$WORK_ROOT" 2>/dev/null || true
}
trap cleanup EXIT

detect_latest_local_period() {
    find "$REPO_DIR/apps/web/data" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null \
        | grep -E '^[0-9]{4}-[0-9]{2}$' \
        | sort \
        | tail -n 1
}

detect_latest_blob_period() {
    cd "$REPO_DIR/packages/analysis"
    "$VENV_DIR/bin/python" - <<'PY'
from src.storage.period_artifacts import PeriodArtifactStore

store = PeriodArtifactStore()
print(store.latest_period(region="global") if store.is_available() else "")
PY
}

resolve_latest_period() {
    local blob_period=""
    local local_period=""

    blob_period="$(detect_latest_blob_period)"
    local_period="$(detect_latest_local_period)"

    printf '%s\n%s\n' "$blob_period" "$local_period" \
        | grep -E '^[0-9]{4}-[0-9]{2}$' \
        | sort \
        | tail -n 1 || true
}

if [ -z "$PERIOD" ] || [ "$PERIOD" = "latest" ]; then
    PERIOD="$(resolve_latest_period)"
fi

if [ -z "$PERIOD" ]; then
    echo "ERROR: Could not determine latest global period from repo or Blob"
    exit 1
fi

PERIOD_ROOT="$TARGET_DATA_ROOT/$PERIOD"
CSV_PATH="$PERIOD_ROOT/input/startups.csv"
OUTPUT_DIR="$PERIOD_ROOT/output"

echo "=== Global Startup Analysis Pipeline ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Period: $PERIOD"
echo "Concurrent: $CONCURRENT"
echo "Max startups: $MAX_STARTUPS"
echo "Scratch period root: $PERIOD_ROOT"
if [ -n "$STARTUP_FILE" ]; then
    echo "Startup allowlist: $STARTUP_FILE"
fi
if [ -n "$SKIP_FILE" ]; then
    echo "Skip list: $SKIP_FILE"
fi

mkdir -p "$TARGET_DATA_ROOT"

echo "Hydrating period dataset from Blob..."
if ! "$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync_period_data_from_blob.py" \
    --target "$TARGET_DATA_ROOT" \
    --period "$PERIOD" \
    --region global; then
    echo "WARN: Blob hydration failed; falling back to repo-local period data when available"
fi

if [ ! -f "$CSV_PATH" ] && [ -f "$REPO_DIR/apps/web/data/$PERIOD/input/startups.csv" ]; then
    echo "Copying local repo input CSV into scratch workspace..."
    mkdir -p "$PERIOD_ROOT/input"
    cp "$REPO_DIR/apps/web/data/$PERIOD/input/startups.csv" "$CSV_PATH"
fi

if [ ! -f "$CSV_PATH" ]; then
    echo "ERROR: CSV not found after Blob hydration: $CSV_PATH"
    exit 1
fi

CSV_COUNT=$(wc -l < "$CSV_PATH")
echo "CSV rows: $CSV_COUNT"

cd "$REPO_DIR/packages/analysis"

echo ""
echo "Starting incremental analysis (force=False, no-viral)..."
BUILDATLAS_PERIOD="$PERIOD" \
BUILDATLAS_REGION="global" \
BUILDATLAS_ARTIFACT_BLOB_MIRROR="true" \
"$VENV_DIR/bin/python" -u -c "
import asyncio
import sys
sys.path.insert(0, '.')

from pathlib import Path

from src.analysis.incremental_processor import IncrementalProcessor
from src.analysis.onboarding_ops import load_startup_allowlist, regenerate_output_artifacts
from src.data.ingestion import load_startups_from_csv
from src.data.store import AnalysisStore

csv_path = Path('$CSV_PATH')
output_path = Path('$OUTPUT_DIR')
output_path.mkdir(parents=True, exist_ok=True)
startup_file = Path('$STARTUP_FILE') if '$STARTUP_FILE' else None
skip_file = Path('$SKIP_FILE') if '$SKIP_FILE' else None

store = AnalysisStore(output_path / 'analysis_store')
processor = IncrementalProcessor(store)

startups = load_startups_from_csv(csv_path)
print(f'Total in CSV: {len(startups)}', flush=True)

# Load skip list (permanent failures)
skip_names = set()
if skip_file and skip_file.exists():
    with open(skip_file) as f:
        skip_names = {line.strip().lower() for line in f if line.strip() and not line.startswith('#')}
    print(f'Skip list loaded: {len(skip_names)} startups', flush=True)
if skip_names:
    before = len(startups)
    startups = [s for s in startups if s.name.strip().lower() not in skip_names]
    print(f'After skip filter: {len(startups)} (excluded {before - len(startups)})', flush=True)

stats = store.get_stats()
print(f'Already in store: {stats[\"total_startups\"]}', flush=True)

delta = store.get_delta(startups)
print(f'Delta to process: {len(delta)}', flush=True)
startup_allowlist = load_startup_allowlist(startup_file) if startup_file and startup_file.exists() else None
if startup_allowlist:
    print(f'Allowlist size: {len(startup_allowlist)}', flush=True)

print(f'Starting processing with concurrent=$CONCURRENT max_startups=$MAX_STARTUPS...', flush=True)
results = asyncio.run(processor.process_incremental(
    startups,
    run_base=True,
    run_viral=False,
    max_concurrent=$CONCURRENT,
    force_reprocess=False,
    max_startups=$MAX_STARTUPS,
    startup_allowlist=startup_allowlist,
))

print(f'', flush=True)
print(f'=== Results ===', flush=True)
print(f'Total in CSV:     {results[\"total_in_csv\"]}', flush=True)
print(f'Already done:     {results[\"already_processed\"]}', flush=True)
print(f'Delta processed:  {results[\"delta_processed\"]}', flush=True)
print(f'New analyses:     {results[\"new_base_analyses\"]}', flush=True)
print(f'Filtered out:     {results[\"filtered_out\"]}', flush=True)
print(f'Errors:           {len(results[\"errors\"])}', flush=True)
if results['errors']:
    for e in results['errors'][:20]:
        print(f'  - {e}', flush=True)

artifacts = regenerate_output_artifacts(
    csv_path=csv_path,
    output_path=output_path,
    period='$PERIOD',
    store=store,
)
print(f'', flush=True)
print(f'=== Regenerated Artifacts ===', flush=True)
for key, value in artifacts.items():
    print(f'{key}: {value}', flush=True)
"

echo ""
echo "Analysis files: $(ls "$OUTPUT_DIR/analysis_store/base_analyses/" 2>/dev/null | wc -l)"

echo ""
# Only publish to blob when there is no remaining delta — avoids the slow
# blob upload killing intermediate cron runs before they finish.
PROGRESS_FILE="$OUTPUT_DIR/analysis_store/progress.json"
REMAINING_DELTA=$(
    "$VENV_DIR/bin/python" -c "
import json, sys
try:
    with open('$PROGRESS_FILE') as f:
        print(json.load(f).get('remaining', -1))
except Exception:
    print(-1)
" 2>/dev/null || echo "-1"
)

if [ "$REMAINING_DELTA" = "0" ]; then
    echo "Delta is 0 — publishing period dataset to Blob..."
    "$VENV_DIR/bin/python" "$REPO_DIR/scripts/publish_period_data_to_blob.py" \
        --period "$PERIOD" \
        --region global \
        --source-root "$PERIOD_ROOT"
else
    echo "Remaining delta: $REMAINING_DELTA — skipping blob publish (will publish when delta=0)"
fi

echo "=== Global Analysis Pipeline complete ==="
