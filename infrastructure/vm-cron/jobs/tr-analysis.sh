#!/bin/bash
# tr-analysis.sh — Run full analysis pipeline for Turkish startups.
#
# This crawls each startup's website + runs deep LLM analysis to populate
# all enrichment fields (genai_intensity, market_type, vertical_taxonomy, etc.)
#
# Usage:
#   runner.sh tr-analysis 600 /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/tr-analysis.sh
#
# Environment (sourced by runner.sh from /etc/buildatlas/.env):
#   AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT_NAME
#   BROWSERLESS_ENDPOINT, BROWSERLESS_TOKEN (optional — falls back to HTTP-only)
#   OPENAI_API_KEY (fallback for LLM if Azure identity unavailable)
#
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
PERIOD="${1:-2026-02}"
BATCH_SIZE="${2:-50}"
CONCURRENT="${3:-5}"

CSV_PATH="$REPO_DIR/apps/web/data/tr/$PERIOD/input/startups.csv"
OUTPUT_DIR="$REPO_DIR/apps/web/data/tr/$PERIOD/output"

echo "=== TR Startup Analysis Pipeline ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Period: $PERIOD"
echo "Batch size: $BATCH_SIZE"
echo "Concurrent: $CONCURRENT"

if [ ! -f "$CSV_PATH" ]; then
    echo "ERROR: CSV not found: $CSV_PATH"
    exit 1
fi

CSV_COUNT=$(wc -l < "$CSV_PATH")
echo "CSV rows: $CSV_COUNT"

cd "$REPO_DIR/packages/analysis"

# Run incremental analysis (force reprocess, no viral)
# The incremental command uses AnalysisStore which writes to analysis_store/base_analyses/
echo ""
echo "Starting incremental analysis (force=True, no-viral)..."
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

print(f'Starting processing with concurrent={$CONCURRENT}...', flush=True)
results = asyncio.run(processor.process_incremental(
    startups,
    run_base=True,
    run_viral=False,
    max_concurrent=$CONCURRENT,
    force_reprocess=True,
))

print(f'', flush=True)
print(f'=== Results ===', flush=True)
print(f'Total in CSV:     {results[\"total_in_csv\"]}', flush=True)
print(f'Already done:     {results[\"already_processed\"]}', flush=True)
print(f'Delta processed:  {results[\"delta_processed\"]}', flush=True)
print(f'New analyses:     {results[\"new_base_analyses\"]}', flush=True)
print(f'Errors:           {len(results[\"errors\"])}', flush=True)
if results['errors']:
    for e in results['errors'][:10]:
        print(f'  - {e}', flush=True)
"

echo ""
echo "Analysis files: $(ls "$OUTPUT_DIR/analysis_store/base_analyses/" 2>/dev/null | wc -l)"

# After analysis, commit and push results so the sync workflow picks them up
echo ""
echo "Committing results..."
cd "$REPO_DIR"
git add "apps/web/data/tr/$PERIOD/output/analysis_store/" || true
if ! git diff --staged --quiet; then
    git commit -m "TR analysis: enrich $PERIOD startups with crawl + LLM analysis [skip ci]"
    git push
    echo "Pushed analysis results to git"
else
    echo "No changes to commit"
fi

echo "=== TR Analysis Pipeline complete ==="
