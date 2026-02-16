#!/bin/bash
# seed-theinformation-headlines.sh — Harvest The Information technology headlines as lead seeds.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
SECTION_URL="${THEINFORMATION_SECTION_URL:-https://www.theinformation.com/technology}"
MAX_ITEMS="${THEINFORMATION_SEED_MAX_ITEMS:-40}"

echo "=== The Information Headline Seed ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Section: ${SECTION_URL}"

# Ensure the paid_headline_seeds table exists.
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py seed-theinformation-headlines \
  --section-url "$SECTION_URL" \
  --max-items "$MAX_ITEMS"

echo "=== The Information Headline Seed complete ==="
