#!/bin/bash
# deploy-frontend.sh — Build and deploy frontend from local machine (no SSH needed).
#
# Usage:
#   ./scripts/deploy-frontend.sh              # Build + deploy + smoke check (~7 min)
#   ./scripts/deploy-frontend.sh --no-smoke   # Skip smoke check
#   ./scripts/deploy-frontend.sh --restart    # Just restart App Service (no build)
#   ./scripts/deploy-frontend.sh --via-vm     # Trigger deploy on VM via az run-command
#
# Prerequisites: `az login` (interactive or service principal — NOT managed identity)
set -euo pipefail

# --- Constants (must match infrastructure/vm-cron/jobs/frontend-deploy.sh) ---
WEBAPP_NAME="buildatlas-web"
RESOURCE_GROUP="rg-startup-analysis"
ACR_NAME="aistartuptr"
IMAGE_NAME="buildatlas-web"
FULL_IMAGE="$ACR_NAME.azurecr.io/$IMAGE_NAME"
API_URL="https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net"
BASE_URL="https://buildatlas.net"
VM_NAME="vm-buildatlas-cron"
VM_RG="aistartuptr"

# --- Parse flags ---
NO_SMOKE=0
RESTART_ONLY=0
VIA_VM=0
for arg in "$@"; do
    case "$arg" in
        --no-smoke)   NO_SMOKE=1 ;;
        --restart)    RESTART_ONLY=1 ;;
        --via-vm)     VIA_VM=1 ;;
        -h|--help)
            echo "Usage: $0 [--no-smoke] [--restart] [--via-vm]"
            echo ""
            echo "  (default)    Build on ACR + deploy + smoke check (~7 min)"
            echo "  --no-smoke   Skip the smoke check after deploy"
            echo "  --restart    Just restart App Service (no build)"
            echo "  --via-vm     Trigger deploy on VM via az run-command (no SSH)"
            exit 0
            ;;
        *) echo "Unknown flag: $arg"; exit 1 ;;
    esac
done

# --- Pre-flight checks ---
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")"

echo "=== Frontend Deploy (local) ==="
echo "  Time:   $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Commit: $COMMIT_SHA"
echo "  Mode:   $([ "$RESTART_ONLY" -eq 1 ] && echo "restart" || ([ "$VIA_VM" -eq 1 ] && echo "via-vm" || echo "build+deploy"))"
echo ""

# Check az login
if ! az account show --output none 2>/dev/null; then
    echo "ERROR: Not logged in to Azure. Run 'az login' first."
    exit 1
fi

# Warn on dirty tree (non-blocking)
if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]; then
    echo "  WARN: Working tree has uncommitted changes — deploy will use committed code only."
    echo ""
fi

# --- Mode: --restart ---
if [ "$RESTART_ONLY" -eq 1 ]; then
    echo "[1/1] Restarting App Service..."
    az webapp restart \
        --resource-group "$RESOURCE_GROUP" \
        --name "$WEBAPP_NAME" \
        --output none
    echo "  Done. App Service is restarting."
    echo "  Check: $BASE_URL"
    exit 0
fi

# --- Mode: --via-vm ---
if [ "$VIA_VM" -eq 1 ]; then
    echo "[1/1] Triggering frontend deploy on VM via az run-command..."
    echo "  (This takes ~30s overhead + build time. Output is truncated to 4KB.)"
    echo ""
    az vm run-command invoke \
        --resource-group "$VM_RG" \
        --name "$VM_NAME" \
        --command-id RunShellScript \
        --scripts "su - buildatlas -c 'cd /opt/buildatlas/startup-analysis && git pull --ff-only origin main && /opt/buildatlas/startup-analysis/infrastructure/vm-cron/lib/runner.sh frontend-deploy 20 /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/frontend-deploy.sh'" \
        --output json
    echo ""
    echo "  Done. Check VM logs or $BASE_URL for result."
    exit 0
fi

# --- Mode: Build + Deploy ---

# Step 1: ACR build
echo "[1/3] Building Docker image on ACR (remote build)..."
echo "  Image: $FULL_IMAGE:$COMMIT_SHA"
echo ""

cd "$REPO_ROOT"
az acr build \
    --registry "$ACR_NAME" \
    --image "$IMAGE_NAME:$COMMIT_SHA" \
    --image "$IMAGE_NAME:latest" \
    --file apps/web/Dockerfile \
    --build-arg "NEXT_PUBLIC_BUILD_SHA=$COMMIT_SHA" \
    --build-arg "NEXT_PUBLIC_API_URL=$API_URL" \
    --build-arg "NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com" \
    --build-arg "NEXT_PUBLIC_POSTHOG_KEY=${POSTHOG_PROJECT_API_KEY:-${POSTHOG_KEY:-}}" \
    --build-arg "NEXT_PUBLIC_POSTHOG_AUTOCAPTURE=${POSTHOG_AUTOCAPTURE:-false}" \
    --build-arg "NEXT_PUBLIC_POSTHOG_CAPTURE_PAGELEAVE=${POSTHOG_CAPTURE_PAGELEAVE:-false}" \
    --build-arg "NEXT_PUBLIC_POSTHOG_CAPTURE_DEAD_CLICKS=${POSTHOG_CAPTURE_DEAD_CLICKS:-false}" \
    --build-arg "NEXT_PUBLIC_POSTHOG_CAPTURE_EXCEPTIONS=${POSTHOG_CAPTURE_EXCEPTIONS:-true}" \
    --build-arg "NEXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE=${POSTHOG_REPLAY_SAMPLE_RATE:-0.03}" \
    --build-arg "NEXT_PUBLIC_CLARITY_PROJECT_ID=${CLARITY_PROJECT_ID:-}" \
    .

echo ""
echo "  Pushed: $FULL_IMAGE:$COMMIT_SHA"
echo "  Pushed: $FULL_IMAGE:latest"

# Step 2: Update App Service container config
echo ""
echo "[2/3] Updating App Service container configuration..."

ACR_USER=$(az acr credential show --name "$ACR_NAME" --query "username" -o tsv)
ACR_PASS=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

az webapp config container set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$WEBAPP_NAME" \
    --container-image-name "$FULL_IMAGE:$COMMIT_SHA" \
    --container-registry-url "https://$ACR_NAME.azurecr.io" \
    --container-registry-user "$ACR_USER" \
    --container-registry-password "$ACR_PASS" \
    --output none

# Oryx startup override
az webapp config set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$WEBAPP_NAME" \
    --startup-file "node apps/web/server.js" \
    --output none

# Ensure storage mount is disabled
az webapp config appsettings set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$WEBAPP_NAME" \
    --settings "WEBSITES_ENABLE_APP_SERVICE_STORAGE=false" "NEXT_PUBLIC_BUILD_SHA=$COMMIT_SHA" \
    --output none

echo "  Container config updated."

# Step 3: Smoke check
if [ "$NO_SMOKE" -eq 1 ]; then
    echo ""
    echo "[3/3] Smoke check skipped (--no-smoke)."
else
    echo ""
    echo "[3/3] Smoke check — waiting for build $COMMIT_SHA to go live..."

    if [ "$COMMIT_SHA" = "unknown" ]; then
        echo "  WARN: No commit SHA; skipping smoke check."
    else
        OK=0
        for i in $(seq 1 20); do
            HTML="$(curl -fsS --max-time 10 -H 'Cache-Control: no-cache' "${BASE_URL}/?v=${COMMIT_SHA}" 2>/dev/null || true)"
            if echo "$HTML" | grep -q "ba-build-sha\" content=\"${COMMIT_SHA}\""; then
                OK=1
                echo "  OK: ba-build-sha=$COMMIT_SHA is live"
                break
            fi
            echo "  Waiting... (attempt $i/20)"
            sleep 3
        done

        if [ "$OK" -ne 1 ]; then
            echo "  WARN: Not visible after 60s — restarting App Service..."
            az webapp restart --resource-group "$RESOURCE_GROUP" --name "$WEBAPP_NAME" --output none 2>/dev/null || true
            sleep 10
            for i in $(seq 1 8); do
                HTML="$(curl -fsS --max-time 10 -H 'Cache-Control: no-cache' "${BASE_URL}/?v=${COMMIT_SHA}-r" 2>/dev/null || true)"
                if echo "$HTML" | grep -q "ba-build-sha\" content=\"${COMMIT_SHA}\""; then
                    OK=1
                    echo "  OK: ba-build-sha=$COMMIT_SHA is live (after restart)"
                    break
                fi
                echo "  Post-restart check... (attempt $i/8)"
                sleep 3
            done
        fi

        if [ "$OK" -ne 1 ]; then
            echo "ERROR: Build deployed but ba-build-sha=$COMMIT_SHA not visible on $BASE_URL."
            exit 1
        fi
    fi
fi

echo ""
echo "=== Frontend deploy complete ==="
echo "  Image: $FULL_IMAGE:$COMMIT_SHA"
echo "  App:   $BASE_URL"
echo "  Time:  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
