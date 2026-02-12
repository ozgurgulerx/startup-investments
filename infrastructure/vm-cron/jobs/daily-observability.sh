#!/bin/bash
# daily-observability.sh — Daily pipeline quality metrics posted to Slack.
#
# Reports 3 SLO metrics:
#   1. Event→Crawl latency (p50/p90): time from event detection to first crawl
#   2. Refresh effectiveness: % completed jobs with urls_boosted > 0
#   3. Linking quality: % events with startup_id, % with participants[]
#
# Run via: runner.sh daily-observability 10 .../jobs/daily-observability.sh
set -uo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Daily Observability Report ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Source env for DATABASE_URL
if [ -f /etc/buildatlas/.env ]; then
    set -a
    source /etc/buildatlas/.env
    set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL not set"
    exit 1
fi

# ---------------------------------------------------------------------------
# Metric 1: Event → Crawl latency (time from event to first subsequent crawl)
# ---------------------------------------------------------------------------
echo ""
echo "[1/3] Event→Crawl latency..."

LATENCY=$(psql "$DATABASE_URL" -t -A -F'|' <<'SQL'
WITH event_crawl AS (
    SELECT
        se.id,
        se.startup_id,
        se.detected_at,
        (SELECT MIN(cl.started_at)
         FROM crawl_logs cl
         WHERE cl.startup_id = se.startup_id
           AND cl.started_at > se.detected_at
           AND cl.status = 'success'
        ) AS first_crawl_at
    FROM startup_events se
    WHERE se.detected_at > NOW() - INTERVAL '7 days'
      AND se.startup_id IS NOT NULL
      AND se.source_type IN ('news', 'crawl_diff')
    LIMIT 500
),
latencies AS (
    SELECT
        EXTRACT(EPOCH FROM (first_crawl_at - detected_at)) / 3600.0 AS latency_hours
    FROM event_crawl
    WHERE first_crawl_at IS NOT NULL
)
SELECT
    COALESCE(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_hours)::numeric, 1), -1) AS p50,
    COALESCE(ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY latency_hours)::numeric, 1), -1) AS p90,
    COUNT(*) AS sample_size
FROM latencies;
SQL
)

LATENCY_P50=$(echo "$LATENCY" | cut -d'|' -f1 | tr -d ' ')
LATENCY_P90=$(echo "$LATENCY" | cut -d'|' -f2 | tr -d ' ')
LATENCY_N=$(echo "$LATENCY" | cut -d'|' -f3 | tr -d ' ')
echo "  p50: ${LATENCY_P50}h  p90: ${LATENCY_P90}h  (n=${LATENCY_N})"

# ---------------------------------------------------------------------------
# Metric 2: Refresh effectiveness (% jobs with urls_boosted > 0)
# ---------------------------------------------------------------------------
echo ""
echo "[2/3] Refresh effectiveness..."

REFRESH=$(psql "$DATABASE_URL" -t -A -F'|' <<'SQL'
SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE urls_boosted > 0) AS effective,
    CASE WHEN COUNT(*) > 0
         THEN ROUND(100.0 * COUNT(*) FILTER (WHERE urls_boosted > 0) / COUNT(*), 1)
         ELSE 0 END AS pct
FROM startup_refresh_jobs
WHERE status = 'completed'
  AND completed_at > NOW() - INTERVAL '7 days';
SQL
)

REFRESH_TOTAL=$(echo "$REFRESH" | cut -d'|' -f1 | tr -d ' ')
REFRESH_EFFECTIVE=$(echo "$REFRESH" | cut -d'|' -f2 | tr -d ' ')
REFRESH_PCT=$(echo "$REFRESH" | cut -d'|' -f3 | tr -d ' ')
echo "  ${REFRESH_EFFECTIVE}/${REFRESH_TOTAL} effective (${REFRESH_PCT}%)"

# ---------------------------------------------------------------------------
# Metric 3: Linking quality (% events with startup_id)
# ---------------------------------------------------------------------------
echo ""
echo "[3/3] Linking quality..."

LINKING=$(psql "$DATABASE_URL" -t -A -F'|' <<'SQL'
SELECT
    COUNT(*) AS total_events,
    COUNT(*) FILTER (WHERE startup_id IS NOT NULL) AS linked,
    CASE WHEN COUNT(*) > 0
         THEN ROUND(100.0 * COUNT(*) FILTER (WHERE startup_id IS NOT NULL) / COUNT(*), 1)
         ELSE 0 END AS linked_pct,
    COUNT(*) FILTER (WHERE metadata_json ? 'participants') AS with_participants
FROM startup_events
WHERE detected_at > NOW() - INTERVAL '7 days'
  AND source_type IN ('news', 'crawl_diff');
SQL
)

LINK_TOTAL=$(echo "$LINKING" | cut -d'|' -f1 | tr -d ' ')
LINK_LINKED=$(echo "$LINKING" | cut -d'|' -f2 | tr -d ' ')
LINK_PCT=$(echo "$LINKING" | cut -d'|' -f3 | tr -d ' ')
LINK_PARTICIPANTS=$(echo "$LINKING" | cut -d'|' -f4 | tr -d ' ')
echo "  ${LINK_LINKED}/${LINK_TOTAL} linked (${LINK_PCT}%), ${LINK_PARTICIPANTS} with participants"

# ---------------------------------------------------------------------------
# Build Slack message
# ---------------------------------------------------------------------------
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M UTC')

# Determine overall status
STATUS="success"
if [ "$LINK_PCT" != "" ] && [ "$(echo "$LINK_PCT < 50" | bc -l 2>/dev/null || echo 0)" = "1" ]; then
    STATUS="warning"
fi
if [ "$LATENCY_P50" = "-1" ] && [ "$REFRESH_TOTAL" = "0" ] && [ "$LINK_TOTAL" = "0" ]; then
    STATUS="warning"
fi

BODY="*Event \u2192 Crawl Latency (7d)*"$'\n'
BODY="${BODY}p50: ${LATENCY_P50}h  \u2022  p90: ${LATENCY_P90}h  (n=${LATENCY_N})"$'\n\n'
BODY="${BODY}*Refresh Effectiveness (7d)*"$'\n'
BODY="${BODY}${REFRESH_EFFECTIVE}/${REFRESH_TOTAL} jobs with urls_boosted > 0 (${REFRESH_PCT}%)"$'\n\n'
BODY="${BODY}*Linking Quality (7d)*"$'\n'
BODY="${BODY}${LINK_LINKED}/${LINK_TOTAL} events linked to startup (${LINK_PCT}%)"$'\n'
BODY="${BODY}${LINK_PARTICIPANTS} events with multi-party participants"$'\n\n'
BODY="${BODY}_${TIMESTAMP}_"

echo ""
echo "=== Posting to Slack ==="

SLACK_TITLE="Pipeline Observability \u2014 Daily Report" \
SLACK_STATUS="$STATUS" \
SLACK_BODY="$BODY" \
python3 "$REPO_DIR/scripts/slack_notify.py" || true

echo ""
echo "=== Observability report complete ==="
