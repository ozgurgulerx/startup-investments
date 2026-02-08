#!/bin/bash
# crawl-frontier.sh — Crawl frontier worker (every 30 min).
# Replaces: .github/workflows/crawl-frontier.yml (scheduled runs)
set -uo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Crawl Frontier ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Browserless is optional for scheduled runs
if [ -z "${BROWSERLESS_ENDPOINT:-}" ] || [ -z "${BROWSERLESS_TOKEN:-}" ]; then
    echo "SKIP: Missing BROWSERLESS_ENDPOINT or BROWSERLESS_TOKEN"
    exit 0
fi

# Apply migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" crawl

cd "$REPO_DIR/packages/analysis"

# Seed frontier queue
echo "Seeding frontier..."
"$VENV_DIR/bin/python" main.py seed-frontier --limit 5000

# Run worker
echo "Running frontier worker..."
"$VENV_DIR/bin/python" -m src.crawl_runtime.worker --batch-size 50 --max-loops 1

# Cleanup old raw captures (run once daily, during the midnight window)
HOUR=$(date -u +%H)
if [ "$HOUR" = "00" ] || [ "$HOUR" = "01" ]; then
    echo "Running retention cleanup..."
    "$VENV_DIR/bin/python" -m src.crawl_runtime.retention
fi

echo "=== Crawl Frontier complete ==="
