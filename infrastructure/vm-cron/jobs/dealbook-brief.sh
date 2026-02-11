#!/bin/bash
# dealbook-brief.sh — Daily dealbook brief edition generation.
#
# Runs daily at 04:00 UTC. Generates rolling editions for the current
# week and month. On Monday, seals the previous week. On the 1st of
# the month, seals the previous month.
#
# Idempotent: if data hasn't changed, the API returns wasSkipped=true
# and no new revision is created.
set -euo pipefail

echo "=== Dealbook Brief Generation ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# API endpoint — must be the Front Door URL (not direct AKS)
API_URL="${API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}"
ADMIN_KEY="${ADMIN_KEY:-${API_KEY:-}}"

if [ -z "$ADMIN_KEY" ]; then
  echo "ERROR: ADMIN_KEY (or API_KEY) not set"
  exit 1
fi

REGIONS=("global" "turkey")
DOW=$(date -u '+%u')       # 1=Monday ... 7=Sunday
DOM=$(date -u '+%d')       # 01-31

SUCCESSES=0
FAILURES=0

# Helper: call regenerate endpoint
generate_edition() {
  local region="$1"
  local period_type="$2"
  local period_start="$3"
  local period_end="$4"
  local kind="$5"

  echo ""
  echo "--- ${region} / ${period_type} / ${kind}: ${period_start} → ${period_end} ---"

  HTTP_CODE=$(curl -s -o /tmp/brief-response.json -w "%{http_code}" \
    -X POST "${API_URL}/api/v1/briefs/regenerate" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${ADMIN_KEY}" \
    -H "X-Admin-Key: ${ADMIN_KEY}" \
    -d "{\"region\": \"${region}\", \"period_type\": \"${period_type}\", \"period_start\": \"${period_start}\", \"period_end\": \"${period_end}\", \"kind\": \"${kind}\"}" \
    --max-time 120)

  if [ "$HTTP_CODE" = "200" ]; then
    SKIPPED=$(python3 -c "import sys,json; d=json.load(sys.stdin); print('skipped' if d.get('wasSkipped') else f'rev {d.get(\"revision\",\"?\")}')" < /tmp/brief-response.json 2>/dev/null || echo "unknown")
    echo "  OK ($HTTP_CODE) — $SKIPPED"
    SUCCESSES=$((SUCCESSES + 1))
  else
    echo "  WARN: HTTP $HTTP_CODE"
    cat /tmp/brief-response.json 2>/dev/null || true
    FAILURES=$((FAILURES + 1))
  fi
}

# === Current rolling editions (daily) ===

# Current month rolling
MONTH_START=$(date -u '+%Y-%m-01')
MONTH_END=$(date -u -d "$(date -u '+%Y-%m-01') +1 month -1 day" '+%Y-%m-%d')

# Current week rolling (Monday to Sunday)
# GNU date: find this week's Monday
WEEK_START=$(date -u -d "last monday" '+%Y-%m-%d')
# If today IS Monday, "last monday" may mean last week — fix:
if [ "$DOW" = "1" ]; then
  WEEK_START=$(date -u '+%Y-%m-%d')
fi
WEEK_END=$(date -u -d "${WEEK_START} +6 days" '+%Y-%m-%d')

for region in "${REGIONS[@]}"; do
  generate_edition "$region" "monthly" "$MONTH_START" "$MONTH_END" "rolling"
  generate_edition "$region" "weekly"  "$WEEK_START"  "$WEEK_END"  "rolling"
done

# === Seal previous week (Monday only) ===
if [ "$DOW" = "1" ]; then
  PREV_WEEK_START=$(date -u -d "${WEEK_START} -7 days" '+%Y-%m-%d')
  PREV_WEEK_END=$(date -u -d "${PREV_WEEK_START} +6 days" '+%Y-%m-%d')
  echo ""
  echo "=== Sealing previous week: ${PREV_WEEK_START} → ${PREV_WEEK_END} ==="
  for region in "${REGIONS[@]}"; do
    generate_edition "$region" "weekly" "$PREV_WEEK_START" "$PREV_WEEK_END" "sealed"
  done
fi

# === Seal previous month (1st of month only) ===
if [ "$DOM" = "01" ]; then
  PREV_MONTH_START=$(date -u -d "$(date -u '+%Y-%m-01') -1 month" '+%Y-%m-%d')
  PREV_MONTH_END=$(date -u -d "$(date -u '+%Y-%m-01') -1 day" '+%Y-%m-%d')
  echo ""
  echo "=== Sealing previous month: ${PREV_MONTH_START} → ${PREV_MONTH_END} ==="
  for region in "${REGIONS[@]}"; do
    generate_edition "$region" "monthly" "$PREV_MONTH_START" "$PREV_MONTH_END" "sealed"
  done
fi

rm -f /tmp/brief-response.json

echo ""
echo "=== Dealbook Brief complete: ${SUCCESSES} succeeded, ${FAILURES} failed ==="

# Non-fatal — don't exit 1 on partial failures
if [ "$SUCCESSES" -eq 0 ] && [ "$FAILURES" -gt 0 ]; then
  echo "ERROR: All generations failed"
  exit 1
fi
