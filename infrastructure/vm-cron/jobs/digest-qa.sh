#!/bin/bash
# digest-qa.sh — Send merged global+turkey digest to QA email for review.
# Runs every 3 hours at :50 UTC; uses the same template as production.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
QA_EMAIL="${DIGEST_QA_EMAIL:-343544@gmail.com}"

echo "=== Digest QA Preview ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "QA email: $QA_EMAIL"

cd "$REPO_DIR/packages/analysis"

"$VENV_DIR/bin/python" main.py send-news-digest --region global --qa-email "$QA_EMAIL"

echo "=== Digest QA Preview complete ==="
