#!/bin/bash
# morning-health-check.sh — Daily 08:00 AM (local) infra health check
# Runs on macOS laptop via launchd. Checks all Azure services, starts
# anything that's down, sends Slack + email report.
set -uo pipefail

# --- Config ---
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:?Set SLACK_WEBHOOK_URL env var}"
RESEND_API_KEY="${RESEND_API_KEY:?Set RESEND_API_KEY env var}"
ALERT_EMAIL="${ALERT_EMAIL:-ops@buildatlas.net}"
FROM_EMAIL="${FROM_EMAIL:-BuildAtlas Ops <onboarding@resend.dev>}"

API_URL="https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net"
FRONTEND_URL="https://buildatlas.net"

RG_AKS="aistartuptr"
RG_PG="aistartupstr"
RG_WEB="rg-startup-analysis"
VM_NAME="vm-buildatlas-cron"
AKS_NAME="aks-aistartuptr"
PG_NAME="aistartupstr"
REDIS_NAME="aistartupstr-redis-cache"
WEBAPP_NAME="buildatlas-web"

LOG_FILE="/tmp/buildatlas-morning-health.log"
TIMESTAMP="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# --- Helpers ---
checks_passed=0
checks_failed=0
actions_taken=()
failures=()

check() {
    local name="$1"
    local result="$2"
    local expected="$3"
    if echo "$result" | grep -qi "$expected"; then
        checks_passed=$((checks_passed + 1))
        echo "  OK: $name"
    else
        checks_failed=$((checks_failed + 1))
        failures+=("$name: got '$result', expected '$expected'")
        echo "  FAIL: $name — got '$result'"
    fi
}

# --- Checks ---
echo "=== BuildAtlas Morning Health Check ==="
echo "Timestamp: $TIMESTAMP"
echo ""

# 1. VM
echo "Checking VM..."
VM_STATE="$(az vm show -g "$RG_AKS" -n "$VM_NAME" -d --query powerState -o tsv 2>/dev/null || echo "unknown")"
if echo "$VM_STATE" | grep -qi "running"; then
    checks_passed=$((checks_passed + 1))
    echo "  OK: VM ($VM_STATE)"
else
    echo "  WARN: VM is $VM_STATE — starting..."
    if az vm start -g "$RG_AKS" -n "$VM_NAME" --no-wait 2>/dev/null; then
        actions_taken+=("Started VM (was $VM_STATE)")
        echo "  ACTION: VM start initiated"
        # Wait up to 90s for VM to come up
        for i in $(seq 1 6); do
            sleep 15
            NEW_STATE="$(az vm show -g "$RG_AKS" -n "$VM_NAME" -d --query powerState -o tsv 2>/dev/null || echo "unknown")"
            if echo "$NEW_STATE" | grep -qi "running"; then
                checks_passed=$((checks_passed + 1))
                echo "  OK: VM now running after ${i}x15s"
                break
            fi
            if [ "$i" -eq 6 ]; then
                checks_failed=$((checks_failed + 1))
                failures+=("VM: still $NEW_STATE after 90s wait")
                echo "  FAIL: VM still $NEW_STATE"
            fi
        done
    else
        checks_failed=$((checks_failed + 1))
        failures+=("VM: failed to start (was $VM_STATE)")
        echo "  FAIL: Could not start VM"
    fi
fi

# 2. AKS
echo "Checking AKS..."
AKS_STATE="$(az aks show -g "$RG_AKS" -n "$AKS_NAME" --query 'powerState.code' -o tsv 2>/dev/null || echo "unknown")"
check "AKS" "$AKS_STATE" "Running"

# 3. PostgreSQL
echo "Checking PostgreSQL..."
PG_STATE="$(az postgres flexible-server show -g "$RG_PG" -n "$PG_NAME" --query state -o tsv 2>/dev/null || echo "unknown")"
if echo "$PG_STATE" | grep -qi "Ready"; then
    checks_passed=$((checks_passed + 1))
    echo "  OK: PostgreSQL ($PG_STATE)"
else
    echo "  WARN: PostgreSQL is $PG_STATE — starting..."
    if az postgres flexible-server start -g "$RG_PG" -n "$PG_NAME" 2>/dev/null; then
        actions_taken+=("Started PostgreSQL (was $PG_STATE)")
        checks_passed=$((checks_passed + 1))
        echo "  ACTION: PostgreSQL started"
    else
        checks_failed=$((checks_failed + 1))
        failures+=("PostgreSQL: failed to start (was $PG_STATE)")
    fi
fi

# 4. Redis
echo "Checking Redis..."
REDIS_STATE="$(az redis show -g "$RG_PG" -n "$REDIS_NAME" --query provisioningState -o tsv 2>/dev/null || echo "unknown")"
check "Redis" "$REDIS_STATE" "Succeeded"

# 5. App Service (Frontend)
echo "Checking App Service..."
WEBAPP_STATE="$(az webapp show -g "$RG_WEB" -n "$WEBAPP_NAME" --query state -o tsv 2>/dev/null || echo "unknown")"
if echo "$WEBAPP_STATE" | grep -qi "Running"; then
    checks_passed=$((checks_passed + 1))
    echo "  OK: App Service ($WEBAPP_STATE)"
else
    echo "  WARN: App Service is $WEBAPP_STATE — starting..."
    if az webapp start -g "$RG_WEB" -n "$WEBAPP_NAME" 2>/dev/null; then
        actions_taken+=("Started App Service (was $WEBAPP_STATE)")
        checks_passed=$((checks_passed + 1))
        echo "  ACTION: App Service started"
    else
        checks_failed=$((checks_failed + 1))
        failures+=("App Service: failed to start (was $WEBAPP_STATE)")
    fi
fi

# 6. API Health (HTTP)
echo "Checking API health endpoint..."
API_RESPONSE="$(curl -s -o /tmp/ba-health.json -w '%{http_code}' --max-time 10 "$API_URL/health" 2>/dev/null || echo "000")"
if [ "$API_RESPONSE" = "200" ]; then
    checks_passed=$((checks_passed + 1))
    API_DETAIL="$(python3 -c "import json; d=json.load(open('/tmp/ba-health.json')); print(f\"db={d.get('database','?')} cache={d.get('cache',{}).get('connected','?')} sha={d.get('build_sha','?')}\")" 2>/dev/null || echo "ok")"
    echo "  OK: API health 200 ($API_DETAIL)"
else
    checks_failed=$((checks_failed + 1))
    failures+=("API health: HTTP $API_RESPONSE")
    echo "  FAIL: API health returned $API_RESPONSE"
fi

# 7. Frontend (HTTP)
echo "Checking frontend..."
FE_RESPONSE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$FRONTEND_URL" 2>/dev/null || echo "000")"
check "Frontend HTTP" "$FE_RESPONSE" "200"

# 8. Storage Account
echo "Checking Storage..."
STORAGE_STATE="$(az storage account show -g "$RG_AKS" -n buildatlasstorage --query provisioningState -o tsv 2>/dev/null || echo "unknown")"
check "Storage" "$STORAGE_STATE" "Succeeded"

# --- Summary ---
echo ""
echo "=== Summary ==="
TOTAL=$((checks_passed + checks_failed))
echo "Checks: $checks_passed/$TOTAL passed"

if [ ${#actions_taken[@]} -gt 0 ]; then
    echo "Actions taken:"
    for a in "${actions_taken[@]}"; do echo "  - $a"; done
fi

if [ ${#failures[@]} -gt 0 ]; then
    echo "Failures:"
    for f in "${failures[@]}"; do echo "  - $f"; done
fi

# --- Build message ---
if [ "$checks_failed" -eq 0 ]; then
    STATUS="success"
    EMOJI=":white_check_mark:"
    SUBJECT="BuildAtlas Morning Check: All Systems Operational"
    HEADLINE="All $TOTAL checks passed"
else
    STATUS="failure"
    EMOJI=":x:"
    SUBJECT="BuildAtlas Morning Check: $checks_failed/$TOTAL FAILED"
    HEADLINE="$checks_failed of $TOTAL checks failed"
fi

BODY="$HEADLINE"
if [ ${#actions_taken[@]} -gt 0 ]; then
    BODY="$BODY\n\n*Auto-remediation:*"
    for a in "${actions_taken[@]}"; do BODY="$BODY\n• $a"; done
fi
if [ ${#failures[@]} -gt 0 ]; then
    BODY="$BODY\n\n*Failures:*"
    for f in "${failures[@]}"; do BODY="$BODY\n• $f"; done
fi
BODY="$BODY\n\n_Ran at $TIMESTAMP from laptop_"

# --- Send Slack ---
echo ""
echo "Sending Slack notification..."
SLACK_PAYLOAD="$(python3 -c "
import json, sys
emoji = sys.argv[1]
title = sys.argv[2]
body = sys.argv[3]
blocks = [
    {'type': 'section', 'text': {'type': 'mrkdwn', 'text': f'{emoji} *{title}*'}},
    {'type': 'section', 'text': {'type': 'mrkdwn', 'text': body}},
]
print(json.dumps({'blocks': blocks}))
" "$EMOJI" "$SUBJECT" "$(echo -e "$BODY")")"

SLACK_RESULT="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    -d "$SLACK_PAYLOAD" \
    "$SLACK_WEBHOOK_URL" 2>/dev/null || echo "000")"
echo "  Slack: HTTP $SLACK_RESULT"

# --- Send Email via Resend ---
echo "Sending email notification..."
EMAIL_HTML="<h2>${SUBJECT}</h2><p>$(echo -e "$BODY" | sed 's/$/<br>/g' | sed 's/\*//g')</p>"

EMAIL_JSON_FILE="$(mktemp /tmp/ba-email.XXXXXX)"
python3 - "$FROM_EMAIL" "$ALERT_EMAIL" "$SUBJECT" "$EMAIL_HTML" > "$EMAIL_JSON_FILE" <<'PYEOF'
import json, sys
print(json.dumps({
    "from": sys.argv[1],
    "to": [sys.argv[2]],
    "subject": sys.argv[3],
    "html": sys.argv[4],
}))
PYEOF

EMAIL_RESULT="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    'https://api.resend.com/emails' \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    -H 'Content-Type: application/json' \
    -d @"$EMAIL_JSON_FILE" 2>/dev/null || echo "000")"
rm -f "$EMAIL_JSON_FILE"
echo "  Email: HTTP $EMAIL_RESULT"

echo ""
echo "=== Morning Health Check Complete ==="

# Exit with failure code if any checks failed (useful for launchd logging)
if [ "$checks_failed" -gt 0 ]; then
    exit 1
fi
exit 0
