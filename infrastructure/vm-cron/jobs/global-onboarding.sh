#!/bin/bash
# global-onboarding.sh — Full startup pipeline: crawl → LLM analysis → DB sync → dossiers.
#
# Processes every startup in the CSV through the complete pipeline.
# Delta detection makes it safe to re-run after a crash (skips completed startups).
#
# Usage:
#   runner.sh global-onboarding 1440 global-onboarding.sh [PERIOD] [CONCURRENT]
#
# Environment (injected via K8s secrets or /etc/buildatlas/.env):
#   DATABASE_URL, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT_NAME,
#   AZURE_STORAGE_CONNECTION_STRING, OPENAI_API_KEY (fallback)
#
set -euo pipefail

VENV_DIR="${VENV_DIR:-/opt/buildatlas/venv}"
REPO_DIR="${REPO_DIR:-/opt/buildatlas/startup-analysis}"
PERIOD="${1:-2026-02}"
CONCURRENT="${2:-3}"
export LOG_LEVEL="${LOG_LEVEL:-INFO}"

CSV_PATH="$REPO_DIR/apps/web/data/$PERIOD/input/startups.csv"
OUTPUT_DIR="$REPO_DIR/apps/web/data/$PERIOD/output"
RUN_KEY="${BUILDATLAS_RUN_KEY:-global-onboarding:${PERIOD}:$(date -u '+%Y%m%dT%H%M%SZ')}"
RUN_TRACKER="$REPO_DIR/scripts/onboarding_run_tracker.py"
CURRENT_STAGE="starting"
START_STAGE=""

stage_rank() {
    case "$1" in
        analysis) echo 0 ;;
        artifact_refresh) echo 1 ;;
        db_sync) echo 2 ;;
        analysis_materialization) echo 3 ;;
        state_backfill) echo 4 ;;
        logos) echo 5 ;;
        deep_dives) echo 6 ;;
        monthly_outputs) echo 7 ;;
        blob_publish) echo 8 ;;
        postflight) echo 9 ;;
        completed) echo 999 ;;
        *) echo 0 ;;
    esac
}

should_run_stage() {
    local candidate_rank start_rank
    candidate_rank="$(stage_rank "$1")"
    start_rank="$(stage_rank "${START_STAGE:-analysis}")"
    [ "$candidate_rank" -ge "$start_rank" ]
}

track_run() {
    if [ -z "${DATABASE_URL:-}" ]; then
        return 0
    fi
    "$VENV_DIR/bin/python" "$RUN_TRACKER" "$@" || echo "WARN: onboarding run tracker failed: $*"
}

sync_run_progress() {
    if [ -z "${DATABASE_URL:-}" ]; then
        return 0
    fi
    if [ -f "$OUTPUT_DIR/analysis_store/progress.json" ]; then
        track_run progress --run-key "$RUN_KEY" --progress-json "$OUTPUT_DIR/analysis_store/progress.json"
    fi
}

on_exit() {
    local exit_code=$?
    trap - EXIT
    sync_run_progress
    if [ "$exit_code" -eq 0 ]; then
        track_run finish --run-key "$RUN_KEY" --status completed
    else
        track_run finish --run-key "$RUN_KEY" --status failed --failure-reason "stage=${CURRENT_STAGE} exit_code=$exit_code"
    fi
    exit "$exit_code"
}

trap on_exit EXIT

echo "=========================================="
echo "=== Global Startup Onboarding Pipeline ==="
echo "=========================================="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Period:    $PERIOD"
echo "Concurrent: $CONCURRENT"
echo "Run key:   $RUN_KEY"
echo ""

track_run start \
    --run-key "$RUN_KEY" \
    --period "$PERIOD" \
    --region global \
    --pipeline-name global-onboarding \
    --stage starting \
    --artifact-path "$OUTPUT_DIR"

echo "Hydrating period dataset from Blob (best-effort)..."
track_run stage --run-key "$RUN_KEY" --stage blob_hydration --status running
"$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync_period_data_from_blob.py" \
    --target "$REPO_DIR/apps/web/data" \
    --period "$PERIOD" \
    --region global || echo "WARN: Blob hydration failed (continuing with local image data)"
track_run stage --run-key "$RUN_KEY" --stage blob_hydration --status completed
echo ""

if [ ! -f "$CSV_PATH" ]; then
    echo "ERROR: CSV not found: $CSV_PATH"
    exit 1
fi

CSV_COUNT=$(wc -l < "$CSV_PATH")
echo "CSV rows: $CSV_COUNT"
echo ""

echo "Preflight before run:"
CURRENT_STAGE="preflight"
track_run stage --run-key "$RUN_KEY" --stage preflight --status running
"$VENV_DIR/bin/python" "$REPO_DIR/packages/analysis/main.py" onboarding-preflight \
    --period "$PERIOD" --region global --json || echo "WARN: onboarding-preflight failed (continuing)"
track_run stage --run-key "$RUN_KEY" --stage preflight --status completed
echo ""

if [ -n "${BUILDATLAS_RESUME_FROM_STAGE:-}" ]; then
    START_STAGE="$BUILDATLAS_RESUME_FROM_STAGE"
    echo "Resume start stage forced by env: $START_STAGE"
else
    echo "Computing resume plan..."
    RESUME_PLAN_JSON=$("$VENV_DIR/bin/python" "$REPO_DIR/packages/analysis/main.py" onboarding-resume-plan \
        --period "$PERIOD" --region global --output "$OUTPUT_DIR" --json)
    START_STAGE=$(RESUME_PLAN_JSON="$RESUME_PLAN_JSON" "$VENV_DIR/bin/python" -c "import json, os; print(json.loads(os.environ['RESUME_PLAN_JSON']).get('recommended_start_stage', 'analysis'))")
    RESUME_REASON=$(RESUME_PLAN_JSON="$RESUME_PLAN_JSON" "$VENV_DIR/bin/python" -c "import json, os; print(json.loads(os.environ['RESUME_PLAN_JSON']).get('reason', ''))")
    echo "Auto resume start stage: $START_STAGE"
    if [ -n "$RESUME_REASON" ]; then
        echo "Resume reason: $RESUME_REASON"
    fi
fi
echo ""

# ─── Step 1: Deep crawl + LLM analysis (IncrementalProcessor) ───────────────
# Analysis dedupes duplicate-company CSV rows by company name, but downstream
# DB/funding sync still uses the raw CSV so distinct funding rounds are kept.
if should_run_stage analysis; then
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 1/9: Deep Crawl + LLM Analysis        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

cd "$REPO_DIR/packages/analysis"
CURRENT_STAGE="analysis"
track_run stage --run-key "$RUN_KEY" --stage analysis --status running

"$VENV_DIR/bin/python" -u -c "
import asyncio
import sys
sys.path.insert(0, '.')

from src.data.ingestion import load_startups_from_csv, load_unique_startups_from_csv
from src.data.store import AnalysisStore
from src.analysis.incremental_processor import IncrementalProcessor
from pathlib import Path

csv_path = Path('$CSV_PATH')
output_path = Path('$OUTPUT_DIR')
output_path.mkdir(parents=True, exist_ok=True)

store = AnalysisStore(output_path / 'analysis_store')
processor = IncrementalProcessor(store)

raw_startups = load_startups_from_csv(csv_path)
startups = load_unique_startups_from_csv(csv_path)
print(f'Total CSV rows parsed: {len(raw_startups)}', flush=True)
print(f'Unique startups for analysis: {len(startups)}', flush=True)

reconciled = store.reconcile_startups(startups)
print(f'Reconciled existing analyses into index: {reconciled}', flush=True)

stats = store.get_stats()
print(f'Already in store: {stats[\"total_startups\"]}', flush=True)
print(f'Base analysis files on disk: {store.count_base_analysis_files()}', flush=True)
print(f'Progress checkpoint file: {store.progress_file}', flush=True)

delta = store.get_delta(startups)
print(f'Delta to process: {len(delta)}', flush=True)

print(f'Starting processing with concurrent=$CONCURRENT...', flush=True)
results = asyncio.run(processor.process_incremental(
    startups,
    run_base=True,
    run_viral=False,
    max_concurrent=$CONCURRENT,
    force_reprocess=False,
))

print(f'', flush=True)
print(f'=== Analysis Results ===', flush=True)
print(f'Unique startups:  {results[\"total_in_csv\"]}', flush=True)
print(f'Already done:     {results[\"already_processed\"]}', flush=True)
print(f'Delta processed:  {results[\"delta_processed\"]}', flush=True)
print(f'New analyses:     {results[\"new_base_analyses\"]}', flush=True)
print(f'Errors:           {len(results[\"errors\"])}', flush=True)
if results['errors']:
    for e in results['errors'][:30]:
        print(f'  - {e}', flush=True)
"

ANALYSIS_COUNT=$(ls "$OUTPUT_DIR/analysis_store/base_analyses/" 2>/dev/null | wc -l)
sync_run_progress
track_run stage --run-key "$RUN_KEY" --stage analysis --status completed
echo ""
echo "Analysis files in store: $ANALYSIS_COUNT"
echo "Refreshing CSV/stat artifacts from analysis store..."
CURRENT_STAGE="artifact_refresh"
track_run stage --run-key "$RUN_KEY" --stage artifact_refresh --status running
"$VENV_DIR/bin/python" -u -c "
import sys
sys.path.insert(0, '$REPO_DIR/packages/analysis')

from pathlib import Path
from src.analysis.onboarding_ops import regenerate_output_artifacts
from src.data.store import AnalysisStore

csv_path = Path('$CSV_PATH')
output_path = Path('$OUTPUT_DIR')
store = AnalysisStore(output_path / 'analysis_store')
artifacts = regenerate_output_artifacts(csv_path=csv_path, output_path=output_path, period='$PERIOD', store=store)
for key, value in artifacts.items():
    print(f'{key}: {value}', flush=True)
"
track_run stage --run-key "$RUN_KEY" --stage artifact_refresh --status completed
echo "Publishing analysis checkpoint dataset to Blob (best-effort)..."
CURRENT_STAGE="analysis_checkpoint_publish"
track_run stage --run-key "$RUN_KEY" --stage analysis_checkpoint_publish --status running
"$VENV_DIR/bin/python" "$REPO_DIR/scripts/publish_period_data_to_blob.py" \
    --period "$PERIOD" \
    --region global \
    --source-root "$REPO_DIR/apps/web/data/$PERIOD" \
    || echo "WARN: analysis checkpoint publish failed (continuing)"
track_run stage --run-key "$RUN_KEY" --stage analysis_checkpoint_publish --status completed
else
    echo "Skipping Step 1/9 and artifact refresh; resume starts at stage '$START_STAGE'."
fi

# ─── Step 2: Apply database migrations ──────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 2/9: Apply Database Migrations         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

cd "$REPO_DIR"
CURRENT_STAGE="db_migrations"
track_run stage --run-key "$RUN_KEY" --stage db_migrations --status running
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" all
track_run stage --run-key "$RUN_KEY" --stage db_migrations --status completed

# ─── Step 3: Sync CSV → PostgreSQL (startups + funding_rounds) ──────────────
if should_run_stage db_sync; then
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 3/9: Sync CSV to PostgreSQL            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

CURRENT_STAGE="db_sync"
track_run stage --run-key "$RUN_KEY" --stage db_sync --status running
"$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync-startups-to-db.py" \
    --csv "$CSV_PATH" --region global
track_run stage --run-key "$RUN_KEY" --stage db_sync --status completed
else
    echo "Skipping Step 3/9; resume starts at stage '$START_STAGE'."
fi

# ─── Step 4: Populate analysis_data JSONB ────────────────────────────────────
if should_run_stage analysis_materialization; then
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 4/9: Populate analysis_data JSONB      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

CURRENT_STAGE="analysis_materialization"
track_run stage --run-key "$RUN_KEY" --stage analysis_materialization --status running
"$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" \
    --period "$PERIOD" --region global
track_run stage --run-key "$RUN_KEY" --stage analysis_materialization --status completed
else
    echo "Skipping Step 4/9; resume starts at stage '$START_STAGE'."
fi

# ─── Step 5: Backfill state snapshots / dossiers ────────────────────────────
if should_run_stage state_backfill; then
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 5/9: Backfill State Snapshots          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

cd "$REPO_DIR/packages/analysis"
CURRENT_STAGE="state_backfill"
track_run stage --run-key "$RUN_KEY" --stage state_backfill --status running
"$VENV_DIR/bin/python" -m main backfill-state --period "$PERIOD" --no-embeddings \
    || echo "WARN: backfill-state returned non-zero (continuing)"
track_run stage --run-key "$RUN_KEY" --stage state_backfill --status completed
else
    echo "Skipping Step 5/9; resume starts at stage '$START_STAGE'."
fi

# ─── Step 6: Extract logos ──────────────────────────────────────────────────
if should_run_stage logos; then
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 6/9: Extract Logos                     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

CURRENT_STAGE="logos"
track_run stage --run-key "$RUN_KEY" --stage logos --status running
"$VENV_DIR/bin/python" -m main extract-logos --db --concurrent 5 \
    || echo "WARN: extract-logos returned non-zero (continuing)"
track_run stage --run-key "$RUN_KEY" --stage logos --status completed
else
    echo "Skipping Step 6/9; resume starts at stage '$START_STAGE'."
fi

# ─── Step 7: Generate signal deep dives ─────────────────────────────────────
if should_run_stage deep_dives; then
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 7/9: Generate Signal Deep Dives        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

CURRENT_STAGE="deep_dives"
track_run stage --run-key "$RUN_KEY" --stage deep_dives --status running
"$VENV_DIR/bin/python" -m main generate-deep-dives --region global --top-n 15 \
    || echo "WARN: generate-deep-dives returned non-zero (continuing)"
track_run stage --run-key "$RUN_KEY" --stage deep_dives --status completed
else
    echo "Skipping Step 7/9; resume starts at stage '$START_STAGE'."
fi

# ─── Step 8: Monthly stats + newsletter + research artifacts ────────────────
if should_run_stage monthly_outputs; then
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 8/9: Monthly + Research Artifacts      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

CURRENT_STAGE="monthly_outputs"
track_run stage --run-key "$RUN_KEY" --stage monthly_outputs --status running
"$VENV_DIR/bin/python" -m main monthly-stats --period "$PERIOD" \
    || echo "WARN: monthly-stats returned non-zero (continuing)"
"$VENV_DIR/bin/python" -m main newsletter-artifacts --period "$PERIOD" \
    || echo "WARN: newsletter-artifacts returned non-zero (continuing)"
"$VENV_DIR/bin/python" -m main export-deep-research --period "$PERIOD" --region global \
    || echo "WARN: export-deep-research returned non-zero (continuing)"
track_run stage --run-key "$RUN_KEY" --stage monthly_outputs --status completed
else
    echo "Skipping Step 8/9; resume starts at stage '$START_STAGE'."
fi

if should_run_stage blob_publish; then
echo "Publishing final period dataset to Blob..."
CURRENT_STAGE="blob_publish"
track_run stage --run-key "$RUN_KEY" --stage blob_publish --status running
"$VENV_DIR/bin/python" "$REPO_DIR/scripts/publish_period_data_to_blob.py" \
    --period "$PERIOD" \
    --region global \
    --source-root "$REPO_DIR/apps/web/data/$PERIOD" \
    || echo "WARN: publish_period_data_to_blob failed (continuing)"
track_run stage --run-key "$RUN_KEY" --stage blob_publish --status completed
else
    echo "Skipping final Blob publish; resume starts at stage '$START_STAGE'."
fi

# ─── Step 9: Summary ────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 9/9: Final Summary                     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

FINAL_COUNT=$(ls "$OUTPUT_DIR/analysis_store/base_analyses/" 2>/dev/null | wc -l)
echo "Analysis files in store: $FINAL_COUNT"
echo ""
echo "Post-run preflight:"
CURRENT_STAGE="postflight"
track_run stage --run-key "$RUN_KEY" --stage postflight --status running
"$VENV_DIR/bin/python" "$REPO_DIR/packages/analysis/main.py" onboarding-preflight \
    --period "$PERIOD" --region global --json || echo "WARN: onboarding-preflight failed (continuing)"
track_run stage --run-key "$RUN_KEY" --stage postflight --status completed
echo ""

# Quick DB verification (best-effort)
if [ -n "${DATABASE_URL:-}" ]; then
    "$VENV_DIR/bin/python" -u -c "
import psycopg2, os
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
cur.execute(\"\"\"
    SELECT
        COUNT(*) AS total,
        COUNT(analysis_data) AS with_analysis
    FROM startups
    WHERE dataset_region = 'global' AND period = '$PERIOD'
\"\"\")
total, with_analysis = cur.fetchone()
print(f'DB startups (period=$PERIOD, global): {total} total, {with_analysis} with analysis_data')
cur.close()
conn.close()
" || echo "WARN: DB verification query failed"
fi

echo ""
echo "=========================================="
echo "=== Global Onboarding Pipeline COMPLETE ==="
echo "=========================================="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
