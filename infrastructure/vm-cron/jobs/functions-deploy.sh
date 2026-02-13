#!/bin/bash
# functions-deploy.sh — Build/deploy Azure Functions package from the VM.
#
# Primary use: VM fallback for .github/workflows/functions-deploy.yml when
# GitHub Actions is unavailable.
#
# Manual:
#   runner.sh functions-deploy 30 /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/functions-deploy.sh
set -euo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
FUNCTIONAPP_NAME="${AZURE_FUNCTIONAPP_NAME:-buildatlas-functions}"
FUNCTIONS_RESOURCE_GROUP="${AZURE_FUNCTIONS_RESOURCE_GROUP:-aistartuptr}"
FUNCTIONS_PACKAGE_PATH="$REPO_DIR/infrastructure/azure-functions"
TEMP_DIR="$(mktemp -d /tmp/buildatlas-functions-deploy.XXXXXX)"
ZIP_PATH="$TEMP_DIR/functions-deploy.zip"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "=== Functions Deploy ==="
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Function app: $FUNCTIONAPP_NAME"

auth_az() {
  for i in 1 2 3; do
    if az login --identity --output none 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if ! auth_az; then
  echo "ERROR: Azure managed identity login failed"
  exit 1
fi

if [ -n "${AZURE_SUBSCRIPTION_ID:-}" ]; then
  az account set --subscription "$AZURE_SUBSCRIPTION_ID" --output none || true
fi

if [ "${SKIP_PULL:-}" != "1" ]; then
  echo "[1/6] Pulling latest code..."
  git -C "$REPO_DIR" pull --ff-only origin main
else
  echo "[1/6] Skipping pull (already done by caller)"
fi

echo "[2/6] Preparing deployment package..."
mkdir -p "$TEMP_DIR/package"
rsync -a "$FUNCTIONS_PACKAGE_PATH/" "$TEMP_DIR/package/"

# Keep parity with legacy GitHub workflow behavior.
mkdir -p "$TEMP_DIR/package/packages_analysis"
rsync -a "$REPO_DIR/packages/analysis/" "$TEMP_DIR/package/packages_analysis/"

echo "[3/6] Installing function dependencies into .python_packages..."
python3 -m pip install --disable-pip-version-check \
  -r "$TEMP_DIR/package/requirements.txt" \
  --target "$TEMP_DIR/package/.python_packages/lib/site-packages" \
  >/dev/null

# Reduce package size/noise.
find "$TEMP_DIR/package" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
find "$TEMP_DIR/package" -type f -name '*.pyc' -delete 2>/dev/null || true

echo "[4/6] Creating zip package..."
(
  cd "$TEMP_DIR/package"
  zip -qr "$ZIP_PATH" .
)

echo "[5/6] Deploying package to Azure Functions..."
az functionapp deployment source config-zip \
  --resource-group "$FUNCTIONS_RESOURCE_GROUP" \
  --name "$FUNCTIONAPP_NAME" \
  --src "$ZIP_PATH" \
  --output none

# Keep app settings in sync when values are present on VM.
SETTINGS=("FUNCTIONS_WORKER_RUNTIME=python")
if [ -n "${AZURE_STORAGE_CONNECTION_STRING:-}" ]; then
  SETTINGS+=("AzureWebJobsStorage=$AZURE_STORAGE_CONNECTION_STRING")
fi
if [ -n "${AZURE_OPENAI_API_KEY:-}" ]; then
  SETTINGS+=("AZURE_OPENAI_API_KEY=$AZURE_OPENAI_API_KEY")
fi
if [ -n "${AZURE_OPENAI_ENDPOINT:-}" ]; then
  SETTINGS+=("AZURE_OPENAI_ENDPOINT=$AZURE_OPENAI_ENDPOINT")
fi
if [ -n "${DATABASE_URL:-}" ]; then
  SETTINGS+=("DATABASE_URL=$DATABASE_URL")
fi
if [ -n "${BLOB_CONTAINER_NAME:-}" ]; then
  SETTINGS+=("BLOB_CONTAINER_NAME=$BLOB_CONTAINER_NAME")
fi

az functionapp config appsettings set \
  --resource-group "$FUNCTIONS_RESOURCE_GROUP" \
  --name "$FUNCTIONAPP_NAME" \
  --settings "${SETTINGS[@]}" \
  --output none

echo "[6/6] Health check..."
HEALTH_URL="https://${FUNCTIONAPP_NAME}.azurewebsites.net/api/health"
HEALTHY=0
for i in $(seq 1 30); do
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo '000')"
  if [ "$STATUS" = "200" ]; then
    HEALTHY=1
    echo "  Functions health endpoint is reachable (HTTP 200)."
    break
  fi
  echo "  Waiting for functions app... (attempt $i/30, status=$STATUS)"
  sleep 10
done

if [ "$HEALTHY" -ne 1 ]; then
  echo "ERROR: Functions health check did not return HTTP 200: $HEALTH_URL"
  exit 1
fi

echo "=== Functions deploy complete ==="
echo "  App: https://${FUNCTIONAPP_NAME}.azurewebsites.net"
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
