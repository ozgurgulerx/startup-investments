#!/bin/bash
# dealbook-brief.sh — Daily dealbook living brief regeneration.
# Generates fresh snapshots for each region × period type combination.
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

# Generate for each region × period type
REGIONS=("global" "turkey")
PERIOD_TYPES=("monthly")

SUCCESSES=0
FAILURES=0

for region in "${REGIONS[@]}"; do
  for period_type in "${PERIOD_TYPES[@]}"; do
    echo ""
    echo "--- Generating: ${region} / ${period_type} ---"

    HTTP_CODE=$(curl -s -o /tmp/brief-response.json -w "%{http_code}" \
      -X POST "${API_URL}/api/v1/brief/generate" \
      -H "Content-Type: application/json" \
      -H "X-API-Key: ${ADMIN_KEY}" \
      -H "X-Admin-Key: ${ADMIN_KEY}" \
      -d "{\"region\": \"${region}\", \"periodType\": \"${period_type}\"}" \
      --max-time 120)

    if [ "$HTTP_CODE" = "200" ]; then
      REV=$(cat /tmp/brief-response.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'rev {d.get(\"revisionNumber\",\"?\")} for {d.get(\"periodKey\",\"?\")}')" 2>/dev/null || echo "unknown")
      echo "  OK ($HTTP_CODE) — $REV"
      SUCCESSES=$((SUCCESSES + 1))
    else
      echo "  WARN: HTTP $HTTP_CODE"
      cat /tmp/brief-response.json 2>/dev/null || true
      FAILURES=$((FAILURES + 1))
    fi
  done
done

rm -f /tmp/brief-response.json

echo ""
echo "=== Dealbook Brief complete: ${SUCCESSES} succeeded, ${FAILURES} failed ==="

# Non-fatal — don't exit 1 on partial failures
if [ "$SUCCESSES" -eq 0 ] && [ "$FAILURES" -gt 0 ]; then
  echo "ERROR: All generations failed"
  exit 1
fi
