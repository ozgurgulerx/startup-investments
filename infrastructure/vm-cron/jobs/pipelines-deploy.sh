#!/bin/bash
# pipelines-deploy.sh — Build pipelines Docker image and deploy AKS CronJobs.
#
# Called by deploy.sh when pipeline-related code changes, or manually via:
#   runner.sh pipelines-deploy 30 /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/pipelines-deploy.sh
#
# Uses `az acr build` (remote build on ACR — no local Docker needed).
# Requires: Azure CLI (logged in), kubectl (AKS credentials)
# Env vars sourced from /etc/buildatlas/.env by runner.sh
set -euo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
ACR_NAME="aistartuptr"
AKS_CLUSTER_NAME="aks-aistartuptr"
AKS_RESOURCE_GROUP="aistartuptr"
IMAGE_NAME="buildatlas-pipelines"

COMMIT_SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
FULL_IMAGE="$ACR_NAME.azurecr.io/$IMAGE_NAME"
DEPLOY_IMAGE="$FULL_IMAGE:$COMMIT_SHA"

TEMP_DIR="$(mktemp -d /tmp/buildatlas-pipelines-deploy.XXXXXX)"
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# Avoid clobbering shared kubeconfig state (deploy.sh can run deploys in parallel).
export KUBECONFIG="$TEMP_DIR/kubeconfig"

echo "=== Pipelines Deploy ==="
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Commit: $COMMIT_SHA"
echo "  Image: $DEPLOY_IMAGE"
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
echo "[1/5] Validating environment..."
for KEY in DATABASE_URL; do
    if [ -z "${!KEY:-}" ]; then
        echo "ERROR: Missing required env var: $KEY"
        exit 1
    fi
done
if [ -z "${SLACK_WEBHOOK_URL:-}" ] && [ -z "${SLACK_WEBHOOK:-}" ]; then
    echo "  WARNING: SLACK_WEBHOOK_URL/SLACK_WEBHOOK not set; pipeline jobs can run but Slack notifications will be disabled."
fi
echo "  OK"

# --- Step 2: Build and push image via ACR ---
echo ""
echo "[2/5] Building pipelines Docker image on ACR..."
az acr build \
    --registry "$ACR_NAME" \
    --image "$IMAGE_NAME:$COMMIT_SHA" \
    --image "$IMAGE_NAME:latest" \
    --file infrastructure/pipelines/Dockerfile \
    "$REPO_DIR"

echo "  Pushed: $FULL_IMAGE:$COMMIT_SHA"
echo "  Pushed: $FULL_IMAGE:latest"

# --- Step 3: Ensure AKS is running ---
echo ""
echo "[3/5] Checking AKS state..."
AKS_STATE="$(az aks show -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME" --query \"powerState.code\" -o tsv 2>/dev/null || echo \"UNKNOWN\")"
echo "  AKS power state: $AKS_STATE"

if [ "$AKS_STATE" = "Stopped" ]; then
    echo "  Starting AKS..."
    az aks start -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME"
fi

for i in $(seq 1 60); do
    AKS_STATE="$(az aks show -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME" --query \"powerState.code\" -o tsv 2>/dev/null || echo \"UNKNOWN\")"
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

az aks get-credentials -g "$AKS_RESOURCE_GROUP" -n "$AKS_CLUSTER_NAME" --file "$KUBECONFIG" --overwrite-existing

# --- Step 4: Apply config + CronJobs (pinned tag) ---
echo ""
echo "[4/5] Applying pipelines config + CronJobs..."

if ! kubectl get secret buildatlas-pipelines-secrets >/dev/null 2>&1; then
    echo "ERROR: Missing Kubernetes secret: buildatlas-pipelines-secrets"
    echo "  Create it first (do not include shell quotes in values). See docs/OPERATING_MODEL.md."
    exit 1
fi

kubectl apply -f "$REPO_DIR/infrastructure/kubernetes/pipelines-configmap.yaml"

RENDERED_CRONJOBS="$TEMP_DIR/pipelines-cronjobs.rendered.yaml"
sed "s/__IMAGE_TAG__/${COMMIT_SHA}/g" \
    "$REPO_DIR/infrastructure/kubernetes/pipelines-cronjobs.yaml" > "$RENDERED_CRONJOBS"

kubectl apply -f "$RENDERED_CRONJOBS"

# --- Step 5: Quick sanity checks ---
echo ""
echo "[5/5] Verifying CronJobs reference pinned image..."
kubectl get cronjobs -l app=buildatlas-pipelines -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.jobTemplate.spec.template.spec.containers[0].image}{"\n"}{end}' \
  | grep -F "$DEPLOY_IMAGE" >/dev/null \
  || echo "WARNING: some CronJobs may still reference a different image tag (check output manually)."

echo ""
echo "Pipelines deploy complete at $(date -u '+%Y-%m-%d %H:%M UTC')"
