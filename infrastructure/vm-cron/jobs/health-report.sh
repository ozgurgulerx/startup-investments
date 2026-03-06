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
FRONTIER_MONITOR_URL="${API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}/api/admin/monitoring/frontier"
RUNTIME_MONITOR_URL="${API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}/api/admin/monitoring/runtime?window_min=10"
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

list_contains_job() {
    local job="${1:-}"
    local raw="${2:-}"

    raw="$(echo "$raw" | tr -d '[:space:]')"

    if [ -z "$job" ] || [ -z "$raw" ]; then
        return 1
    fi
    if [ "$raw" = "off" ] || [ "$raw" = "none" ] || [ "$raw" = "0" ]; then
        return 1
    fi
    if [ "$raw" = "all" ]; then
        return 0
    fi
    case ",$raw," in
        *,"$job",*) return 0 ;;
        *) return 1 ;;
    esac
}

is_job_disabled() {
    local job="${1:-}"
    if [ -z "$job" ]; then
        return 1
    fi

    if list_contains_job "$job" "${BUILDATLAS_DISABLED_JOBS:-}" || list_contains_job "$job" "${BUILDATLAS_VM_CRON_DISABLED_JOBS:-}"; then
        return 0
    fi

    # Mirror runner.sh safety net: repo-managed list for jobs migrated to AKS.
    local runner="${BUILDATLAS_RUNNER:-vm-cron}"
    if [ "$runner" != "vm-cron" ]; then
        return 1
    fi

    local file="${BUILDATLAS_VM_CRON_DISABLED_JOBS_FILE:-$REPO_DIR/infrastructure/vm-cron/vm-cron-disabled-jobs}"
    if [ ! -f "$file" ]; then
        return 1
    fi

    local raw=""
    raw="$(sed -e 's/#.*$//' -e 's/[[:space:]]//g' "$file" | tr '\n' ',' | tr -s ',' | sed -e 's/^,//' -e 's/,$//')"
    list_contains_job "$job" "$raw"
}

# =========================================================================
# Infrastructure
# =========================================================================
add_section "Infrastructure"

# --- 1. PostgreSQL ---
echo ""
echo "[1/12] PostgreSQL..."
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
echo "[2/12] AKS..."
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
echo "[3/12] Redis..."
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
echo "[4/12] App Service..."
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
echo "[5/12] API health..."
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

# --- 6. API runtime SLOs (rolling window) ---
echo ""
echo "[6/12] API runtime (10m)..."
if [ -z "${API_KEY:-}" ]; then
    echo "  API_KEY missing"
    add_fail "API runtime: API_KEY missing"
elif [ -z "${ADMIN_KEY:-}" ]; then
    echo "  ADMIN_KEY missing"
    add_fail "API runtime: ADMIN_KEY missing"
else
    RUNTIME_JSON=$(curl -sf \
        -H "X-API-Key: ${API_KEY}" \
        -H "X-Admin-Key: ${ADMIN_KEY}" \
        "$RUNTIME_MONITOR_URL" 2>/dev/null || echo "")

    if [ -n "$RUNTIME_JSON" ]; then
        RUNTIME_INFO=$(python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print('error')
    raise SystemExit(0)

req = d.get('requests') or {}
status = req.get('status') or {}
pool = d.get('pool') or {}

total = int(req.get('total') or 0)
err5xx = int(status.get('5xx') or 0)
p95 = int(req.get('p95_ms') or 0)
p99 = int(req.get('p99_ms') or 0)
waiting = int(pool.get('waitingCount') or 0)
rate = (err5xx * 100.0 / total) if total > 0 else 0.0

sev = 'ok'
if rate >= 5.0 or p95 >= 5000 or waiting >= 10:
    sev = 'fail'
elif rate >= 2.0 or p95 >= 2000 or waiting > 0:
    sev = 'warn'

print(f\"{sev}|{total}|{err5xx}|{rate:.2f}|{p95}|{p99}|{waiting}\")
" <<< "$RUNTIME_JSON" 2>/dev/null || echo "error")

        if [ "$RUNTIME_INFO" != "error" ]; then
            IFS='|' read -r SEV TOTAL ERR5XX RATE P95 P99 WAITING <<< "$RUNTIME_INFO"
            echo "  total=${TOTAL} 5xx=${ERR5XX} (${RATE}%) p95=${P95}ms p99=${P99}ms waiting=${WAITING}"
            if [ "$SEV" = "fail" ]; then
                add_fail "API runtime: 5xx ${RATE}% p95 ${P95}ms waiting ${WAITING}"
            elif [ "$SEV" = "warn" ]; then
                add_warn "API runtime: 5xx ${RATE}% p95 ${P95}ms waiting ${WAITING}"
            else
                add_ok "API runtime: 5xx ${RATE}% p95 ${P95}ms waiting ${WAITING}"
            fi
        else
            echo "  Could not parse runtime monitoring response"
            add_warn "API runtime: parse error"
        fi
    else
        echo "  Runtime monitoring API unreachable"
        add_warn "API runtime: unreachable"
    fi
fi

# --- 7. Frontend ---
echo ""
echo "[7/12] Frontend..."
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

# --- 8. VM disk ---
echo ""
echo "[8/12] VM disk..."
DISK_PCT=$(df / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%' || echo "?")
echo "  Disk usage: ${DISK_PCT}%"
if [ "$DISK_PCT" != "?" ] && [ "$DISK_PCT" -lt 85 ] 2>/dev/null; then
    add_ok "Disk: ${DISK_PCT}%"
elif [ "$DISK_PCT" != "?" ] && [ "$DISK_PCT" -ge 85 ] 2>/dev/null; then
    add_fail "Disk: ${DISK_PCT}%"
else
    add_warn "Disk: unknown"
fi

# --- 9. VM memory ---
echo ""
echo "[9/12] VM memory..."
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
echo "[10/12] News pipeline..."
MONITOR_JSON=""
if [ -z "${API_KEY:-}" ]; then
    echo "  API_KEY missing"
    add_fail "Pipeline: API_KEY missing"
elif [ -z "${ADMIN_KEY:-}" ]; then
    echo "  ADMIN_KEY missing"
    add_fail "Pipeline: ADMIN_KEY missing"
else
    MONITOR_JSON=$(curl -sf \
        -H "X-API-Key: ${API_KEY}" \
        -H "X-Admin-Key: ${ADMIN_KEY}" \
        "$MONITOR_URL" 2>/dev/null || echo "")
fi

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
    if [ -z "${API_KEY:-}" ] || [ -z "${ADMIN_KEY:-}" ]; then
        : # Key failures already recorded above.
    else
        echo "  Monitoring API unreachable"
        add_warn "Pipeline: monitoring API unreachable"
    fi
fi

# =========================================================================
# Crawler Frontier (via monitoring API)
# =========================================================================
add_section "Crawler Frontier"

echo ""
echo "[11/12] Frontier..."

FRONTIER_JSON=""
if [ -z "${API_KEY:-}" ]; then
    echo "  API_KEY missing"
    add_fail "Frontier: API_KEY missing"
elif [ -z "${ADMIN_KEY:-}" ]; then
    echo "  ADMIN_KEY missing"
    add_fail "Frontier: ADMIN_KEY missing"
else
    FRONTIER_JSON=$(curl -sf \
        -H "X-API-Key: ${API_KEY}" \
        -H "X-Admin-Key: ${ADMIN_KEY}" \
        "$FRONTIER_MONITOR_URL" 2>/dev/null || echo "")
fi

if [ -n "$FRONTIER_JSON" ]; then
    FRONTIER_INFO=$(python3 -c "
import json, sys

try:
    data = json.loads(sys.stdin.read())
except Exception:
    print('error')
    raise SystemExit(0)

summary = data.get('summary') or {}
queue = data.get('queue') or {}
runs = data.get('runs24h') or {}
urls = data.get('urls') or {}
domains = data.get('domains') or []
unblock = data.get('unblockConversion24h') or {}

due = int(queue.get('due') or 0)
total = int(queue.get('total') or 0)
stale = int(queue.get('staleLeases') or 0)
due_p95_min = float(summary.get('dueAgeP95Minutes') or 0)
success_pct = float(runs.get('successRatePct') or 0)
attempts = int(runs.get('totalAttempts') or 0)
mode = str(runs.get('mode') or '')
crawled_pct = float(urls.get('crawledPct') or 0)
never_crawled = int(urls.get('neverCrawled') or 0)
provider_opp = int(unblock.get('providerOpportunities') or 0)
provider_success_pct = float(unblock.get('providerSuccessRatePct') or 0)
latest_min = urls.get('minsSinceLatestCrawl', None)

top_domains = sorted(
    [d for d in domains if d.get('domain')],
    key=lambda d: float(d.get('block_rate') or 0),
    reverse=True
)[:20]
blocked_gt_20 = sum(1 for d in top_domains if float(d.get('block_rate') or 0) > 0.2)
top20_blocked_rate_pct = (blocked_gt_20 * 100.0 / len(top_domains)) if top_domains else 0.0

latest_str = 'unknown'
try:
    latest_str = f\"{float(latest_min):.1f}m\" if latest_min is not None else 'unknown'
except Exception:
    latest_str = 'unknown'

print(f\"{due}|{total}|{stale}|{due_p95_min}|{success_pct}|{attempts}|{mode}|{crawled_pct}|{latest_str}|{never_crawled}|{top20_blocked_rate_pct:.1f}|{provider_opp}|{provider_success_pct:.1f}\")
" <<< "$FRONTIER_JSON" 2>/dev/null || echo "error")

    if [ "$FRONTIER_INFO" != "error" ] && [ -n "$FRONTIER_INFO" ]; then
        IFS='|' read -r F_DUE F_TOTAL F_STALE F_DUE_P95_MIN F_SUCCESS_PCT F_ATTEMPTS F_MODE F_CRAWLED_PCT F_LATEST F_NEVER_CRAWLED F_TOP20_BLOCKED_PCT F_PROVIDER_OPP F_PROVIDER_SUCCESS_PCT <<< "$FRONTIER_INFO"

        echo "  Queue: due ${F_DUE}/${F_TOTAL} (stale ${F_STALE}), due_age_p95=${F_DUE_P95_MIN}m"
        echo "  Runs: ${F_SUCCESS_PCT}% success (${F_ATTEMPTS} attempts, mode=${F_MODE:-unknown})"
        echo "  Coverage: ${F_CRAWLED_PCT}% crawled, never=${F_NEVER_CRAWLED}, latest=${F_LATEST}"
        echo "  Top20 blocked-rate share: ${F_TOP20_BLOCKED_PCT}%  Provider success: ${F_PROVIDER_SUCCESS_PCT}% (${F_PROVIDER_OPP} opportunities)"

        add_ok "Frontier queue: due ${F_DUE}/${F_TOTAL}, stale ${F_STALE}, p95 ${F_DUE_P95_MIN}m"

        SUCCESS_INT="${F_SUCCESS_PCT%.*}"
        DUE_P95_INT="${F_DUE_P95_MIN%.*}"
        TOP20_BLOCKED_INT="${F_TOP20_BLOCKED_PCT%.*}"
        PROVIDER_SUCCESS_INT="${F_PROVIDER_SUCCESS_PCT%.*}"
        # Heuristic thresholds (aim for fast detection without paging on known backlog)
        if [ "${F_STALE:-0}" -gt 0 ] 2>/dev/null; then
            add_warn "Frontier: stale leases detected (${F_STALE})"
        fi
        if [ "${F_ATTEMPTS:-0}" -gt 0 ] 2>/dev/null; then
            if [ "${SUCCESS_INT:-0}" -lt 30 ] 2>/dev/null; then
                add_fail "Frontier runs (24h): ${F_SUCCESS_PCT}% success (${F_ATTEMPTS} attempts)"
            elif [ "${SUCCESS_INT:-0}" -lt 60 ] 2>/dev/null; then
                add_warn "Frontier runs (24h): ${F_SUCCESS_PCT}% success (${F_ATTEMPTS} attempts)"
            else
                add_ok "Frontier runs (24h): ${F_SUCCESS_PCT}% success (${F_ATTEMPTS} attempts)"
            fi
        else
            add_warn "Frontier runs (24h): no recent attempts (mode=${F_MODE:-unknown})"
        fi

        if [ "${DUE_P95_INT:-0}" -gt 4320 ] 2>/dev/null; then
            add_fail "Frontier due age p95: ${F_DUE_P95_MIN}m"
        elif [ "${DUE_P95_INT:-0}" -gt 240 ] 2>/dev/null; then
            add_warn "Frontier due age p95: ${F_DUE_P95_MIN}m"
        fi

        if [ "${TOP20_BLOCKED_INT:-0}" -gt 20 ] 2>/dev/null; then
            add_warn "Frontier top20 blocked-rate share: ${F_TOP20_BLOCKED_PCT}% (>20%)"
        fi

        if [ "${F_PROVIDER_OPP:-0}" -gt 0 ] 2>/dev/null && [ "${PROVIDER_SUCCESS_INT:-0}" -lt 40 ] 2>/dev/null; then
            add_warn "Frontier provider success: ${F_PROVIDER_SUCCESS_PCT}% with ${F_PROVIDER_OPP} opportunities (<40%)"
        fi

        FRONTIER_STATE_DIR="${FRONTIER_STATE_DIR:-/var/lib/buildatlas}"
        if ! mkdir -p "$FRONTIER_STATE_DIR" 2>/dev/null; then
            FRONTIER_STATE_DIR="/tmp/buildatlas"
            mkdir -p "$FRONTIER_STATE_DIR" 2>/dev/null || true
        fi
        NEVER_STATE_FILE="${FRONTIER_NEVER_CRAWLED_STATE_FILE:-$FRONTIER_STATE_DIR/frontier-never-crawled.state}"
        NOW_TS="$(date +%s)"
        if [ -f "$NEVER_STATE_FILE" ]; then
            PREV_TS="$(awk '{print $1}' "$NEVER_STATE_FILE" 2>/dev/null || echo 0)"
            PREV_VAL="$(awk '{print $2}' "$NEVER_STATE_FILE" 2>/dev/null || echo -1)"
            if [ "${PREV_TS:-0}" -gt 0 ] 2>/dev/null && [ $((NOW_TS - PREV_TS)) -ge 604800 ] 2>/dev/null; then
                if [ "${F_NEVER_CRAWLED:-0}" -ge "${PREV_VAL:-0}" ] 2>/dev/null; then
                    add_warn "Frontier never-crawled not improving week-over-week (${PREV_VAL} -> ${F_NEVER_CRAWLED})"
                fi
                echo "${NOW_TS} ${F_NEVER_CRAWLED}" > "$NEVER_STATE_FILE" 2>/dev/null || true
            fi
        else
            echo "${NOW_TS} ${F_NEVER_CRAWLED}" > "$NEVER_STATE_FILE" 2>/dev/null || true
        fi
    else
        echo "  Could not parse frontier monitoring response"
        add_warn "Frontier: could not parse API response"
    fi
else
    if [ -z "${API_KEY:-}" ] || [ -z "${ADMIN_KEY:-}" ]; then
        : # Key failures already recorded above.
    else
        echo "  Frontier monitoring API unreachable"
        add_warn "Frontier: monitoring API unreachable"
    fi
fi

# Detect raw capture storage auth errors (best-effort log scan)
CRAWL_LOG="${LOG_DIR}/crawl-frontier.log"
if [ -f "$CRAWL_LOG" ]; then
    CAPTURE_AUTH_ERRORS=$(grep -a -E "\\[raw-capture\\] disabling blob upload|Error uploading blob raw-captures/.*(AuthorizationFailure|AuthorizationPermissionMismatch|AuthenticationFailed|KeyBasedAuthenticationNotPermitted)" "$CRAWL_LOG" | tail -n 200 | wc -l | tr -d '[:space:]' || echo "0")
    if [ "$CAPTURE_AUTH_ERRORS" -gt 0 ] 2>/dev/null; then
        add_warn "Raw captures: recent blob upload auth failures (${CAPTURE_AUTH_ERRORS})"
    fi
fi

# Detect blob storage auth/network errors in sync-data (change detection degraded => stale data risk)
SYNC_LOG="${LOG_DIR}/sync-data.log"
if [ -f "$SYNC_LOG" ]; then
    # sync-data.sh prints a stable warning line when blob auth fails.
    # Only consider the most recent run block (since the last START) to avoid
    # persistent false positives after a transient auth/network blip.
    SYNC_START_LINE=$(grep -a -n "START: sync-data" "$SYNC_LOG" 2>/dev/null | tail -1 | cut -d: -f1 || echo "")
    if [ -n "$SYNC_START_LINE" ]; then
        if sed -n "${SYNC_START_LINE},\$p" "$SYNC_LOG" 2>/dev/null | grep -a -q "WARN: Blob storage auth failed (exit code 2)"; then
            SYNC_BLOB_DEGRADED=1
        else
            SYNC_BLOB_DEGRADED=0
        fi
    else
        SYNC_BLOB_DEGRADED=0
    fi
    if [ "${SYNC_BLOB_DEGRADED:-0}" -gt 0 ] 2>/dev/null; then
        add_warn "Blob sync: storage auth/network failures in latest sync-data run (change detection degraded; may be stale)"
    fi
fi

# Storage private endpoint sanity (best-effort; avoids silent blob degradation).
STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT_NAME:-buildatlasstorage}"
if [ -n "$STORAGE_ACCOUNT" ]; then
    STORAGE_HOST="${STORAGE_ACCOUNT}.blob.core.windows.net"
    STORAGE_IP=$(getent hosts "$STORAGE_HOST" 2>/dev/null | awk '{print $1}' | head -n 1 || echo "")

    STORAGE_PRIVATE=0
    if [ -n "$STORAGE_IP" ]; then
        case "$STORAGE_IP" in
            10.*|192.168.*) STORAGE_PRIVATE=1 ;;
            172.*)
                SECOND_OCTET="$(echo "$STORAGE_IP" | cut -d. -f2)"
                if [ -n "$SECOND_OCTET" ] && [ "$SECOND_OCTET" -ge 16 ] 2>/dev/null && [ "$SECOND_OCTET" -le 31 ] 2>/dev/null; then
                    STORAGE_PRIVATE=1
                fi
                ;;
        esac
    fi

    if [ -n "$STORAGE_IP" ] && [ "$STORAGE_PRIVATE" -eq 1 ]; then
        add_ok "Storage DNS: ${STORAGE_HOST} -> ${STORAGE_IP} (private)"
    elif [ -n "$STORAGE_IP" ]; then
        add_warn "Storage DNS: ${STORAGE_HOST} -> ${STORAGE_IP} (not private; private endpoint may be bypassed)"
    else
        add_warn "Storage DNS: could not resolve ${STORAGE_HOST}"
    fi

    # Ensure managed identity AAD access still works (shared key is disabled in prod).
    if az storage container list --account-name "$STORAGE_ACCOUNT" --auth-mode login -o none 2>/dev/null; then
        add_ok "Storage AAD: OK"
    else
        add_warn "Storage AAD: cannot list containers (RBAC/network/private endpoint)"
    fi
fi

# =========================================================================
# Cron Jobs (from log files)
# =========================================================================
add_section "Cron Jobs (last 4h)"

echo ""
echo "[12/12] Cron jobs..."

# job_name:expected_interval_minutes
CRON_JOBS="news-ingest:60 event-processor:15 deep-research:15 onboarding-alerts:5 crawl-frontier:30 sync-data:30 news-digest:60 signal-aggregate:240 delta-generate:240 generate-alerts:240 code-update:15"
NOW_EPOCH=$(date +%s)

# Best-effort: read AKS CronJob lastScheduleTime so jobs migrated off the VM
# don't show up as "stale" here.
AKS_CRON_AVAILABLE=0
declare -A AKS_CRON_SUSPEND
declare -A AKS_CRON_LAST_SCHEDULE
AKS_JOBS_AVAILABLE=0
declare -A AKS_JOB_LAST_NAME
declare -A AKS_JOB_LAST_STATUS
declare -A AKS_JOB_LAST_TIME
declare -A AKS_JOB_PREV_STATUS
declare -A AKS_JOB_PREV_TIME

AKS_CRON_INFO=$(az aks command invoke \
    --resource-group "$AKS_RG" \
    --name "$AKS_NAME" \
    --command "kubectl get cronjobs -n default -o jsonpath='{range .items[*]}{.metadata.name}{\"|\"}{.spec.suspend}{\"|\"}{.status.lastScheduleTime}{\"\\n\"}{end}'" \
    --query "logs" -o tsv 2>/dev/null || echo "")

if [ -n "$AKS_CRON_INFO" ] && ! echo "$AKS_CRON_INFO" | grep -qi '^error:'; then
    AKS_CRON_AVAILABLE=1
    while IFS='|' read -r N S L; do
        [ -n "$N" ] || continue
        if [ -z "$S" ]; then
            S="false"
        fi
        AKS_CRON_SUSPEND["$N"]="$S"
        AKS_CRON_LAST_SCHEDULE["$N"]="$L"
    done <<< "$AKS_CRON_INFO"
fi

# Also fetch last Job status per CronJob to detect "fresh but failing" cases.
# We rely on the shared label schema in pipelines-cronjobs.yaml:
#   metadata.labels.job=<cronjob-name>
AKS_JOB_INFO=$(az aks command invoke \
    --resource-group "$AKS_RG" \
    --name "$AKS_NAME" \
    --command "kubectl get jobs -n default -l app=buildatlas-pipelines --sort-by=.metadata.creationTimestamp -o jsonpath='{range .items[*]}{.metadata.labels.job}{\"|\"}{.metadata.name}{\"|\"}{.status.succeeded}{\"|\"}{.status.failed}{\"|\"}{.status.completionTime}{\"|\"}{.metadata.creationTimestamp}{\"\\n\"}{end}'" \
    --query "logs" -o tsv 2>/dev/null || echo "")

if [ -n "$AKS_JOB_INFO" ] && ! echo "$AKS_JOB_INFO" | grep -qi '^error:'; then
    AKS_JOBS_AVAILABLE=1
    while IFS='|' read -r CJ JOBNAME SUCC FAIL COMP CREATED; do
        [ -n "$CJ" ] || continue

        SUCC="${SUCC:-0}"
        FAIL="${FAIL:-0}"
        STATUS="Running"
        TS="${CREATED:-}"

        if [ "$SUCC" != "<none>" ] && [ "$SUCC" != "" ] && [ "$SUCC" != "0" ] 2>/dev/null; then
            STATUS="Complete"
            TS="${COMP:-$CREATED}"
        elif [ "$FAIL" != "<none>" ] && [ "$FAIL" != "" ] && [ "$FAIL" != "0" ] 2>/dev/null; then
            STATUS="Failed"
            TS="${COMP:-$CREATED}"
        fi

        # Input list is sorted by creationTimestamp ASC, so this tracks the
        # most recent and immediately previous job outcomes per CronJob.
        AKS_JOB_PREV_STATUS["$CJ"]="${AKS_JOB_LAST_STATUS[$CJ]:-}"
        AKS_JOB_PREV_TIME["$CJ"]="${AKS_JOB_LAST_TIME[$CJ]:-}"
        AKS_JOB_LAST_NAME["$CJ"]="$JOBNAME"
        AKS_JOB_LAST_STATUS["$CJ"]="$STATUS"
        AKS_JOB_LAST_TIME["$CJ"]="$TS"
    done <<< "$AKS_JOB_INFO"
fi

for job_entry in $CRON_JOBS; do
    JOB_NAME="${job_entry%%:*}"
    EXPECTED_MIN="${job_entry##*:}"
    STALE_THRESHOLD=$((EXPECTED_MIN * 2))
    LOG_FILE="${LOG_DIR}/${JOB_NAME}.log"

    if is_job_disabled "$JOB_NAME"; then
        # Job is intentionally not running on the VM. Verify it exists on AKS (or at least don't page ourselves).
        if [ "$AKS_CRON_AVAILABLE" = "1" ] && [ -n "${AKS_CRON_SUSPEND[$JOB_NAME]:-}" ]; then
            SUSP="${AKS_CRON_SUSPEND[$JOB_NAME]}"
            LAST="${AKS_CRON_LAST_SCHEDULE[$JOB_NAME]:-}"

            if [ "$SUSP" = "true" ]; then
                echo "  ${JOB_NAME}: AKS CronJob is suspended"
                add_fail "${JOB_NAME}: AKS CronJob suspended (job disabled on VM)"
                continue
            fi

            # Prefer last Job status if available; lastScheduleTime alone can be misleading if jobs are failing.
            JOB_STATUS="${AKS_JOB_LAST_STATUS[$JOB_NAME]:-}"
            JOB_TS="${AKS_JOB_LAST_TIME[$JOB_NAME]:-}"
            JOB_PREV_STATUS="${AKS_JOB_PREV_STATUS[$JOB_NAME]:-}"
            JOB_PREV_TS="${AKS_JOB_PREV_TIME[$JOB_NAME]:-}"

            if [ -n "$JOB_STATUS" ] && [ -n "$JOB_TS" ]; then
                TS_EPOCH=$(date -d "$JOB_TS" +%s 2>/dev/null || echo "0")
                if [ "$TS_EPOCH" -gt 0 ] 2>/dev/null; then
                    MINS_AGO=$(( (NOW_EPOCH - TS_EPOCH) / 60 ))
                    if [ "$MINS_AGO" -lt 60 ]; then
                        AGO_STR="${MINS_AGO}m ago"
                    elif [ "$MINS_AGO" -lt 1440 ]; then
                        AGO_STR="$(( MINS_AGO / 60 ))h ago"
                    else
                        AGO_STR="$(( MINS_AGO / 1440 ))d ago"
                    fi

                    echo "  ${JOB_NAME}: AKS last job ${JOB_STATUS} ${AGO_STR}"
                    if [ "$JOB_STATUS" = "Failed" ]; then
                        if [ "$JOB_PREV_STATUS" = "Failed" ]; then
                            PREV_EPOCH=$(date -d "$JOB_PREV_TS" +%s 2>/dev/null || echo "0")
                            if [ "$PREV_EPOCH" -gt 0 ] 2>/dev/null; then
                                PREV_MINS_AGO=$(( (NOW_EPOCH - PREV_EPOCH) / 60 ))
                                if [ "$PREV_MINS_AGO" -lt 60 ]; then
                                    PREV_AGO_STR="${PREV_MINS_AGO}m ago"
                                elif [ "$PREV_MINS_AGO" -lt 1440 ]; then
                                    PREV_AGO_STR="$(( PREV_MINS_AGO / 60 ))h ago"
                                else
                                    PREV_AGO_STR="$(( PREV_MINS_AGO / 1440 ))d ago"
                                fi
                                add_fail "${JOB_NAME} (AKS): consecutive failures (latest ${AGO_STR}, previous ${PREV_AGO_STR})"
                            else
                                add_fail "${JOB_NAME} (AKS): consecutive failures (latest ${AGO_STR})"
                            fi
                        else
                            add_fail "${JOB_NAME} (AKS): last job Failed ${AGO_STR}"
                        fi
                    elif [ "$MINS_AGO" -le "$STALE_THRESHOLD" ]; then
                        add_ok "${JOB_NAME} (AKS): ${JOB_STATUS} ${AGO_STR}"
                    else
                        add_warn "${JOB_NAME} (AKS): ${JOB_STATUS} ${AGO_STR} (stale)"
                    fi
                else
                    echo "  ${JOB_NAME}: AKS last job timestamp unparseable"
                    add_warn "${JOB_NAME} (AKS): unparseable last job timestamp"
                fi
            elif [ -n "$LAST" ]; then
                TS_EPOCH=$(date -d "$LAST" +%s 2>/dev/null || echo "0")
                if [ "$TS_EPOCH" -gt 0 ] 2>/dev/null; then
                    MINS_AGO=$(( (NOW_EPOCH - TS_EPOCH) / 60 ))
                    if [ "$MINS_AGO" -lt 60 ]; then
                        AGO_STR="${MINS_AGO}m ago"
                    elif [ "$MINS_AGO" -lt 1440 ]; then
                        AGO_STR="$(( MINS_AGO / 60 ))h ago"
                    else
                        AGO_STR="$(( MINS_AGO / 1440 ))d ago"
                    fi

                    echo "  ${JOB_NAME}: AKS last schedule ${AGO_STR}"
                    if [ "$MINS_AGO" -le "$STALE_THRESHOLD" ]; then
                        add_ok "${JOB_NAME} (AKS): scheduled ${AGO_STR}"
                    else
                        add_warn "${JOB_NAME} (AKS): scheduled ${AGO_STR} (stale)"
                    fi
                else
                    echo "  ${JOB_NAME}: AKS last schedule unparseable"
                    add_warn "${JOB_NAME} (AKS): unparseable lastScheduleTime"
                fi
            else
                echo "  ${JOB_NAME}: AKS has no lastScheduleTime yet"
                add_warn "${JOB_NAME} (AKS): no lastScheduleTime"
            fi
        else
            echo "  ${JOB_NAME}: disabled on VM (AKS CronJob not found)"
            add_fail "${JOB_NAME}: disabled on VM but missing AKS CronJob"
        fi
        continue
    fi

    # Guardrail: if the job isn't disabled on the VM but still exists in AKS, it may double-run.
    if [ "$AKS_CRON_AVAILABLE" = "1" ] && [ -n "${AKS_CRON_SUSPEND[$JOB_NAME]:-}" ]; then
        add_warn "${JOB_NAME}: also exists as AKS CronJob (duplicate run risk)"
    fi

    if [ -f "$LOG_FILE" ]; then
        # Get the last SUCCESS timestamp from the log
        # Some logs can contain non-UTF8 bytes (treated as "binary" by grep); force text mode.
        LAST_SUCCESS=$(grep -a 'SUCCESS' "$LOG_FILE" 2>/dev/null | tail -1 || echo "")
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
