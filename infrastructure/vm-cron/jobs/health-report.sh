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
RESULTS=()  # Each entry: "ok|fail|warn <text>"

add_ok()   { RESULTS+=("ok $1"); }
add_fail() { RESULTS+=("fail $1"); ISSUES=$((ISSUES + 1)); }
add_warn() { RESULTS+=("warn $1"); }

# --- 1. PostgreSQL ---
echo ""
echo "[1/8] PostgreSQL..."
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
echo "[2/8] AKS..."
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
echo "[3/8] Redis..."
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
echo "[4/8] App Service..."
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
echo "[5/8] API health..."
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
echo "[6/8] Frontend..."
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

# --- 7. VM disk ---
echo ""
echo "[7/8] VM disk..."
DISK_PCT=$(df / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%' || echo "?")
echo "  Disk usage: ${DISK_PCT}%"
if [ "$DISK_PCT" != "?" ] && [ "$DISK_PCT" -lt 85 ] 2>/dev/null; then
    add_ok "VM disk: ${DISK_PCT}%"
elif [ "$DISK_PCT" != "?" ] && [ "$DISK_PCT" -ge 85 ] 2>/dev/null; then
    add_fail "VM disk: ${DISK_PCT}%"
else
    add_warn "VM disk: unknown"
fi

# --- 8. VM memory ---
echo ""
echo "[8/8] VM memory..."
FREE_MB=$(free -m 2>/dev/null | awk '/Mem:/ {print $7}' || echo "?")
TOTAL_MB=$(free -m 2>/dev/null | awk '/Mem:/ {print $2}' || echo "?")
if [ "$FREE_MB" != "?" ] && [ "$TOTAL_MB" != "?" ] && [ "$TOTAL_MB" -gt 0 ] 2>/dev/null; then
    MEM_USED_PCT=$(( (TOTAL_MB - FREE_MB) * 100 / TOTAL_MB ))
    echo "  Memory: ${FREE_MB}MB free / ${TOTAL_MB}MB total (${MEM_USED_PCT}% used)"
    if [ "$FREE_MB" -lt 200 ] 2>/dev/null; then
        add_fail "VM memory: ${MEM_USED_PCT}% used (${FREE_MB}MB free)"
    else
        add_ok "VM memory: ${MEM_USED_PCT}% used (${FREE_MB}MB free)"
    fi
else
    echo "  Memory: unknown"
    add_warn "VM memory: unknown"
fi

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

# Build body with status emoji per component
BODY=""
for entry in "${RESULTS[@]}"; do
    level="${entry%% *}"
    text="${entry#* }"
    case "$level" in
        ok)   BODY="${BODY}:white_check_mark: ${text}"$'\n' ;;
        fail) BODY="${BODY}:x: ${text}"$'\n' ;;
        warn) BODY="${BODY}:warning: ${text}"$'\n' ;;
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
