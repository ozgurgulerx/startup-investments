#!/bin/bash
# frontend-deploy.sh — Build Next.js app and deploy to Azure App Service.
#
# Called by sync-data.sh after a successful push, or manually via:
#   runner.sh frontend-deploy 20 /opt/buildatlas/infrastructure/vm-cron/jobs/frontend-deploy.sh
#
# Requires: Node.js 20, pnpm 8, Azure CLI (logged in with managed identity)
# Env vars sourced from /etc/buildatlas/.env by runner.sh
set -euo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
WEB_DIR="$REPO_DIR/apps/web"
WEBAPP_NAME="buildatlas-web"
RESOURCE_GROUP="rg-startup-analysis"

# Cleanup temp files on exit (success or failure)
cleanup() {
    cd "$WEB_DIR" 2>/dev/null || true
    rm -rf deploy deploy.zip
}
trap cleanup EXIT

echo "=== Frontend Deploy ==="
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Commit SHA used for build marker + smoke checks.
COMMIT_SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo "")"

# Azure CLI login (managed identity, needed for az webapp deploy)
az_login() {
    for i in 1 2 3; do
        if az login --identity --output none; then
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

echo "  Commit: ${COMMIT_SHA:-unknown}"
echo ""

# runner.sh sources /etc/buildatlas/.env (or repo .env fallback). For convenience, also
# allow web-scoped overrides from apps/web/.env.local (not committed).
if [ -f "$WEB_DIR/.env.local" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$WEB_DIR/.env.local"
    set +a
fi

# If API_KEY is missing, attempt to reuse the existing App Service setting to avoid
# breaking deploys when /etc/buildatlas/.env isn't present on the VM.
if [ -z "${API_KEY:-}" ]; then
    EXISTING_API_KEY="$(az webapp config appsettings list \
        --resource-group "$RESOURCE_GROUP" \
        --name "$WEBAPP_NAME" \
        --query "[?name=='API_KEY'].value | [0]" \
        -o tsv 2>/dev/null || true)"
    if [ -n "${EXISTING_API_KEY:-}" ] && [ "${EXISTING_API_KEY:-}" != "null" ]; then
        export API_KEY="$EXISTING_API_KEY"
        echo "  Loaded API_KEY from existing App Service settings."
    fi
fi

SKIP_API_KEY_UPDATE=0
if [ -z "${API_KEY:-}" ]; then
    # Don't block deploy: preserve existing App Service setting by not updating API_KEY at all.
    # This avoids a hard failure when the VM identity can't read app settings due to RBAC.
    echo "  WARNING: API_KEY is not set (and could not be loaded)."
    echo "  WARNING: Proceeding without updating API_KEY app setting (will preserve existing value, if any)."
    SKIP_API_KEY_UPDATE=1
fi

# --- Step 1: Pull latest code (skip if deploy.sh already did it) ---
if [ "${SKIP_PULL:-}" != "1" ]; then
    echo "[1/7] Pulling latest code..."
    cd "$REPO_DIR"
    git pull --ff-only origin main
    echo ""
    echo "[2/7] Installing dependencies..."
    pnpm install --frozen-lockfile
else
    echo "[1/7] Skipping pull (already done by deploy.sh)"
    echo "[2/7] Skipping install (already done by deploy.sh)"
fi

# --- Step 3: Build Next.js ---
echo ""
echo "[3/7] Building Next.js app..."
rm -rf "$WEB_DIR/.next"

# Export build-time env vars (sourced from /etc/buildatlas/.env by runner.sh)
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}"
export NEXT_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com"
export NEXT_PUBLIC_POSTHOG_KEY="${POSTHOG_KEY:-}"
export NEXT_PUBLIC_BUILD_SHA="${COMMIT_SHA:-unknown}"

pnpm --filter web build

# --- Step 4: Assemble deployment package ---
echo ""
echo "[4/7] Assembling deployment package..."
cd "$WEB_DIR"
rm -rf deploy deploy.zip

mkdir -p deploy

# Copy standalone output with symlinks dereferenced
rsync -a --copy-links .next/standalone/apps/web/ deploy/
rsync -a --copy-links .next/standalone/node_modules/ deploy/node_modules/

# Copy static files
mkdir -p deploy/.next/static
rsync -a .next/static/ deploy/.next/static/

# Copy public folder
rsync -a public/ deploy/public/

# Copy file-based datasets (regional fallback + API-down scenarios)
rsync -a data/ deploy/data/

# Remove Oryx artifacts
rm -f deploy/node_modules.tar.gz
rm -f deploy/oryx-manifest.toml
rm -f deploy/.oryx-manifest.toml

# --- Step 5: Fix pnpm symlinks ---
echo ""
echo "[5/7] Fixing pnpm symlinks..."

# Build lookup map once (instead of running find per package)
echo "  Building package lookup map..."
declare -A PKG_MAP
while IFS= read -r dir; do
    # Extract package name from path: .../node_modules/PACKAGE
    pkg="${dir##*/node_modules/}"
    if [ -n "$pkg" ] && [ -z "${PKG_MAP[$pkg]:-}" ]; then
        PKG_MAP["$pkg"]="$dir"
    fi
done < <(find deploy/node_modules/.pnpm -type d -path "*/node_modules/*" \
    2>/dev/null)

# Fallback map from repo root
declare -A ROOT_PKG_MAP
while IFS= read -r dir; do
    pkg="${dir##*/node_modules/}"
    if [ -n "$pkg" ] && [ -z "${ROOT_PKG_MAP[$pkg]:-}" ]; then
        ROOT_PKG_MAP["$pkg"]="$dir"
    fi
done < <(find "$REPO_DIR/node_modules/.pnpm" -maxdepth 5 -type d -path "*/node_modules/*" \
    2>/dev/null)
echo "  Lookup map: ${#PKG_MAP[@]} deploy + ${#ROOT_PKG_MAP[@]} root packages"

fix_package() {
    local PKG=$1
    local PKG_PATH="deploy/node_modules/$PKG"

    rm -rf "$PKG_PATH"

    local PKG_SRC="${PKG_MAP[$PKG]:-}"
    if [ -z "$PKG_SRC" ]; then
        PKG_SRC="${ROOT_PKG_MAP[$PKG]:-}"
    fi

    if [ -n "$PKG_SRC" ]; then
        mkdir -p "$(dirname "$PKG_PATH")"
        cp -rL "$PKG_SRC" "$PKG_PATH"
        echo "  Fixed: $PKG"
    fi
}

# Critical packages required by Next.js runtime
CRITICAL_PACKAGES=(
    "styled-jsx"
    "@swc/helpers"
    "@next/env"
    "client-only"
    "server-only"
    "next-auth"
    "@auth/core"
    "@panva/hkdf"
    "jose"
    "oauth4webapi"
    "preact"
    "preact-render-to-string"
    "caniuse-lite"
    "postcss"
    "react"
    "react-dom"
    "pg"
    "pg-types"
    "pg-pool"
    "pg-protocol"
    "pg-connection-string"
    "pgpass"
    "buffer-writer"
    "packet-reader"
    "postgres-array"
    "postgres-bytea"
    "postgres-date"
    "postgres-interval"
    "pg-int8"
    "scheduler"
    "xtend"
    "split2"
    "obuf"
    "bcryptjs"
)

for PKG in "${CRITICAL_PACKAGES[@]}"; do
    fix_package "$PKG"
done

# Fix broken symlinks (up to 3 passes — fewer needed with pre-built map)
echo "Scanning for broken symlinks..."
for i in 1 2 3; do
    FOUND_BROKEN=0
    while IFS= read -r LINK; do
        if [ -n "$LINK" ] && [ ! -e "$LINK" ]; then
            FOUND_BROKEN=1
            PKG_NAME=$(basename "$LINK")
            rm -f "$LINK"

            PKG_SRC="${PKG_MAP[$PKG_NAME]:-}"
            if [ -z "$PKG_SRC" ]; then
                PKG_SRC="${ROOT_PKG_MAP[$PKG_NAME]:-}"
            fi

            if [ -n "$PKG_SRC" ]; then
                cp -rL "$PKG_SRC" "$LINK"
                echo "  Fixed broken symlink: $PKG_NAME (pass $i)"
            fi
        fi
    done < <(find deploy/node_modules -type l 2>/dev/null)

    if [ $FOUND_BROKEN -eq 0 ]; then
        echo "No broken symlinks after pass $i"
        break
    fi
done

# Verify critical packages
echo ""
echo "Verifying critical packages..."
MISSING=0
for CHECK in "styled-jsx/package.json" "@swc/helpers/package.json" "next/package.json" "pg/package.json" "react/package.json"; do
    if [ ! -f "deploy/node_modules/$CHECK" ]; then
        echo "  MISSING: $CHECK"
        MISSING=1
    fi
done
if [ "$MISSING" -eq 1 ]; then
    echo "ERROR: Critical packages missing. Aborting deploy."
    exit 1
fi
echo "  All critical packages verified."

# --- Step 6: Configure App Service settings ---
echo ""
echo "[6/7] Configuring App Service settings..."

SETTINGS=(
    "NODE_ENV=production"
    "WEBSITE_RUN_FROM_PACKAGE=1"
    "SCM_DO_BUILD_DURING_DEPLOYMENT=false"
    "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}"
    "NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com"
    "NEXTAUTH_URL=${NEXTAUTH_URL:-https://buildatlas.net}"
    "PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-https://buildatlas.net}"
    "NEXT_PUBLIC_BUILD_SHA=${COMMIT_SHA:-unknown}"
)

# Only set secrets when provided, to avoid wiping existing App Service settings.
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

# --- Step 7: Deploy ---
echo ""
echo "[7/7] Deploying to App Service..."
cd deploy && zip -qr ../deploy.zip . && cd ..

az webapp deploy \
    --resource-group "$RESOURCE_GROUP" \
    --name "$WEBAPP_NAME" \
    --src-path deploy.zip \
    --type zip \
    --clean true

echo ""
echo "[8/8] Smoke check (verify build is live)..."
BASE_URL="${PUBLIC_BASE_URL:-https://buildatlas.net}"
if [ -z "${COMMIT_SHA:-}" ]; then
    echo "  WARN: Missing COMMIT_SHA; skipping smoke check."
else
    OK=0
    for i in $(seq 1 30); do
        # Bust any intermediate caches with a dummy query string.
        HTML="$(curl -fsS --max-time 15 -H 'Cache-Control: no-cache' "${BASE_URL}/?v=${COMMIT_SHA}" 2>/dev/null || true)"
        if echo "$HTML" | grep -q "ba-build-sha\" content=\"${COMMIT_SHA}\""; then
            OK=1
            echo "  OK: build marker ba-build-sha=${COMMIT_SHA}"
            break
        fi
        echo "  Waiting for new build to become visible... (attempt $i/30)"
        sleep 6
    done
    # If not visible after 3 min, restart App Service and retry
    if [ "$OK" -ne 1 ]; then
        echo "  WARN: Build not visible after 3 min — restarting App Service..."
        az webapp restart --resource-group "$RESOURCE_GROUP" --name "$WEBAPP_NAME" --output none 2>/dev/null || true
        sleep 15
        for i in $(seq 1 10); do
            HTML="$(curl -fsS --max-time 15 -H 'Cache-Control: no-cache' "${BASE_URL}/?v=${COMMIT_SHA}-r" 2>/dev/null || true)"
            if echo "$HTML" | grep -q "ba-build-sha\" content=\"${COMMIT_SHA}\""; then
                OK=1
                echo "  OK: build marker ba-build-sha=${COMMIT_SHA} (after restart)"
                break
            fi
            echo "  Post-restart check... (attempt $i/10)"
            sleep 6
        done
    fi
    if [ "$OK" -ne 1 ]; then
        echo "ERROR: Deployed, but new build marker was not observed on ${BASE_URL} after restart+retry."
        exit 1
    fi
fi

echo ""
echo "=== Frontend deploy complete ==="
echo "  App: https://buildatlas.net"
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
