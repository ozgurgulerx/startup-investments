#!/bin/bash
# setup-azure-alerts.sh — Create Azure Monitor alerts for all BuildAtlas components.
#
# Creates:
#   1. Log Analytics workspace (for App Insights)
#   2. Application Insights resource
#   3. Action Group with Slack webhook
#   4. Metric alert rules for: AKS, PostgreSQL, Redis, App Service, Front Door, Storage, VM
#
# Usage:
#   ./setup-azure-alerts.sh --slack-webhook https://hooks.slack.com/services/... [--dry-run]
#
# Idempotent: checks if each resource exists before creating.
# Run from any machine with `az` CLI authenticated.
set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────
LOCATION="uksouth"

# Resource names
LOG_WORKSPACE="log-buildatlas"
APPINSIGHTS_NAME="appinsights-buildatlas"
ACTION_GROUP_NAME="ag-buildatlas-slack"
ACTION_GROUP_SHORT="ba-slack"

# Resource groups
RG_INFRA="aistartuptr"
RG_DB="aistartupstr"
RG_WEB="rg-startup-analysis"

# Resource names (must match existing resources)
AKS_NAME="aks-aistartuptr"
PG_NAME="aistartupstr"
REDIS_NAME="aistartupstr-redis-cache"
APP_SERVICE_NAME="buildatlas-web"
STORAGE_NAME="buildatlasstorage"
VM_NAME="vm-buildatlas-cron"

# ─── Parse arguments ────────────────────────────────────────────────────────
SLACK_WEBHOOK=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --slack-webhook)
            SLACK_WEBHOOK="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 --slack-webhook <URL> [--dry-run]"
            echo ""
            echo "Creates Azure Monitor alerts for all BuildAtlas components."
            echo "Sends alerts to the specified Slack webhook URL."
            echo ""
            echo "Options:"
            echo "  --slack-webhook <URL>  Slack incoming webhook URL (required)"
            echo "  --dry-run              Print what would be created without executing"
            echo "  -h, --help             Show this help"
            exit 0
            ;;
        *)
            echo "ERROR: Unknown argument: $1"
            echo "Usage: $0 --slack-webhook <URL> [--dry-run]"
            exit 1
            ;;
    esac
done

if [[ -z "$SLACK_WEBHOOK" ]]; then
    echo "ERROR: --slack-webhook is required"
    echo "Usage: $0 --slack-webhook <URL> [--dry-run]"
    exit 1
fi

# ─── Helpers ─────────────────────────────────────────────────────────────────
CREATED=0
SKIPPED=0
FAILED=0
WARNINGS=()

log()  { echo "[$(date -u '+%H:%M:%S')] $*"; }
info() { log "INFO: $*"; }
warn() { log "WARN: $*"; WARNINGS+=("$*"); }
ok()   { log "  OK: $*"; CREATED=$((CREATED + 1)); }
skip() { log "  SKIP: $*"; SKIPPED=$((SKIPPED + 1)); }
fail() { log "  FAIL: $*"; FAILED=$((FAILED + 1)); }

run_az() {
    if $DRY_RUN; then
        echo "  [DRY RUN] az $*"
        return 0
    fi
    az "$@"
}

# Check az CLI is available and logged in
if ! command -v az &>/dev/null; then
    echo "ERROR: Azure CLI (az) is not installed"
    exit 1
fi

SUBSCRIPTION=$(az account show --query "id" -o tsv 2>/dev/null || true)
if [[ -z "$SUBSCRIPTION" ]]; then
    echo "ERROR: Not logged in to Azure. Run 'az login' first."
    exit 1
fi
info "Subscription: $SUBSCRIPTION"
info "Dry run: $DRY_RUN"
echo ""

# ─── Step 1: Log Analytics Workspace ────────────────────────────────────────
log "=== Step 1/4: Log Analytics Workspace ==="

if az monitor log-analytics workspace show \
    --resource-group "$RG_INFRA" \
    --workspace-name "$LOG_WORKSPACE" &>/dev/null; then
    skip "Workspace '$LOG_WORKSPACE' already exists"
else
    info "Creating Log Analytics workspace '$LOG_WORKSPACE'..."
    run_az monitor log-analytics workspace create \
        --resource-group "$RG_INFRA" \
        --workspace-name "$LOG_WORKSPACE" \
        --location "$LOCATION" \
        --sku PerGB2018 \
        --output none
    ok "Workspace created"
    CREATED=$((CREATED + 1))
fi

WORKSPACE_ID=$(az monitor log-analytics workspace show \
    --resource-group "$RG_INFRA" \
    --workspace-name "$LOG_WORKSPACE" \
    --query "id" -o tsv 2>/dev/null || echo "")
echo ""

# ─── Step 2: Application Insights ───────────────────────────────────────────
log "=== Step 2/4: Application Insights ==="

APPINSIGHTS_CONN_STR=""
if az monitor app-insights component show \
    --app "$APPINSIGHTS_NAME" \
    --resource-group "$RG_INFRA" &>/dev/null; then
    skip "App Insights '$APPINSIGHTS_NAME' already exists"
    APPINSIGHTS_CONN_STR=$(az monitor app-insights component show \
        --app "$APPINSIGHTS_NAME" \
        --resource-group "$RG_INFRA" \
        --query "connectionString" -o tsv 2>/dev/null || echo "")
else
    info "Creating Application Insights '$APPINSIGHTS_NAME'..."
    if [[ -n "$WORKSPACE_ID" ]]; then
        run_az monitor app-insights component create \
            --app "$APPINSIGHTS_NAME" \
            --resource-group "$RG_INFRA" \
            --location "$LOCATION" \
            --workspace "$WORKSPACE_ID" \
            --kind web \
            --application-type Node.JS \
            --output none
    else
        run_az monitor app-insights component create \
            --app "$APPINSIGHTS_NAME" \
            --resource-group "$RG_INFRA" \
            --location "$LOCATION" \
            --kind web \
            --application-type Node.JS \
            --output none
    fi
    ok "App Insights created"
    CREATED=$((CREATED + 1))

    if ! $DRY_RUN; then
        APPINSIGHTS_CONN_STR=$(az monitor app-insights component show \
            --app "$APPINSIGHTS_NAME" \
            --resource-group "$RG_INFRA" \
            --query "connectionString" -o tsv 2>/dev/null || echo "")
    fi
fi
echo ""

# ─── Step 3: Action Group ───────────────────────────────────────────────────
log "=== Step 3/4: Action Group ==="

if az monitor action-group show \
    --resource-group "$RG_INFRA" \
    --name "$ACTION_GROUP_NAME" &>/dev/null; then
    skip "Action group '$ACTION_GROUP_NAME' already exists"
else
    info "Creating action group '$ACTION_GROUP_NAME' with Slack webhook..."
    run_az monitor action-group create \
        --resource-group "$RG_INFRA" \
        --name "$ACTION_GROUP_NAME" \
        --short-name "$ACTION_GROUP_SHORT" \
        --action webhook slack-alerts "$SLACK_WEBHOOK" \
        --output none
    ok "Action group created"
    CREATED=$((CREATED + 1))
fi

ACTION_GROUP_ID=$(az monitor action-group show \
    --resource-group "$RG_INFRA" \
    --name "$ACTION_GROUP_NAME" \
    --query "id" -o tsv 2>/dev/null || echo "")
echo ""

# ─── Step 4: Metric Alert Rules ─────────────────────────────────────────────
log "=== Step 4/4: Metric Alert Rules ==="

# Helper: create a metric alert if it doesn't exist
# Usage: create_alert <name> <resource-group> <scope> <condition> <severity> <description> [window] [frequency]
create_alert() {
    local name="$1"
    local rg="$2"
    local scope="$3"
    local condition="$4"
    local severity="$5"
    local description="$6"
    local window="${7:-PT15M}"
    local frequency="${8:-PT5M}"

    if az monitor metrics alert show --name "$name" --resource-group "$rg" &>/dev/null; then
        skip "$name (already exists)"
        return 0
    fi

    info "Creating alert: $name"
    if run_az monitor metrics alert create \
        --name "$name" \
        --resource-group "$rg" \
        --scopes "$scope" \
        --condition "$condition" \
        --action "$ACTION_GROUP_ID" \
        --severity "$severity" \
        --description "$description" \
        --auto-mitigate true \
        --evaluation-frequency "$frequency" \
        --window-size "$window" \
        --output none 2>/dev/null; then
        ok "$name"
        CREATED=$((CREATED + 1))
    else
        fail "$name"
    fi
}

# ─── Resolve resource IDs ───────────────────────────────────────────────────
info "Resolving resource IDs..."

AKS_ID=$(az aks show -g "$RG_INFRA" -n "$AKS_NAME" --query "id" -o tsv 2>/dev/null || echo "")
PG_ID=$(az postgres flexible-server show -g "$RG_DB" -n "$PG_NAME" --query "id" -o tsv 2>/dev/null || echo "")
REDIS_ID=$(az redis show -g "$RG_DB" -n "$REDIS_NAME" --query "id" -o tsv 2>/dev/null || echo "")
APP_SERVICE_ID=$(az webapp show -g "$RG_WEB" -n "$APP_SERVICE_NAME" --query "id" -o tsv 2>/dev/null || echo "")
STORAGE_ID=$(az storage account show -g "$RG_INFRA" -n "$STORAGE_NAME" --query "id" -o tsv 2>/dev/null || echo "")
VM_ID=$(az vm show -g "$RG_INFRA" -n "$VM_NAME" --query "id" -o tsv 2>/dev/null || echo "")

# Front Door (Standard/Premium = Microsoft.Cdn/profiles)
FD_ID=$(az afd profile list -g "$RG_INFRA" --query "[0].id" -o tsv 2>/dev/null || echo "")

echo ""

# ─── AKS Alerts ─────────────────────────────────────────────────────────────
if [[ -n "$AKS_ID" ]]; then
    log "--- AKS alerts ---"

    # Check if Container Insights is enabled
    CI_ENABLED=$(az aks show -g "$RG_INFRA" -n "$AKS_NAME" \
        --query "addonProfiles.omsagent.enabled" -o tsv 2>/dev/null || echo "false")

    if [[ "$CI_ENABLED" != "true" ]]; then
        warn "AKS Container Insights is NOT enabled. Pod-level metrics (restarts, OOM) will not be available."
        warn "Enable with: az aks enable-addons -a monitoring -g $RG_INFRA -n $AKS_NAME --workspace-resource-id $WORKSPACE_ID"
    fi

    create_alert "alert-aks-node-cpu" "$RG_INFRA" "$AKS_ID" \
        "avg node_cpu_usage_percentage > 85" \
        2 "AKS node CPU usage exceeds 85% for 10 minutes" "PT10M" "PT5M"

    create_alert "alert-aks-node-memory" "$RG_INFRA" "$AKS_ID" \
        "avg node_memory_rss_percentage > 85" \
        2 "AKS node memory usage exceeds 85% for 10 minutes" "PT10M" "PT5M"

    if [[ "$CI_ENABLED" == "true" ]]; then
        create_alert "alert-aks-pod-restarts" "$RG_INFRA" "$AKS_ID" \
            "total kube_pod_status_ready_condition > 3" \
            2 "AKS pod restart count exceeds 3 in 15 minutes" "PT15M" "PT5M"

        create_alert "alert-aks-oom-kills" "$RG_INFRA" "$AKS_ID" \
            "total oomKilledContainerCount > 0" \
            1 "AKS container OOM kill detected" "PT15M" "PT5M"
    else
        skip "alert-aks-pod-restarts (Container Insights not enabled)"
        skip "alert-aks-oom-kills (Container Insights not enabled)"
    fi
    echo ""
else
    warn "AKS resource not found: $AKS_NAME in $RG_INFRA"
fi

# ─── PostgreSQL Alerts ───────────────────────────────────────────────────────
if [[ -n "$PG_ID" ]]; then
    log "--- PostgreSQL alerts ---"

    create_alert "alert-pg-cpu" "$RG_DB" "$PG_ID" \
        "avg cpu_percent > 80" \
        2 "PostgreSQL CPU exceeds 80% for 15 minutes"

    create_alert "alert-pg-storage" "$RG_DB" "$PG_ID" \
        "avg storage_percent > 80" \
        1 "PostgreSQL storage exceeds 80% — risk of write failures"

    create_alert "alert-pg-active-connections" "$RG_DB" "$PG_ID" \
        "avg active_connections > 40" \
        2 "PostgreSQL active connections exceed 40 (approaching limit)"

    create_alert "alert-pg-failed-connections" "$RG_DB" "$PG_ID" \
        "total connections_failed > 5" \
        2 "PostgreSQL failed connections exceed 5 in 15 minutes"

    create_alert "alert-pg-memory" "$RG_DB" "$PG_ID" \
        "avg memory_percent > 85" \
        2 "PostgreSQL memory usage exceeds 85%"
    echo ""
else
    warn "PostgreSQL resource not found: $PG_NAME in $RG_DB"
fi

# ─── Redis Alerts ────────────────────────────────────────────────────────────
if [[ -n "$REDIS_ID" ]]; then
    log "--- Redis alerts ---"

    create_alert "alert-redis-memory" "$RG_DB" "$REDIS_ID" \
        "avg usedmemorypercentage > 80" \
        2 "Redis memory usage exceeds 80%"

    create_alert "alert-redis-server-load" "$RG_DB" "$REDIS_ID" \
        "avg serverLoad > 80" \
        2 "Redis server load exceeds 80%"

    create_alert "alert-redis-connected-clients" "$RG_DB" "$REDIS_ID" \
        "avg connectedclients > 90" \
        3 "Redis connected clients exceed 90"

    create_alert "alert-redis-errors" "$RG_DB" "$REDIS_ID" \
        "total errors > 0" \
        2 "Redis errors detected"
    echo ""
else
    warn "Redis resource not found: $REDIS_NAME in $RG_DB"
fi

# ─── App Service Alerts ─────────────────────────────────────────────────────
if [[ -n "$APP_SERVICE_ID" ]]; then
    log "--- App Service alerts ---"

    create_alert "alert-web-5xx" "$RG_WEB" "$APP_SERVICE_ID" \
        "total Http5xx > 5" \
        1 "Frontend HTTP 5xx errors exceed 5 in 5 minutes" "PT5M" "PT1M"

    create_alert "alert-web-response-time" "$RG_WEB" "$APP_SERVICE_ID" \
        "avg AverageResponseTime > 5" \
        2 "Frontend average response time exceeds 5 seconds"

    create_alert "alert-web-memory" "$RG_WEB" "$APP_SERVICE_ID" \
        "avg MemoryWorkingSet > 1073741824" \
        2 "Frontend memory working set exceeds 1GB"

    create_alert "alert-web-4xx-spike" "$RG_WEB" "$APP_SERVICE_ID" \
        "total Http4xx > 50" \
        3 "Frontend HTTP 4xx spike — possible attack or misconfiguration" "PT5M" "PT1M"
    echo ""
else
    warn "App Service resource not found: $APP_SERVICE_NAME in $RG_WEB"
fi

# ─── Front Door Alerts ──────────────────────────────────────────────────────
if [[ -n "$FD_ID" ]]; then
    log "--- Front Door alerts ---"

    create_alert "alert-fd-origin-health" "$RG_INFRA" "$FD_ID" \
        "avg OriginHealthPercentage < 100" \
        1 "Front Door origin health degraded — API backend may be down"

    create_alert "alert-fd-latency" "$RG_INFRA" "$FD_ID" \
        "avg TotalLatency > 10000" \
        2 "Front Door total latency exceeds 10 seconds"

    create_alert "alert-fd-5xx" "$RG_INFRA" "$FD_ID" \
        "avg Percentage5XX > 5" \
        1 "Front Door 5xx error rate exceeds 5%"
    echo ""
else
    warn "Front Door resource not found in $RG_INFRA"
fi

# ─── Storage Alerts ─────────────────────────────────────────────────────────
if [[ -n "$STORAGE_ID" ]]; then
    log "--- Storage alerts ---"

    create_alert "alert-storage-availability" "$RG_INFRA" "$STORAGE_ID" \
        "avg Availability < 99.9" \
        2 "Storage account availability below 99.9%"

    create_alert "alert-storage-latency" "$RG_INFRA" "$STORAGE_ID" \
        "avg SuccessE2ELatency > 5000" \
        3 "Storage end-to-end latency exceeds 5 seconds"
    echo ""
else
    warn "Storage resource not found: $STORAGE_NAME in $RG_INFRA"
fi

# ─── VM Alerts ───────────────────────────────────────────────────────────────
if [[ -n "$VM_ID" ]]; then
    log "--- VM alerts ---"

    create_alert "alert-vm-cpu" "$RG_INFRA" "$VM_ID" \
        "avg Percentage CPU > 90" \
        2 "VM CPU exceeds 90% for 10 minutes" "PT10M" "PT5M"

    create_alert "alert-vm-memory" "$RG_INFRA" "$VM_ID" \
        "avg Available Memory Bytes < 209715200" \
        2 "VM available memory below 200MB"
    echo ""
else
    warn "VM resource not found: $VM_NAME in $RG_INFRA"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
log "============================================"
log "  Setup Complete"
log "============================================"
echo ""
echo "  Created:  $CREATED"
echo "  Skipped:  $SKIPPED (already exist)"
echo "  Failed:   $FAILED"
echo ""

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo "  Warnings:"
    for w in "${WARNINGS[@]}"; do
        echo "    - $w"
    done
    echo ""
fi

if [[ -n "$APPINSIGHTS_CONN_STR" ]]; then
    echo "  Application Insights connection string:"
    echo "  $APPINSIGHTS_CONN_STR"
    echo ""
    echo "  Next steps:"
    echo "  1. Add this to /etc/buildatlas/.env on the VM:"
    echo "     APPLICATIONINSIGHTS_CONNECTION_STRING=$APPINSIGHTS_CONN_STR"
    echo "  2. Deploy the API with the updated code"
    echo "  3. Check Azure Portal → Application Insights → '$APPINSIGHTS_NAME'"
elif $DRY_RUN; then
    echo "  [DRY RUN] App Insights connection string will be printed after actual run."
fi

echo ""
echo "  Verify alerts: az monitor metrics alert list -g $RG_INFRA -o table"
echo "  Verify alerts: az monitor metrics alert list -g $RG_DB -o table"
echo "  Verify alerts: az monitor metrics alert list -g $RG_WEB -o table"
echo ""
