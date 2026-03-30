#!/bin/bash
# monthly-brief.sh — Generate monthly briefs for all regions.
# Schedule: 1st of month 06:00 UTC
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Monthly Brief Generation ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

TARGET_PERIOD=$("$VENV_DIR/bin/python" -c "from datetime import datetime, timedelta, timezone; today = datetime.now(timezone.utc).date(); first = today.replace(day=1); last_month = first - timedelta(days=1); print(f'{last_month.year:04d}-{last_month.month:02d}')")
echo "Target period: ${TARGET_PERIOD}"

# Apply database migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

cd "$REPO_DIR/packages/analysis"

# Generate global monthly brief
echo ""
echo "--- Global Monthly Brief ---"
"$VENV_DIR/bin/python" main.py generate-monthly-brief-news --region global --month "$TARGET_PERIOD" || echo "Warning: global monthly brief failed"

# Generate Turkey monthly brief
echo ""
echo "--- Turkey Monthly Brief ---"
"$VENV_DIR/bin/python" main.py generate-monthly-brief-news --region turkey --month "$TARGET_PERIOD" || echo "Warning: turkey monthly brief failed"

# Generate monthly newsletter data (if period data exists)
echo ""
echo "--- Monthly Newsletter Data ---"
for DATA_ROOT in "$REPO_DIR/apps/web/data" "$REPO_DIR/apps/web/data/tr"; do
  echo "Generating newsletter data for ${DATA_ROOT}"
  "$VENV_DIR/bin/python" "$REPO_DIR/packages/analysis/src/automation/newsletter_generator.py" \
    "$TARGET_PERIOD" \
    --data-root "$DATA_ROOT" || echo "Warning: newsletter data generation failed for ${DATA_ROOT}"
done

echo ""
echo "=== Monthly Brief Generation complete ==="
