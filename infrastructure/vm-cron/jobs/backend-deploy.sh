#!/bin/bash
# backend-deploy.sh — Build API Docker image and deploy to AKS.
#
# Called by deploy.sh when apps/api/** changes, or manually via:
#   runner.sh backend-deploy 15 /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/backend-deploy.sh
#
# Uses `az acr build` (remote build on ACR — no local Docker needed).
# Requires: Azure CLI (logged in), kubectl (AKS credentials)
# Env vars sourced from /etc/buildatlas/.env by runner.sh
set -euo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
ACR_NAME="aistartuptr"
AKS_CLUSTER_NAME="aks-aistartuptr"
AKS_RESOURCE_GROUP="aistartuptr"
IMAGE_NAME="startup-investments-api"
API_URL="${API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}"

COMMIT_SHA=$(git -C "$REPO_DIR" rev-parse --short HEAD)
FULL_IMAGE="$ACR_NAME.azurecr.io/$IMAGE_NAME"
PREVIOUS_IMAGE=""

echo "=== Backend Deploy ==="
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Commit: $COMMIT_SHA"
echo ""

# Azure CLI login (managed identity)
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

# --- Step 1: Validate required env vars ---
echo "[1/6] Validating environment..."
for KEY in DATABASE_URL API_KEY ADMIN_KEY FRONT_DOOR_ID; do
    if [ -z "${!KEY:-}" ]; then
        echo "ERROR: Missing required env var: $KEY"
        exit 1
    fi
done
echo "  All required vars present."

# --- Step 2: Build and push image via ACR ---
echo ""
echo "[2/6] Building Docker image on ACR..."
az acr build \
    --registry "$ACR_NAME" \
    --image "$IMAGE_NAME:$COMMIT_SHA" \
    --image "$IMAGE_NAME:latest" \
    "$REPO_DIR/apps/api"

echo "  Pushed: $FULL_IMAGE:$COMMIT_SHA"
echo "  Pushed: $FULL_IMAGE:latest"

# --- Step 3: Ensure AKS is running ---
echo ""
echo "[3/6] Checking AKS state..."
AKS_STATE=$(az aks show -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME" \
    --query "powerState.code" -o tsv 2>/dev/null || echo "UNKNOWN")
echo "  AKS power state: $AKS_STATE"

if [ "$AKS_STATE" = "Stopped" ]; then
    echo "  Starting AKS..."
    az aks start -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME"
fi

# Wait for Running state
for i in $(seq 1 60); do
    AKS_STATE=$(az aks show -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME" \
        --query "powerState.code" -o tsv 2>/dev/null || echo "UNKNOWN")
    if [ "$AKS_STATE" = "Running" ]; then
        echo "  AKS is Running."
        break
    fi
    echo "  Waiting for AKS (attempt $i, state=$AKS_STATE)..."
    sleep 10
done

if [ "$AKS_STATE" != "Running" ]; then
    echo "ERROR: AKS did not reach Running state (state=$AKS_STATE)"
    exit 1
fi

# Refresh kubectl credentials
az aks get-credentials -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME" --overwrite-existing

# --- Step 4: Update K8s secret ---
echo ""
echo "[4/6] Updating Kubernetes secret..."
kubectl create secret generic startup-investments-secrets \
    --from-literal=database-url="$DATABASE_URL" \
    --from-literal=api-key="$API_KEY" \
    --from-literal=admin-key="$ADMIN_KEY" \
    --from-literal=front-door-id="$FRONT_DOOR_ID" \
    --from-literal=redis-url="${REDIS_URL:-}" \
    --dry-run=client -o yaml | kubectl apply -f -

# --- Step 5: Deploy to AKS ---
echo ""
echo "[5/6] Deploying to AKS..."
# Save previous image for rollback
PREVIOUS_IMAGE=$(kubectl get deployment startup-investments-api -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo "")
if [ -n "$PREVIOUS_IMAGE" ]; then
    echo "  Previous image: $PREVIOUS_IMAGE"
fi
kubectl apply -f "$REPO_DIR/infrastructure/kubernetes/api-deployment.yaml"
kubectl rollout status deployment/startup-investments-api --timeout=300s

# --- Step 6: Health check ---
echo ""
echo "[6/6] Waiting for API health..."
for i in $(seq 1 20); do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ]; then
        echo "  API is healthy!"
        break
    fi
    echo "  Attempt $i: status=$STATUS, waiting..."
    sleep 5
done

if [ "$STATUS" != "200" ]; then
    echo "WARNING: API health check did not return 200 (last status: $STATUS)"
    if [ -n "$PREVIOUS_IMAGE" ]; then
        echo "  Attempting rollback to: $PREVIOUS_IMAGE"
        kubectl set image deployment/startup-investments-api api="$PREVIOUS_IMAGE"
        kubectl rollout status deployment/startup-investments-api --timeout=120s || true
        echo "  Rollback initiated. Check health manually."
    fi
fi

echo ""
echo "=== Backend deploy complete ==="
echo "  Image: $FULL_IMAGE:$COMMIT_SHA"
echo "  API: $API_URL"
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
