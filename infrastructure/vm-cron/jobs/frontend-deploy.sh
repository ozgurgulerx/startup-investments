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

# Cleanup temp files on exit (success or failure)
cleanup() {
    cd "$WEB_DIR" 2>/dev/null || true
    rm -rf deploy deploy.zip
}
trap cleanup EXIT

echo "=== Frontend Deploy ==="
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Azure CLI login (managed identity, needed for az webapp deploy)
az login --identity --output none 2>/dev/null || true

echo "  Commit: $(git -C "$REPO_DIR" rev-parse --short HEAD)"
echo ""

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
    ! -path "*/node_modules/.pnpm/*" 2>/dev/null | grep -v '/node_modules/.*node_modules/.*/node_modules/')

# Fallback map from repo root
declare -A ROOT_PKG_MAP
while IFS= read -r dir; do
    pkg="${dir##*/node_modules/}"
    if [ -n "$pkg" ] && [ -z "${ROOT_PKG_MAP[$pkg]:-}" ]; then
        ROOT_PKG_MAP["$pkg"]="$dir"
    fi
done < <(find "$REPO_DIR/node_modules/.pnpm" -maxdepth 5 -type d -path "*/node_modules/*" \
    ! -path "*/node_modules/.pnpm/*" 2>/dev/null | grep -v '/node_modules/.*node_modules/.*/node_modules/')
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
az webapp config appsettings set \
    --resource-group rg-startup-analysis \
    --name "$WEBAPP_NAME" \
    --settings \
        DATABASE_URL="${DATABASE_URL}" \
        AUTH_SECRET="${NEXTAUTH_SECRET:-}" \
        NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-}" \
        NEXTAUTH_URL="${NEXTAUTH_URL:-https://buildatlas.net}" \
        GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
        GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}" \
        NODE_ENV=production \
        WEBSITE_RUN_FROM_PACKAGE=1 \
        SCM_DO_BUILD_DURING_DEPLOYMENT=false \
        NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL}" \
        API_KEY="${API_KEY:-}" \
        PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://buildatlas.net}" \
        RESEND_API_KEY="${RESEND_API_KEY:-}" \
        NEWS_DIGEST_FROM_EMAIL="${NEWS_DIGEST_FROM_EMAIL:-}" \
        NEWS_DIGEST_REPLY_TO="${NEWS_DIGEST_REPLY_TO:-}" \
        NEXT_PUBLIC_POSTHOG_KEY="${POSTHOG_KEY:-}" \
        NEXT_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com" \
    --output none

# --- Step 7: Deploy ---
echo ""
echo "[7/7] Deploying to App Service..."
cd deploy && zip -qr ../deploy.zip . && cd ..

az webapp deploy \
    --resource-group rg-startup-analysis \
    --name "$WEBAPP_NAME" \
    --src-path deploy.zip \
    --type zip \
    --clean true

echo ""
echo "=== Frontend deploy complete ==="
echo "  App: https://buildatlas.net"
echo "  Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
