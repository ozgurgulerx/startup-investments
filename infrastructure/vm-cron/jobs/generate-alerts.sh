#!/bin/bash
# generate-alerts.sh — Generate user alerts for all regions.
# Runs monthly (2nd of month 07:00 UTC) after delta events.
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

# Ensure required schema exists (user_subscriptions, user_alerts, delta_events, etc).
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

echo "=== Generate Alerts ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

cd "$REPO_DIR/packages/analysis"

# Determine current period (YYYY-MM)
PERIOD=$(date -u '+%Y-%m')

# Default to no narratives (cost control). Enable via ALERT_NARRATIVES_ENABLED=true.
NARRATIVES_ENABLED="${ALERT_NARRATIVES_ENABLED:-false}"
NARRATIVE_FLAG="--no-narratives"
if [ "${NARRATIVES_ENABLED,,}" = "true" ]; then
    NARRATIVE_FLAG="--narratives"
fi

# Generate alerts for global
echo "Generating alerts for global (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py generate-alerts --period "$PERIOD" --scope global "$NARRATIVE_FLAG" || echo "Global alert generation failed (non-fatal)"

# Generate alerts for turkey
echo "Generating alerts for turkey (period=$PERIOD)..."
"$VENV_DIR/bin/python" main.py generate-alerts --period "$PERIOD" --scope turkey "$NARRATIVE_FLAG" || echo "Turkey alert generation failed (non-fatal)"

echo "=== Generate Alerts complete ==="
