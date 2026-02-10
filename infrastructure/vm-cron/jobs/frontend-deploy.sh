#!/bin/bash
# frontend-deploy.sh — Build Next.js Docker image on ACR and deploy to App Service.
#
# Called by sync-data.sh after a successful push, or by deploy.sh when apps/web/** changes.
# Manual:
#   runner.sh frontend-deploy 15 /opt/buildatlas/infrastructure/vm-cron/jobs/frontend-deploy.sh
#
# Env vars sourced from /etc/buildatlas/.env by runner.sh.
# Optional: SKIP_PULL=1 (skip git pull), CLEAN_BUILD=1 (unused, kept for compat)
set -euo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
WEBAPP_NAME="buildatlas-web"
RESOURCE_GROUP="rg-startup-analysis"
ACR_NAME="aistartuptr"
IMAGE_NAME="buildatlas-web"

echo "=== Frontend Deploy (Docker) ==="
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Commit SHA for build marker + smoke checks
COMMIT_SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
FULL_IMAGE="$ACR_NAME.azurecr.io/$IMAGE_NAME"

echo "  Commit: $COMMIT_SHA"
echo ""

# --- Azure CLI login (managed identity) ---
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

if [ -n "${AZURE_SUBSCRIPTION_ID:-}" ]; then
    az account set --subscription "${AZURE_SUBSCRIPTION_ID}" --output none || true
fi

# Source optional local overrides
if [ -f "$REPO_DIR/apps/web/.env.local" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$REPO_DIR/apps/web/.env.local"
    set +a
fi

# --- Step 1: Pull latest code ---
if [ "${SKIP_PULL:-}" != "1" ]; then
    echo "[1/5] Pulling latest code..."
    cd "$REPO_DIR"
    git pull --ff-only origin main
else
    echo "[1/5] Skipping pull (already done by caller)"
fi

# --- Step 2: Build Docker image on ACR (remote build) ---
echo ""
echo "[2/5] Building Docker image on ACR..."
cd "$REPO_DIR"

az acr build \
    --registry "$ACR_NAME" \
    --image "$IMAGE_NAME:$COMMIT_SHA" \
    --image "$IMAGE_NAME:latest" \
    --file apps/web/Dockerfile \
    --build-arg "NEXT_PUBLIC_BUILD_SHA=$COMMIT_SHA" \
    --build-arg "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}" \
    --build-arg "NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com" \
    --build-arg "NEXT_PUBLIC_POSTHOG_KEY=${POSTHOG_KEY:-}" \
    .

echo "  Pushed: $FULL_IMAGE:$COMMIT_SHA"
echo "  Pushed: $FULL_IMAGE:latest"

# --- Step 3: Point App Service at new container image ---
echo ""
echo "[3/5] Updating App Service container configuration..."

# Get ACR admin credentials for App Service image pulls
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

# --- Step 4: Configure App Service settings ---
echo ""
echo "[4/5] Configuring App Service settings..."

# Resolve API_KEY: try env, then fall back to existing App Service setting
SKIP_API_KEY_UPDATE=0
if [ -z "${API_KEY:-}" ]; then
    EXISTING_API_KEY="$(az webapp config appsettings list \
        --resource-group "$RESOURCE_GROUP" \
        --name "$WEBAPP_NAME" \
        --query "[?name=='API_KEY'].value | [0]" \
        -o tsv 2>/dev/null || true)"
    if [ -n "${EXISTING_API_KEY:-}" ] && [ "${EXISTING_API_KEY:-}" != "null" ]; then
        export API_KEY="$EXISTING_API_KEY"
        echo "  Loaded API_KEY from existing App Service settings."
    else
        echo "  WARNING: API_KEY not available. Preserving existing setting."
        SKIP_API_KEY_UPDATE=1
    fi
fi

SETTINGS=(
    "NODE_ENV=production"
    "WEBSITES_PORT=8080"
    "NEXTAUTH_URL=${NEXTAUTH_URL:-https://buildatlas.net}"
    "PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-https://buildatlas.net}"
    "NEXT_PUBLIC_BUILD_SHA=$COMMIT_SHA"
)

# Only set secrets when provided, to avoid wiping existing App Service settings
if [ -n "${DATABASE_URL:-}" ]; then SETTINGS+=("DATABASE_URL=${DATABASE_URL}"); fi
if [ -n "${NEXTAUTH_SECRET:-}" ]; then
    SETTINGS+=("AUTH_SECRET=${NEXTAUTH_SECRET}" "NEXTAUTH_SECRET=${NEXTAUTH_SECRET}")
fi
if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then SETTINGS+=("GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"); fi
if [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then SETTINGS+=("GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}"); fi
if [ -n "${RESEND_API_KEY:-}" ]; then SETTINGS+=("RESEND_API_KEY=${RESEND_API_KEY}"); fi
if [ -n "${NEWS_DIGEST_FROM_EMAIL:-}" ]; then SETTINGS+=("NEWS_DIGEST_FROM_EMAIL=${NEWS_DIGEST_FROM_EMAIL}"); fi
if [ -n "${NEWS_DIGEST_REPLY_TO:-}" ]; then SETTINGS+=("NEWS_DIGEST_REPLY_TO=${NEWS_DIGEST_REPLY_TO}"); fi
if [ -n "${POSTHOG_KEY:-}" ]; then SETTINGS+=("NEXT_PUBLIC_POSTHOG_KEY=${POSTHOG_KEY}"); fi
if [ "$SKIP_API_KEY_UPDATE" -eq 0 ] && [ -n "${API_KEY:-}" ]; then SETTINGS+=("API_KEY=${API_KEY}"); fi

az webapp config appsettings set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$WEBAPP_NAME" \
    --settings "${SETTINGS[@]}" \
    --output none

# Remove legacy zip-deploy settings (idempotent, no-op if already gone)
az webapp config appsettings delete \
    --resource-group "$RESOURCE_GROUP" \
    --name "$WEBAPP_NAME" \
    --setting-names WEBSITE_RUN_FROM_PACKAGE SCM_DO_BUILD_DURING_DEPLOYMENT \
    --output none 2>/dev/null || true

# --- Step 5: Smoke check ---
echo ""
echo "[5/5] Smoke check (verify build is live)..."
BASE_URL="${PUBLIC_BASE_URL:-https://buildatlas.net}"

if [ -z "${COMMIT_SHA:-}" ] || [ "$COMMIT_SHA" = "unknown" ]; then
    echo "  WARN: Missing COMMIT_SHA; skipping smoke check."
else
    OK=0
    for i in $(seq 1 20); do
        HTML="$(curl -fsS --max-time 10 -H 'Cache-Control: no-cache' "${BASE_URL}/?v=${COMMIT_SHA}" 2>/dev/null || true)"
        if echo "$HTML" | grep -q "ba-build-sha\" content=\"${COMMIT_SHA}\""; then
            OK=1
            echo "  OK: build marker ba-build-sha=${COMMIT_SHA}"
            break
        fi
        echo "  Waiting for new build to become visible... (attempt $i/20)"
        sleep 3
    done

    if [ "$OK" -ne 1 ]; then
        echo "  WARN: Build not visible after 60s — restarting App Service..."
        az webapp restart --resource-group "$RESOURCE_GROUP" --name "$WEBAPP_NAME" --output none 2>/dev/null || true
        sleep 10
        for i in $(seq 1 8); do
            HTML="$(curl -fsS --max-time 10 -H 'Cache-Control: no-cache' "${BASE_URL}/?v=${COMMIT_SHA}-r" 2>/dev/null || true)"
            if echo "$HTML" | grep -q "ba-build-sha\" content=\"${COMMIT_SHA}\""; then
                OK=1
                echo "  OK: build marker ba-build-sha=${COMMIT_SHA} (after restart)"
                break
            fi
            echo "  Post-restart check... (attempt $i/8)"
            sleep 3
        done
    fi

    if [ "$OK" -ne 1 ]; then
        echo "ERROR: Deployed, but new build marker was not observed on ${BASE_URL} after restart+retry."
        exit 1
    fi
fi

echo ""
echo "=== Frontend deploy complete ==="
echo "  Image: $FULL_IMAGE:$COMMIT_SHA"
echo "  App: https://buildatlas.net"
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
