#!/bin/bash
# keep-alive.sh — Consolidated infrastructure keep-alive.
# Merges keep-aks-alive.yml + keep-aks-running.yml into one job.
# Checks: PostgreSQL → AKS → API health → Frontend
set -uo pipefail

echo "=== Infrastructure Keep-Alive ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Azure CLI login with managed identity (silent refresh)
az login --identity --output none 2>/dev/null || true

# --- Step 1: Check PostgreSQL ---
echo ""
echo "[1/4] Checking PostgreSQL..."
PG_STATE=$(az postgres flexible-server show \
    --resource-group "${POSTGRES_RESOURCE_GROUP}" \
    --name "${POSTGRES_SERVER_NAME}" \
    --query "state" -o tsv 2>/dev/null || echo "UNKNOWN")

echo "  PostgreSQL state: $PG_STATE"

if [ "$PG_STATE" = "Stopped" ]; then
    echo "  WARNING: PostgreSQL is stopped. Starting..."
    az postgres flexible-server start \
        --resource-group "${POSTGRES_RESOURCE_GROUP}" \
        --name "${POSTGRES_SERVER_NAME}"
    echo "  Start command issued. Waiting 30s for readiness..."
    sleep 30
elif [ "$PG_STATE" = "UNKNOWN" ]; then
    echo "  WARNING: PostgreSQL state unknown (transient issue). Continuing."
fi

# --- Step 2: Check AKS ---
echo ""
echo "[2/4] Checking AKS..."
POWER_STATE=$(az aks show \
    --resource-group "${AKS_RESOURCE_GROUP}" \
    --name "${AKS_CLUSTER_NAME}" \
    --query "powerState.code" -o tsv 2>/dev/null || echo "UNKNOWN")

echo "  AKS power state: $POWER_STATE"

if [ "$POWER_STATE" = "Stopped" ]; then
    echo "  WARNING: AKS is stopped. Starting..."
    az aks start \
        --resource-group "${AKS_RESOURCE_GROUP}" \
        --name "${AKS_CLUSTER_NAME}"
    echo "  Waiting for Running state..."
    for i in $(seq 1 30); do
        STATE=$(az aks show \
            --resource-group "${AKS_RESOURCE_GROUP}" \
            --name "${AKS_CLUSTER_NAME}" \
            --query "powerState.code" -o tsv 2>/dev/null || echo "UNKNOWN")
        if [ "$STATE" = "Running" ]; then
            echo "  AKS is now Running"
            break
        fi
        echo "  Attempt $i/30: state=$STATE, waiting 20s..."
        sleep 20
    done
elif [ "$POWER_STATE" = "UNKNOWN" ]; then
    echo "  WARNING: AKS state unknown. Attempting start..."
    az aks start \
        --resource-group "${AKS_RESOURCE_GROUP}" \
        --name "${AKS_CLUSTER_NAME}" 2>/dev/null || echo "  Start failed (may already be running)"
fi

# --- Step 3: API Health Check ---
echo ""
echo "[3/4] Checking API health..."
API_HEALTHY=false
for i in $(seq 1 30); do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${API_URL}/health" 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ]; then
        echo "  API is healthy (HTTP 200)"
        curl -s "${API_URL}/health" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(f"  Status: {d.get(\"status\")}")
    print(f"  Database: {d.get(\"database\")}")
    cache = d.get("cache", {})
    print(f"  Redis: connected={cache.get(\"connected\")}")
except Exception:
    pass
' 2>/dev/null || true
        API_HEALTHY=true
        break
    fi
    echo "  Attempt $i/30: HTTP $STATUS, retrying in 10s..."
    sleep 10
done

if [ "$API_HEALTHY" = "false" ]; then
    echo "  ERROR: API health check failed after 5 minutes"
    exit 1
fi

# --- Step 4: Frontend Health Check (non-fatal) ---
echo ""
echo "[4/4] Checking frontend..."
FE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://buildatlas.net" 2>/dev/null || echo "000")
echo "  Frontend: HTTP $FE_STATUS"
if [ "$FE_STATUS" != "200" ]; then
    echo "  WARNING: Frontend returned HTTP $FE_STATUS"
fi

echo ""
echo "=== Keep-alive complete ==="
