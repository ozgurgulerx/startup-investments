#!/bin/bash
# daily-observability.sh — Daily pipeline quality metrics posted to Slack.
#
# Reports 5 SLO metrics:
#   1. Event→Crawl latency (p50/p90): time from event detection to first crawl
#   2. Refresh effectiveness: % completed jobs with urls_boosted > 0
#   3. Linking quality: % events with startup_id, % with participants[]
#   4. Embedding coverage: unembedded count, last-24h embedded, coverage %
#   5. Onboarding funnel + deep-research spend caps
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
echo "[1/4] Event→Crawl latency..."

if LATENCY=$(psql "$DATABASE_URL" -t -A -F'|' <<'SQL'
WITH event_crawl AS (
    SELECT
        se.id,
        se.startup_id,
        se.detected_at,
        (SELECT MIN(COALESCE(cl.crawl_started_at, cl.created_at))
         FROM crawl_logs cl
         WHERE cl.startup_id = se.startup_id
           AND COALESCE(cl.crawl_started_at, cl.created_at) > se.detected_at
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
); then
    LATENCY_P50=$(echo "$LATENCY" | cut -d'|' -f1 | tr -d ' ')
    LATENCY_P90=$(echo "$LATENCY" | cut -d'|' -f2 | tr -d ' ')
    LATENCY_N=$(echo "$LATENCY" | cut -d'|' -f3 | tr -d ' ')
else
    LATENCY_P50="-1"
    LATENCY_P90="-1"
    LATENCY_N="0"
    echo "  WARNING: Event→Crawl latency query failed"
fi

echo "  p50: ${LATENCY_P50}h  p90: ${LATENCY_P90}h  (n=${LATENCY_N})"

# ---------------------------------------------------------------------------
# Metric 2: Refresh effectiveness (% jobs with urls_boosted > 0)
# ---------------------------------------------------------------------------
echo ""
echo "[2/4] Refresh effectiveness..."

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
echo "[3/4] Linking quality..."

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
# Metric 4: Embedding coverage
# ---------------------------------------------------------------------------
echo ""
echo "[4/4] Embedding coverage..."

EMBEDDING=$(psql "$DATABASE_URL" -t -A -F'|' <<'SQL'
SELECT
    COUNT(*) FILTER (WHERE embedding IS NULL) AS unembedded,
    COUNT(*) FILTER (WHERE embedded_at > NOW() - INTERVAL '24 hours') AS embedded_24h,
    COUNT(*) AS total,
    CASE WHEN COUNT(*) > 0
         THEN ROUND(100.0 * COUNT(*) FILTER (WHERE embedding IS NOT NULL) / COUNT(*), 1)
         ELSE 0 END AS coverage_pct
FROM news_clusters;
SQL
)

EMB_UNEMBEDDED=$(echo "$EMBEDDING" | cut -d'|' -f1 | tr -d ' ')
EMB_LAST24H=$(echo "$EMBEDDING" | cut -d'|' -f2 | tr -d ' ')
EMB_TOTAL=$(echo "$EMBEDDING" | cut -d'|' -f3 | tr -d ' ')
EMB_PCT=$(echo "$EMBEDDING" | cut -d'|' -f4 | tr -d ' ')
echo "  unembedded: ${EMB_UNEMBEDDED}  embedded_last_24h: ${EMB_LAST24H}  coverage: ${EMB_PCT}%"

# ---------------------------------------------------------------------------
# Metric 5: Onboarding funnel + deep-research spend
# ---------------------------------------------------------------------------
echo ""
echo "[5/6] Onboarding funnel + research spend..."

ONBOARDING=$(psql "$DATABASE_URL" -t -A -F'|' <<'SQL'
SELECT
    COUNT(*) FILTER (WHERE COALESCE(onboarding_status, 'verified') = 'stub') AS stubs,
    COUNT(*) FILTER (WHERE COALESCE(onboarding_status, 'verified') = 'verified') AS verified,
    COUNT(*) FILTER (WHERE COALESCE(onboarding_status, 'verified') = 'rejected') AS rejected,
    COUNT(*) FILTER (
        WHERE COALESCE(onboarding_status, 'verified') = 'stub'
          AND created_at > NOW() - INTERVAL '24 hours'
    ) AS stubs_24h,
    COUNT(*) FILTER (
        WHERE COALESCE(onboarding_status, 'verified') = 'verified'
          AND updated_at > NOW() - INTERVAL '24 hours'
    ) AS verified_24h
FROM startups;
SQL
)

ONB_STUBS=$(echo "$ONBOARDING" | cut -d'|' -f1 | tr -d ' ')
ONB_VERIFIED=$(echo "$ONBOARDING" | cut -d'|' -f2 | tr -d ' ')
ONB_REJECTED=$(echo "$ONBOARDING" | cut -d'|' -f3 | tr -d ' ')
ONB_STUBS_24H=$(echo "$ONBOARDING" | cut -d'|' -f4 | tr -d ' ')
ONB_VERIFIED_24H=$(echo "$ONBOARDING" | cut -d'|' -f5 | tr -d ' ')

SPEND=$(psql "$DATABASE_URL" -t -A -F'|' <<'SQL'
SELECT
    COALESCE(SUM(cost_usd) FILTER (
        WHERE completed_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
    ), 0),
    COALESCE(SUM(cost_usd) FILTER (
        WHERE completed_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')
    ), 0)
FROM deep_research_queue
WHERE status = 'completed';
SQL
)

SPEND_DAILY=$(echo "$SPEND" | cut -d'|' -f1 | tr -d ' ')
SPEND_MONTHLY=$(echo "$SPEND" | cut -d'|' -f2 | tr -d ' ')
echo "  stubs: ${ONB_STUBS} (24h +${ONB_STUBS_24H})  verified: ${ONB_VERIFIED} (24h +${ONB_VERIFIED_24H})  rejected: ${ONB_REJECTED}"
echo "  deep-research spend: daily=\$${SPEND_DAILY} monthly=\$${SPEND_MONTHLY}"

# ---------------------------------------------------------------------------
# Metric 6: Signals + deltas + alerts activity (last 24h)
# ---------------------------------------------------------------------------
echo ""
echo "[6/6] Signals + deltas + alerts activity..."

if ACTIVITY=$(psql "$DATABASE_URL" -t -A -F'|' <<'SQL'
WITH su AS (
  SELECT COUNT(*)::int AS signal_updates_24h
  FROM signal_updates
  WHERE created_at > NOW() - INTERVAL '24 hours'
),
de AS (
  SELECT
    COUNT(*) FILTER (WHERE region = 'global')::int AS deltas_global_24h,
    COUNT(*) FILTER (WHERE region = 'turkey')::int AS deltas_turkey_24h
  FROM delta_events
  WHERE created_at > NOW() - INTERVAL '24 hours'
),
ua AS (
  SELECT
    COUNT(*) FILTER (WHERE scope = 'global')::int AS alerts_global_24h,
    COUNT(*) FILTER (WHERE scope = 'turkey')::int AS alerts_turkey_24h
  FROM user_alerts
  WHERE created_at > NOW() - INTERVAL '24 hours'
)
SELECT
  (SELECT signal_updates_24h FROM su),
  (SELECT deltas_global_24h FROM de),
  (SELECT deltas_turkey_24h FROM de),
  (SELECT alerts_global_24h FROM ua),
  (SELECT alerts_turkey_24h FROM ua);
SQL
); then
    SU_24H=$(echo "$ACTIVITY" | cut -d'|' -f1 | tr -d ' ')
    DELTAS_G_24H=$(echo "$ACTIVITY" | cut -d'|' -f2 | tr -d ' ')
    DELTAS_T_24H=$(echo "$ACTIVITY" | cut -d'|' -f3 | tr -d ' ')
    ALERTS_G_24H=$(echo "$ACTIVITY" | cut -d'|' -f4 | tr -d ' ')
    ALERTS_T_24H=$(echo "$ACTIVITY" | cut -d'|' -f5 | tr -d ' ')
else
    SU_24H="-1"
    DELTAS_G_24H="-1"
    DELTAS_T_24H="-1"
    ALERTS_G_24H="-1"
    ALERTS_T_24H="-1"
    echo "  WARNING: Signals/deltas/alerts activity query failed"
fi

echo "  signal_updates: ${SU_24H}  deltas: global=${DELTAS_G_24H}, turkey=${DELTAS_T_24H}  alerts: global=${ALERTS_G_24H}, turkey=${ALERTS_T_24H}"

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
if [ "${ONB_STUBS_24H:-0}" -gt 0 ] 2>/dev/null && [ "${ONB_VERIFIED_24H:-0}" -eq 0 ] 2>/dev/null; then
    STATUS="warning"
fi

BODY="*Event \u2192 Crawl Latency (7d)*"$'\n'
BODY="${BODY}p50: ${LATENCY_P50}h  \u2022  p90: ${LATENCY_P90}h  (n=${LATENCY_N})"$'\n\n'
BODY="${BODY}*Refresh Effectiveness (7d)*"$'\n'
BODY="${BODY}${REFRESH_EFFECTIVE}/${REFRESH_TOTAL} jobs with urls_boosted > 0 (${REFRESH_PCT}%)"$'\n\n'
BODY="${BODY}*Linking Quality (7d)*"$'\n'
BODY="${BODY}${LINK_LINKED}/${LINK_TOTAL} events linked to startup (${LINK_PCT}%)"$'\n'
BODY="${BODY}${LINK_PARTICIPANTS} events with multi-party participants"$'\n\n'
BODY="${BODY}*Embedding Coverage*"$'\n'
BODY="${BODY}unembedded: ${EMB_UNEMBEDDED}  \u2022  last 24h: ${EMB_LAST24H}  \u2022  coverage: ${EMB_PCT}%"$'\n\n'
BODY="${BODY}*Onboarding Funnel / Research Spend*"$'\n'
BODY="${BODY}stubs: ${ONB_STUBS} (24h +${ONB_STUBS_24H})  \u2022  verified: ${ONB_VERIFIED} (24h +${ONB_VERIFIED_24H})  \u2022  rejected: ${ONB_REJECTED}"$'\n'
BODY="${BODY}deep-research spend: daily=\$${SPEND_DAILY}  \u2022  monthly=\$${SPEND_MONTHLY}"$'\n\n'
BODY="${BODY}*Signals / Deltas / Alerts (24h)*"$'\n'
BODY="${BODY}signal_updates: ${SU_24H}  \u2022  deltas: global=${DELTAS_G_24H}, turkey=${DELTAS_T_24H}  \u2022  alerts: global=${ALERTS_G_24H}, turkey=${ALERTS_T_24H}"$'\n\n'
BODY="${BODY}_${TIMESTAMP}_"

echo ""
echo "=== Posting to Slack ==="

SLACK_TITLE="Pipeline Observability \u2014 Daily Report" \
SLACK_STATUS="$STATUS" \
SLACK_BODY="$BODY" \
python3 "$REPO_DIR/scripts/slack_notify.py" || true

echo ""
echo "=== Observability report complete ==="
