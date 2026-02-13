#!/bin/bash
# health-report.sh — Periodic infrastructure health report posted to Slack.
#
# Checks all components and posts a concise summary every 4 hours.
# Run via: runner.sh health-report 10 .../jobs/health-report.sh
#
# Unlike heartbeat.sh (which only alerts on problems), this always posts
# a status report so the team knows all systems are operational.
set -uo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
LOG_DIR="/var/log/buildatlas"

# --- Azure resource names (match .env / setup-azure-alerts.sh) ---
PG_SERVER="${POSTGRES_SERVER_NAME:-aistartupstr}"
PG_RG="${POSTGRES_RESOURCE_GROUP:-aistartupstr}"
AKS_NAME="${AKS_CLUSTER_NAME:-aks-aistartuptr}"
AKS_RG="${AKS_RESOURCE_GROUP:-aistartuptr}"
REDIS_NAME="aistartupstr-redis-cache"
REDIS_RG="aistartupstr"
WEBAPP_NAME="buildatlas-web"
WEBAPP_RG="rg-startup-analysis"
HEALTH_URL="${API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}/health"
MONITOR_URL="${API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}/api/admin/monitoring/sources"
FRONTEND_URL="https://buildatlas.net"

echo "=== Infrastructure Health Report ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# --- Azure login ---
az_login() {
    for i in 1 2 3; do
        if az login --identity --output none 2>/dev/null; then
            return 0
        fi
        sleep 2
    done
    return 1
}
if ! az_login; then
    echo "ERROR: Azure managed identity login failed"
    exit 1
fi

ISSUES=0
RESULTS=()  # Each entry: "ok|fail|warn|section <text>"

add_ok()      { RESULTS+=("ok $1"); }
add_fail()    { RESULTS+=("fail $1"); ISSUES=$((ISSUES + 1)); }
add_warn()    { RESULTS+=("warn $1"); }
add_section() { RESULTS+=("section $1"); }

# =========================================================================
# Infrastructure
# =========================================================================
add_section "Infrastructure"

# --- 1. PostgreSQL ---
echo ""
echo "[1/10] PostgreSQL..."
PG_STATE=$(az postgres flexible-server show \
    --resource-group "$PG_RG" \
    --name "$PG_SERVER" \
    --query "state" -o tsv 2>/dev/null || echo "UNREACHABLE")
echo "  State: $PG_STATE"
if [ "$PG_STATE" = "Ready" ]; then
    add_ok "PostgreSQL: Ready"
else
    add_fail "PostgreSQL: $PG_STATE"
fi

# --- 2. AKS ---
echo ""
echo "[2/10] AKS..."
AKS_POWER=$(az aks show \
    --resource-group "$AKS_RG" \
    --name "$AKS_NAME" \
    --query "powerState.code" -o tsv 2>/dev/null || echo "UNREACHABLE")
echo "  Power state: $AKS_POWER"
if [ "$AKS_POWER" = "Running" ]; then
    # Get pod count
    POD_COUNT=$(az aks command invoke \
        --resource-group "$AKS_RG" \
        --name "$AKS_NAME" \
        --command "kubectl get pods -n default --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l" \
        --query "logs" -o tsv 2>/dev/null | tr -d '[:space:]' || echo "?")
    add_ok "AKS: Running (${POD_COUNT} pods)"
else
    add_fail "AKS: $AKS_POWER"
fi

# --- 3. Redis ---
echo ""
echo "[3/10] Redis..."
REDIS_STATE=$(az redis show \
    --resource-group "$REDIS_RG" \
    --name "$REDIS_NAME" \
    --query "provisioningState" -o tsv 2>/dev/null || echo "UNREACHABLE")
echo "  Provisioning state: $REDIS_STATE"
if [ "$REDIS_STATE" = "Succeeded" ]; then
    add_ok "Redis: OK"
else
    add_fail "Redis: $REDIS_STATE"
fi

# --- 4. App Service ---
echo ""
echo "[4/10] App Service..."
WEBAPP_STATE=$(az webapp show \
    --resource-group "$WEBAPP_RG" \
    --name "$WEBAPP_NAME" \
    --query "state" -o tsv 2>/dev/null || echo "UNREACHABLE")
echo "  State: $WEBAPP_STATE"
if [ "$WEBAPP_STATE" = "Running" ]; then
    add_ok "App Service: Running"
else
    add_fail "App Service: $WEBAPP_STATE"
fi

# --- 5. API health endpoint ---
echo ""
echo "[5/10] API health..."
API_START=$(date +%s%N)
API_HTTP=$(curl -s -o /tmp/ba-health-resp.json -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
API_END=$(date +%s%N)
API_MS=$(( (API_END - API_START) / 1000000 ))
echo "  HTTP: $API_HTTP (${API_MS}ms)"
if [ "$API_HTTP" = "200" ]; then
    add_ok "API: HTTP 200 (${API_MS}ms)"
else
    add_fail "API: HTTP $API_HTTP"
fi
rm -f /tmp/ba-health-resp.json

# --- 6. Frontend ---
echo ""
echo "[6/10] Frontend..."
FE_START=$(date +%s%N)
FE_HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" 2>/dev/null || echo "000")
FE_END=$(date +%s%N)
FE_MS=$(( (FE_END - FE_START) / 1000000 ))
echo "  HTTP: $FE_HTTP (${FE_MS}ms)"
if [ "$FE_HTTP" = "200" ]; then
    add_ok "Frontend: HTTP 200 (${FE_MS}ms)"
else
    add_fail "Frontend: HTTP $FE_HTTP"
fi

# =========================================================================
# VM Resources
# =========================================================================
add_section "VM Resources"

# --- 7. VM disk ---
echo ""
echo "[7/10] VM disk..."
DISK_PCT=$(df / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%' || echo "?")
echo "  Disk usage: ${DISK_PCT}%"
if [ "$DISK_PCT" != "?" ] && [ "$DISK_PCT" -lt 85 ] 2>/dev/null; then
    add_ok "Disk: ${DISK_PCT}%"
elif [ "$DISK_PCT" != "?" ] && [ "$DISK_PCT" -ge 85 ] 2>/dev/null; then
    add_fail "Disk: ${DISK_PCT}%"
else
    add_warn "Disk: unknown"
fi

# --- 8. VM memory ---
echo ""
echo "[8/10] VM memory..."
FREE_MB=$(free -m 2>/dev/null | awk '/Mem:/ {print $7}' || echo "?")
TOTAL_MB=$(free -m 2>/dev/null | awk '/Mem:/ {print $2}' || echo "?")
if [ "$FREE_MB" != "?" ] && [ "$TOTAL_MB" != "?" ] && [ "$TOTAL_MB" -gt 0 ] 2>/dev/null; then
    MEM_USED_PCT=$(( (TOTAL_MB - FREE_MB) * 100 / TOTAL_MB ))
    echo "  Memory: ${FREE_MB}MB free / ${TOTAL_MB}MB total (${MEM_USED_PCT}% used)"
    if [ "$FREE_MB" -lt 200 ] 2>/dev/null; then
        add_fail "Memory: ${MEM_USED_PCT}% used (${FREE_MB}MB free)"
    else
        add_ok "Memory: ${MEM_USED_PCT}% used (${FREE_MB}MB free)"
    fi
else
    echo "  Memory: unknown"
    add_warn "Memory: unknown"
fi

# =========================================================================
# News Pipeline (via monitoring API)
# =========================================================================
add_section "News Pipeline"

echo ""
echo "[9/10] News pipeline..."
MONITOR_JSON=$(curl -sf \
    -H "X-API-Key: ${API_KEY:-}" \
    -H "X-Admin-Key: ${ADMIN_KEY:-${API_KEY:-}}" \
    "$MONITOR_URL" 2>/dev/null || echo "")

if [ -n "$MONITOR_JSON" ]; then
    # Parse with python3 (jq not guaranteed on VM)
    # Outputs two lines:
    #   Line 1: healthy|degraded|down|ago_str|items|clusters|ago_minutes
    #   Line 2: semicolon-separated unhealthy source details (empty if all healthy)
    PIPELINE_INFO=$(python3 -c "
import json, sys
from datetime import datetime, timezone

try:
    data = json.loads(sys.stdin.read())
except Exception:
    print('error')
    print('')
    sys.exit(0)

summary = data.get('summary', {})
healthy = summary.get('healthy', 0)
degraded = summary.get('degraded', 0)
down = summary.get('down', 0)

last_run = data.get('lastRun') or {}
started_at = last_run.get('started_at', '')
items = last_run.get('items_fetched', 0)
clusters = last_run.get('clusters_built', 0)

# Compute relative time
ago_str = 'unknown'
ago_minutes = -1
if started_at:
    try:
        ts = started_at.replace('Z', '+00:00')
        dt = datetime.fromisoformat(ts)
        now = datetime.now(timezone.utc)
        delta = now - dt
        mins = int(delta.total_seconds() / 60)
        ago_minutes = mins
        if mins < 60:
            ago_str = f'{mins}m ago'
        elif mins < 1440:
            ago_str = f'{mins // 60}h ago'
        else:
            ago_str = f'{mins // 1440}d ago'
    except Exception:
        pass

print(f'{healthy}|{degraded}|{down}|{ago_str}|{items}|{clusters}|{ago_minutes}')

# Build per-source detail for non-healthy sources
now = datetime.now(timezone.utc)
unhealthy = []
for s in data.get('sources', []):
    if not s.get('is_active'):
        continue
    fails = s.get('consecutive_failures', 0)
    if fails == 0:
        continue
    name = s.get('display_name') or s.get('source_key', '?')
    stype = s.get('source_type', '?')
    region = s.get('region', 'global')
    # Relative time for last_fetch_at
    fetch_ago = '?'
    last_fetch = s.get('last_fetch_at', '')
    if last_fetch:
        try:
            ft = last_fetch.replace('Z', '+00:00')
            fdt = datetime.fromisoformat(ft)
            fm = int((now - fdt).total_seconds() / 60)
            if fm < 60:
                fetch_ago = f'{fm}m ago'
            elif fm < 1440:
                fetch_ago = f'{fm // 60}h ago'
            else:
                fetch_ago = f'{fm // 1440}d ago'
        except Exception:
            pass
    # Truncate error message
    err = (s.get('last_error') or '').strip().replace('\n', ' ')
    if len(err) > 50:
        err = err[:47] + '...'
    # level: down (5+) or degraded (1-4)
    level = 'down' if fails >= 5 else 'degraded'
    unhealthy.append(f'{level}|{name} ({stype}, {region}) -- {fails} fails, {fetch_ago} -- {err}')

print(';'.join(unhealthy))
" <<< "$MONITOR_JSON" 2>/dev/null || echo "error")

    # Read both lines from Python output
    P_LINE1=$(echo "$PIPELINE_INFO" | head -1)
    P_LINE2=$(echo "$PIPELINE_INFO" | sed -n '2p')

    if [ "$P_LINE1" != "error" ] && [ -n "$P_LINE1" ]; then
        IFS='|' read -r P_HEALTHY P_DEGRADED P_DOWN P_AGO P_ITEMS P_CLUSTERS P_AGO_MIN <<< "$P_LINE1"

        echo "  Last ingest: ${P_AGO} — ${P_ITEMS} items → ${P_CLUSTERS} clusters"
        echo "  Sources: ${P_HEALTHY} healthy, ${P_DEGRADED} degraded, ${P_DOWN} down"

        # Last ingest line
        if [ "$P_AGO_MIN" -gt 120 ] 2>/dev/null; then
            add_fail "Last ingest: ${P_AGO} — ${P_ITEMS} items → ${P_CLUSTERS} clusters"
        else
            add_ok "Last ingest: ${P_AGO} — ${P_ITEMS} items → ${P_CLUSTERS} clusters"
        fi

        # Sources summary line
        if [ "$P_DOWN" -gt 0 ] 2>/dev/null; then
            add_fail "Sources: ${P_HEALTHY} healthy, ${P_DEGRADED} degraded, ${P_DOWN} down"
        elif [ "$P_DEGRADED" -gt 0 ] 2>/dev/null; then
            add_warn "Sources: ${P_HEALTHY} healthy, ${P_DEGRADED} degraded, ${P_DOWN} down"
        else
            add_ok "Sources: ${P_HEALTHY} healthy, ${P_DEGRADED} degraded, ${P_DOWN} down"
        fi

        # Individual unhealthy source details
        if [ -n "$P_LINE2" ]; then
            add_section "Unhealthy Sources"
            IFS=';' read -ra SRC_ENTRIES <<< "$P_LINE2"
            for src_entry in "${SRC_ENTRIES[@]}"; do
                SRC_LEVEL="${src_entry%%|*}"
                SRC_DETAIL="${src_entry#*|}"
                # Replace -- with em dash for display
                SRC_DETAIL="${SRC_DETAIL//-- /— }"
                echo "  ${SRC_LEVEL}: ${SRC_DETAIL}"
                if [ "$SRC_LEVEL" = "down" ]; then
                    add_fail "${SRC_DETAIL}"
                else
                    add_warn "${SRC_DETAIL}"
                fi
            done
        fi
    else
        echo "  Could not parse monitoring response"
        add_warn "Pipeline: could not parse API response"
    fi
else
    echo "  Monitoring API unreachable"
    add_warn "Pipeline: monitoring API unreachable"
fi

# =========================================================================
# Cron Jobs (from log files)
# =========================================================================
add_section "Cron Jobs (last 4h)"

echo ""
echo "[10/10] Cron jobs..."

# job_name:expected_interval_minutes
CRON_JOBS="news-ingest:60 event-processor:15 deep-research:15 crawl-frontier:30 sync-data:30 news-digest:60 code-update:15"
NOW_EPOCH=$(date +%s)

for job_entry in $CRON_JOBS; do
    JOB_NAME="${job_entry%%:*}"
    EXPECTED_MIN="${job_entry##*:}"
    STALE_THRESHOLD=$((EXPECTED_MIN * 2))
    LOG_FILE="${LOG_DIR}/${JOB_NAME}.log"

    if [ -f "$LOG_FILE" ]; then
        # Get the last SUCCESS timestamp from the log
        LAST_SUCCESS=$(grep 'SUCCESS' "$LOG_FILE" 2>/dev/null | tail -1 || echo "")
        if [ -n "$LAST_SUCCESS" ]; then
            # Extract timestamp: [2026-02-10 14:15:00 UTC]
            TS=$(echo "$LAST_SUCCESS" | sed -n 's/^\[\([^]]*\)\].*/\1/p')
            if [ -n "$TS" ]; then
                # Parse timestamp to epoch (remove UTC suffix for date -d)
                TS_CLEAN="${TS% UTC}"
                TS_EPOCH=$(date -d "${TS_CLEAN}" +%s 2>/dev/null || echo "0")
                if [ "$TS_EPOCH" -gt 0 ] 2>/dev/null; then
                    MINS_AGO=$(( (NOW_EPOCH - TS_EPOCH) / 60 ))
                    if [ "$MINS_AGO" -lt 60 ]; then
                        AGO_STR="${MINS_AGO}m ago"
                    elif [ "$MINS_AGO" -lt 1440 ]; then
                        AGO_STR="$(( MINS_AGO / 60 ))h ago"
                    else
                        AGO_STR="$(( MINS_AGO / 1440 ))d ago"
                    fi

                    echo "  ${JOB_NAME}: last success ${AGO_STR}"
                    if [ "$MINS_AGO" -le "$STALE_THRESHOLD" ]; then
                        add_ok "${JOB_NAME}: ${AGO_STR}"
                    else
                        add_warn "${JOB_NAME}: ${AGO_STR} (stale)"
                    fi
                else
                    echo "  ${JOB_NAME}: could not parse timestamp"
                    add_warn "${JOB_NAME}: unparseable timestamp"
                fi
            else
                echo "  ${JOB_NAME}: no timestamp found"
                add_warn "${JOB_NAME}: no timestamp in log"
            fi
        else
            echo "  ${JOB_NAME}: no SUCCESS in log"
            add_fail "${JOB_NAME}: no success found"
        fi
    else
        echo "  ${JOB_NAME}: no log file"
        add_warn "${JOB_NAME}: no log file"
    fi
done

# --- Build Slack message ---
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M UTC')
HOST="${BUILDATLAS_HOST:-vm-buildatlas-cron}"

if [ "$ISSUES" -eq 0 ]; then
    TITLE="Infrastructure Health — All Systems Operational"
    STATUS="success"
else
    TITLE="Infrastructure Health — ${ISSUES} Issue(s) Detected"
    STATUS="warning"
fi

# Build body with status emoji per component and section headers
BODY=""
for entry in "${RESULTS[@]}"; do
    level="${entry%% *}"
    text="${entry#* }"
    case "$level" in
        section) BODY="${BODY}"$'\n'"*${text}*"$'\n' ;;
        ok)      BODY="${BODY}:white_check_mark: ${text}"$'\n' ;;
        fail)    BODY="${BODY}:x: ${text}"$'\n' ;;
        warn)    BODY="${BODY}:warning: ${text}"$'\n' ;;
    esac
done

BODY="${BODY}"$'\n'"_Host: ${HOST} • ${TIMESTAMP}_"

echo ""
echo "=== Posting to Slack (issues=$ISSUES) ==="

SLACK_TITLE="$TITLE" \
SLACK_STATUS="$STATUS" \
SLACK_BODY="$BODY" \
python3 "$REPO_DIR/scripts/slack_notify.py" || true

echo ""
echo "=== Health report complete ==="
