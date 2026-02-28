#!/bin/bash
# onboarding-build-and-run.sh — Build the onboarding image on ACR and launch the K8s Job.
#
# Run from the VM:
#   cd /opt/buildatlas/startup-analysis && git pull
#   bash infrastructure/vm-cron/jobs/onboarding-build-and-run.sh 2026-02
#
# What it does:
#   1. Builds buildatlas-onboarding image on ACR (~15 min)
#   2. Gets AKS credentials
#   3. Deletes any existing job for this period (idempotent re-run)
#   4. Renders __IMAGE_TAG__ + __PERIOD__ and applies the Job manifest
#
set -euo pipefail

PERIOD="${1:?Usage: onboarding-build-and-run.sh <PERIOD> (e.g. 2026-02)}"
REPO_DIR="${REPO_DIR:-/opt/buildatlas/startup-analysis}"

ACR_NAME="aistartuptr"
AKS_NAME="aks-aistartuptr"
AKS_RG="aistartuptr"
IMAGE_NAME="buildatlas-onboarding"
JOB_NAME="global-onboarding-${PERIOD}"
JOB_YAML="$REPO_DIR/infrastructure/kubernetes/onboarding-job.yaml"

IMAGE_TAG="$(date -u '+%Y%m%d-%H%M%S')-$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo 'manual')"
FULL_IMAGE="${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}"

echo "=========================================="
echo "=== Onboarding Build & Run             ==="
echo "=========================================="
echo "Period:    $PERIOD"
echo "Image:     $FULL_IMAGE"
echo "Job:       $JOB_NAME"
echo "Manifest:  $JOB_YAML"
echo ""

# ─── Step 1: Build image on ACR ─────────────────────────────────────────────
echo ">>> Step 1: Building image on ACR (this takes ~15 min)..."
az acr build \
    --registry "$ACR_NAME" \
    --image "${IMAGE_NAME}:${IMAGE_TAG}" \
    --file infrastructure/onboarding/Dockerfile \
    "$REPO_DIR"

echo "Image built: $FULL_IMAGE"
echo ""

# ─── Step 2: Get AKS credentials ────────────────────────────────────────────
echo ">>> Step 2: Getting AKS credentials..."
az aks get-credentials \
    --resource-group "$AKS_RG" \
    --name "$AKS_NAME" \
    --overwrite-existing

echo ""

# ─── Step 3: Delete existing job (if any) ────────────────────────────────────
echo ">>> Step 3: Cleaning up previous job (if any)..."
kubectl delete job "$JOB_NAME" -n default 2>/dev/null \
    && echo "Deleted existing job: $JOB_NAME" \
    || echo "No existing job to delete"
echo ""

# ─── Step 4: Render and apply manifest ───────────────────────────────────────
echo ">>> Step 4: Applying Job manifest..."
sed \
    -e "s|__IMAGE_TAG__|${IMAGE_TAG}|g" \
    -e "s|__PERIOD__|${PERIOD}|g" \
    "$JOB_YAML" \
    | kubectl apply -f -

echo ""
echo "=========================================="
echo "=== Job launched: $JOB_NAME"
echo "=========================================="
echo ""
echo "Monitor with:"
echo "  kubectl logs -n default -f job/$JOB_NAME"
echo ""
echo "If it fails mid-run, recover with:"
echo "  kubectl delete job $JOB_NAME -n default"
echo "  bash infrastructure/vm-cron/jobs/onboarding-build-and-run.sh $PERIOD"
