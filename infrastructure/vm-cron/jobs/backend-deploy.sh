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
DEPLOY_IMAGE="$FULL_IMAGE:$COMMIT_SHA"

TEMP_DIR="$(mktemp -d /tmp/buildatlas-backend-deploy.XXXXXX)"
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# Avoid clobbering shared kubeconfig state (deploy.sh can run deploys in parallel).
export KUBECONFIG="$TEMP_DIR/kubeconfig"

sha_matches() {
    local expected="${1:-}"
    local live="${2:-}"
    expected="$(echo "$expected" | tr '[:upper:]' '[:lower:]')"
    live="$(echo "$live" | tr '[:upper:]' '[:lower:]')"
    if [ -z "$expected" ] || [ -z "$live" ]; then
        return 1
    fi
    if [ "$expected" = "$live" ]; then
        return 0
    fi
    case "$expected" in
        "$live"*) return 0 ;;
    esac
    case "$live" in
        "$expected"*) return 0 ;;
    esac
    return 1
}

extract_build_sha() {
    local json_payload="$1"
    PAYLOAD="$json_payload" python3 - <<'PY'
import json
import os

raw = os.environ.get("PAYLOAD", "")
try:
    data = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)

sha = data.get("build_sha") or data.get("sha") or ""
print(str(sha).strip())
PY
}

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

# Guard: root package.json must not have runtime dependencies (they cause lockfile mismatches)
if grep -qE '"dependencies"\s*:' "$REPO_DIR/package.json"; then
    echo "ERROR: Root package.json has 'dependencies' — move them to the appropriate workspace package."
    echo "  Root deps cause pnpm lockfile mismatches in Docker builds."
    exit 1
fi

az acr build \
    --registry "$ACR_NAME" \
    --image "$IMAGE_NAME:$COMMIT_SHA" \
    --image "$IMAGE_NAME:latest" \
    --file apps/api/Dockerfile \
    --build-arg "API_BUILD_SHA=$COMMIT_SHA" \
    "$REPO_DIR"

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

# Refresh kubectl credentials (avoid mutating the default kubeconfig).
az aks get-credentials -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME" --file "$KUBECONFIG" --overwrite-existing

# Preserve REDIS_URL from existing K8s secret if not in env (now that AKS is running)
if [ -z "${REDIS_URL:-}" ]; then
    EXISTING_REDIS_URL_B64="$(kubectl get secret startup-investments-secrets -o jsonpath='{.data.redis-url}' 2>/dev/null || true)"
    if [ -n "${EXISTING_REDIS_URL_B64:-}" ]; then
        EXISTING_REDIS_URL="$(echo "$EXISTING_REDIS_URL_B64" | base64 --decode 2>/dev/null || true)"
        if [ -n "${EXISTING_REDIS_URL:-}" ]; then
            export REDIS_URL="$EXISTING_REDIS_URL"
            echo "  Loaded REDIS_URL from existing Kubernetes secret."
        fi
    fi
fi

if [ -z "${REDIS_URL:-}" ]; then
    echo "  WARNING: REDIS_URL is not set; Redis caching will be disabled."
fi

# --- Step 4: Update K8s secret ---
echo ""
echo "[4/6] Updating Kubernetes secret..."
kubectl create secret generic startup-investments-secrets \
    --from-literal=database-url="$DATABASE_URL" \
    --from-literal=api-key="$API_KEY" \
    --from-literal=admin-key="$ADMIN_KEY" \
    --from-literal=front-door-id="$FRONT_DOOR_ID" \
    --from-literal=redis-url="${REDIS_URL:-}" \
    --from-literal=applicationinsights-connection-string="${APPLICATIONINSIGHTS_CONNECTION_STRING:-}" \
    --from-literal=azure-openai-endpoint="${AZURE_OPENAI_ENDPOINT:-}" \
    --from-literal=azure-openai-api-key="${AZURE_OPENAI_API_KEY:-}" \
    --from-literal=azure-openai-embedding-deployment="${AZURE_OPENAI_EMBEDDING_DEPLOYMENT:-text-embedding-3-small}" \
    --from-literal=openai-api-key="${OPENAI_API_KEY:-}" \
    --from-literal=azure-storage-connection-string="${AZURE_STORAGE_CONNECTION_STRING:-}" \
    --dry-run=client -o yaml | kubectl apply -f -

# --- Step 5: Deploy to AKS ---
echo ""
echo "[5/6] Deploying to AKS..."
# Save previous image for rollback
PREVIOUS_IMAGE=$(kubectl get deployment startup-investments-api -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo "")
if [ -n "$PREVIOUS_IMAGE" ]; then
    echo "  Previous image: $PREVIOUS_IMAGE"
fi

echo "  Target image: $DEPLOY_IMAGE"

# Render the manifest with a pinned image tag.
RENDERED_MANIFEST="$TEMP_DIR/api-deployment.rendered.yaml"
sed "s/__IMAGE_TAG__/${COMMIT_SHA}/g" "$REPO_DIR/infrastructure/kubernetes/api-deployment.yaml" > "$RENDERED_MANIFEST"

kubectl apply -f "$RENDERED_MANIFEST"

# If the image did not change, force a restart so pods can pick up rotated secrets.
if [ -n "$PREVIOUS_IMAGE" ] && [ "$PREVIOUS_IMAGE" = "$DEPLOY_IMAGE" ]; then
    echo "  Image unchanged; forcing rollout restart to pick up secrets/config..."
    kubectl rollout restart deployment/startup-investments-api
fi

if ! kubectl rollout status deployment/startup-investments-api --timeout=600s; then
    echo "ERROR: Rollout did not complete successfully."
    if [ -n "$PREVIOUS_IMAGE" ]; then
        echo "  Attempting rollback to: $PREVIOUS_IMAGE"
        kubectl set image deployment/startup-investments-api api="$PREVIOUS_IMAGE"
        kubectl rollout status deployment/startup-investments-api --timeout=300s || true
    fi
    exit 1
fi

# --- Step 6: Health check ---
echo ""
echo "[6/6] Waiting for API health..."
EXPECTED_SHA="$COMMIT_SHA"
LAST_BUILD_SHA=""
for i in $(seq 1 20); do
    RESP="$(curl -fsS --max-time 10 "$API_URL/health" 2>/dev/null || true)"
    STATUS="000"
    if [ -n "$RESP" ]; then
        STATUS="200"
        LAST_BUILD_SHA="$(extract_build_sha "$RESP")"
        if sha_matches "$EXPECTED_SHA" "$LAST_BUILD_SHA"; then
            echo "  API is healthy (build_sha=$LAST_BUILD_SHA)!"
            break
        fi
        echo "  Attempt $i: status=$STATUS but build_sha mismatch (got '${LAST_BUILD_SHA:-}', expected '$EXPECTED_SHA')"
    else
        STATUS="$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" 2>/dev/null || echo "000")"
        echo "  Attempt $i: status=$STATUS, waiting..."
    fi
    sleep 5
done

if [ "$STATUS" != "200" ] || ! sha_matches "$EXPECTED_SHA" "$LAST_BUILD_SHA"; then
    echo "ERROR: API health check did not converge to expected build (status=${STATUS}, build_sha='${LAST_BUILD_SHA:-}')"
    if [ -n "$PREVIOUS_IMAGE" ]; then
        echo "  Attempting rollback to: $PREVIOUS_IMAGE"
        kubectl set image deployment/startup-investments-api api="$PREVIOUS_IMAGE"
        if kubectl rollout status deployment/startup-investments-api --timeout=120s; then
            echo "  Rollback deployment succeeded. Verifying health..."
            ROLLBACK_OK=0
            for i in $(seq 1 12); do
                RRESP="$(curl -fsS --max-time 10 "$API_URL/health" 2>/dev/null || true)"
                RSTATUS="000"
                if [ -n "$RRESP" ]; then
                    RSTATUS="200"
                    RBUILD_SHA="$(extract_build_sha "$RRESP")"
                fi
                if [ "$RSTATUS" = "200" ]; then
                    ROLLBACK_OK=1
                    echo "  Rollback health check passed (build_sha=${RBUILD_SHA:-unknown})."
                    break
                fi
                echo "  Rollback health check attempt $i: status=$RSTATUS"
                sleep 5
            done
            if [ "$ROLLBACK_OK" -ne 1 ]; then
                echo "CRITICAL: Rollback deployed but health check failed (last status: $RSTATUS)"
                echo "  Manual intervention required!"
            fi
        else
            echo "CRITICAL: Rollback deployment failed!"
            echo "  Manual intervention required!"
        fi
    else
        echo "CRITICAL: No previous image available for rollback!"
        echo "  Manual intervention required!"
    fi
    exit 1
fi

echo ""
echo "=== Backend deploy complete ==="
echo "  Image: $FULL_IMAGE:$COMMIT_SHA"
echo "  API: $API_URL"
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
