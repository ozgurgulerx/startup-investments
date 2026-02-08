#!/bin/bash
# sync-data.sh — Sync blob storage data, commit, push, and deploy frontend.
# Replaces: .github/workflows/sync-data.yml (scheduled runs)
#
# After syncing and pushing, triggers frontend-deploy.sh on this VM
# (previously relied on GitHub Actions frontend-deploy.yml).
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== Sync Data ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Azure CLI login (managed identity, for blob storage access)
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
    echo "ERROR: Azure managed identity login failed (needed for blob storage access)"
    exit 1
fi

cd "$REPO_DIR/packages/analysis"

# Step 1: Check for changes
echo "Checking blob storage for changes..."
SYNC_CHECK_LOG="/tmp/sync-changes.txt"
"$VENV_DIR/bin/python" -m src.sync.blob_sync --check --target "$REPO_DIR/apps/web/data" > "$SYNC_CHECK_LOG" 2>&1
cat "$SYNC_CHECK_LOG"

ADDED=$(grep "Added:" "$SYNC_CHECK_LOG" 2>/dev/null | awk '{print $2}' || echo "0")
MODIFIED=$(grep "Modified:" "$SYNC_CHECK_LOG" 2>/dev/null | awk '{print $2}' || echo "0")
TOTAL=$((ADDED + MODIFIED))

if [ "$TOTAL" -eq 0 ]; then
    echo "No changes detected. Done."
    exit 0
fi

echo "Found $TOTAL changes ($ADDED added, $MODIFIED modified). Syncing..."

# Step 2: Sync data from blob storage
"$VENV_DIR/bin/python" -m src.sync.blob_sync --target "$REPO_DIR/apps/web/data" --manifest

# Step 3: Pull latest to avoid conflicts, then commit and push
cd "$REPO_DIR"
git pull --rebase origin main 2>/dev/null || git pull origin main

git add apps/web/data/

if git diff --staged --quiet; then
    echo "No git changes after sync. Done."
    exit 0
fi

TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M UTC")
git config user.email "buildatlas-vm[bot]@users.noreply.github.com"
git config user.name "buildatlas-vm[bot]"
git commit -m "Sync blob storage data ($TOTAL updates)

Synced at: $TIMESTAMP
Trigger: vm-cron sync-data"

git push origin main

echo "Pushed $TOTAL changes. Triggering frontend deploy..."

# Deploy frontend directly on VM (no longer relies on GitHub Actions)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/../lib/runner.sh" frontend-deploy 20 "$SCRIPT_DIR/frontend-deploy.sh"

echo "=== Sync Data complete ==="
