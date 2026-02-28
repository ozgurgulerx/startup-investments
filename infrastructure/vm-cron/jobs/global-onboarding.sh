#!/bin/bash
# global-onboarding.sh — Full startup pipeline: crawl → LLM analysis → DB sync → dossiers.
#
# Processes every startup in the CSV through the complete pipeline.
# Delta detection makes it safe to re-run after a crash (skips completed startups).
#
# Usage:
#   runner.sh global-onboarding 480 global-onboarding.sh [PERIOD] [CONCURRENT]
#
# Environment (injected via K8s secrets or /etc/buildatlas/.env):
#   DATABASE_URL, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT_NAME,
#   AZURE_STORAGE_CONNECTION_STRING, OPENAI_API_KEY (fallback)
#
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
PERIOD="${1:-2026-02}"
CONCURRENT="${2:-3}"

CSV_PATH="$REPO_DIR/apps/web/data/$PERIOD/input/startups.csv"
OUTPUT_DIR="$REPO_DIR/apps/web/data/$PERIOD/output"

echo "=========================================="
echo "=== Global Startup Onboarding Pipeline ==="
echo "=========================================="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Period:    $PERIOD"
echo "Concurrent: $CONCURRENT"
echo ""

if [ ! -f "$CSV_PATH" ]; then
    echo "ERROR: CSV not found: $CSV_PATH"
    exit 1
fi

CSV_COUNT=$(wc -l < "$CSV_PATH")
echo "CSV rows: $CSV_COUNT"
echo ""

# ─── Step 1: Deep crawl + LLM analysis (IncrementalProcessor) ───────────────
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 1/9: Deep Crawl + LLM Analysis        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

cd "$REPO_DIR/packages/analysis"

"$VENV_DIR/bin/python" -u -c "
import asyncio
import sys
sys.path.insert(0, '.')

from src.data.ingestion import load_startups_from_csv
from src.data.store import AnalysisStore
from src.analysis.incremental_processor import IncrementalProcessor
from pathlib import Path

csv_path = Path('$CSV_PATH')
output_path = Path('$OUTPUT_DIR')
output_path.mkdir(parents=True, exist_ok=True)

store = AnalysisStore(output_path / 'analysis_store')
processor = IncrementalProcessor(store)

startups = load_startups_from_csv(csv_path)
print(f'Total in CSV: {len(startups)}', flush=True)

stats = store.get_stats()
print(f'Already in store: {stats[\"total_startups\"]}', flush=True)

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
print(f'Total in CSV:     {results[\"total_in_csv\"]}', flush=True)
print(f'Already done:     {results[\"already_processed\"]}', flush=True)
print(f'Delta processed:  {results[\"delta_processed\"]}', flush=True)
print(f'New analyses:     {results[\"new_base_analyses\"]}', flush=True)
print(f'Errors:           {len(results[\"errors\"])}', flush=True)
if results['errors']:
    for e in results['errors'][:30]:
        print(f'  - {e}', flush=True)
"

ANALYSIS_COUNT=$(ls "$OUTPUT_DIR/analysis_store/base_analyses/" 2>/dev/null | wc -l)
echo ""
echo "Analysis files in store: $ANALYSIS_COUNT"

# ─── Step 2: Apply database migrations ──────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 2/9: Apply Database Migrations         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

cd "$REPO_DIR"
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" all

# ─── Step 3: Sync CSV → PostgreSQL (startups + funding_rounds) ──────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 3/9: Sync CSV to PostgreSQL            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

"$VENV_DIR/bin/python" "$REPO_DIR/scripts/sync-startups-to-db.py" \
    --csv "$CSV_PATH" --region global

# ─── Step 4: Populate analysis_data JSONB ────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 4/9: Populate analysis_data JSONB      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

"$VENV_DIR/bin/python" "$REPO_DIR/scripts/populate-analysis-data.py" \
    --period "$PERIOD" --region global

# ─── Step 5: Backfill state snapshots / dossiers ────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 5/9: Backfill State Snapshots          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" -m main backfill-state --period "$PERIOD" --no-embeddings \
    || echo "WARN: backfill-state returned non-zero (continuing)"

# ─── Step 6: Extract logos ──────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 6/9: Extract Logos                     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

"$VENV_DIR/bin/python" -m main extract-logos --db --concurrent 5 \
    || echo "WARN: extract-logos returned non-zero (continuing)"

# ─── Step 7: Generate signal deep dives ─────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 7/9: Generate Signal Deep Dives        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

"$VENV_DIR/bin/python" -m main generate-deep-dives --region global --top-n 15 \
    || echo "WARN: generate-deep-dives returned non-zero (continuing)"

# ─── Step 8: Monthly stats ──────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 8/9: Monthly Stats                     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

"$VENV_DIR/bin/python" -m main monthly-stats --period "$PERIOD" \
    || echo "WARN: monthly-stats returned non-zero (continuing)"

# ─── Step 9: Summary ────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Step 9/9: Final Summary                     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

FINAL_COUNT=$(ls "$OUTPUT_DIR/analysis_store/base_analyses/" 2>/dev/null | wc -l)
echo "Analysis files in store: $FINAL_COUNT"
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
