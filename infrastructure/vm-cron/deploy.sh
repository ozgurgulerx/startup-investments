#!/bin/bash
# deploy.sh — Update code on the VM (git pull + conditional dep updates).
#
# Usage:
#   deploy.sh          # Interactive mode
#   deploy.sh --auto   # Quiet mode (for cron)
set -euo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
VENV_DIR="/opt/buildatlas/venv"

cd "$REPO_DIR"

# Ensure the VM crontab is installed and matches the repo version.
# This keeps cron stable even if entries are accidentally edited/removed.
ensure_crontab_installed() {
    local expected_file="$REPO_DIR/infrastructure/vm-cron/crontab"
    if ! command -v crontab >/dev/null 2>&1; then
        return 0
    fi
    if [ ! -f "$expected_file" ]; then
        return 0
    fi

    # crontab(5) is sensitive to CRLF; always strip CR characters when installing/comparing.
    install_expected() {
        tr -d '\r' < "$expected_file" | crontab -
    }

    local current=""
    current="$(crontab -l 2>/dev/null || true)"

    # If no crontab exists (or ours isn't installed), install it.
    if [ -z "$current" ] || ! echo "$current" | grep -q "BuildAtlas VM Cron Jobs"; then
        echo "Crontab missing/unexpected. Installing BuildAtlas VM crontab..."
        install_expected
        return 0
    fi

    # If content drifted from the repo version, reinstall it (cron-as-code).
    if ! diff -q <(printf "%s\n" "$current") <(tr -d '\r' < "$expected_file") >/dev/null 2>&1; then
        echo "Crontab drift detected. Reinstalling BuildAtlas VM crontab..."
        install_expected
    fi
}

# Stash any local changes (shouldn't exist, but safety)
git stash --include-untracked 2>/dev/null || true

# Record current HEAD so we can diff the full pulled range (not just the last commit).
OLD_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")

# Pull latest
echo "Pulling latest code..."
git pull --ff-only origin main

# Keep cron current even if the crontab file itself didn't change in this pull.
ensure_crontab_installed

# Check what changed in the pull range (handles multiple commits).
NEW_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
if [ -n "$OLD_HEAD" ] && [ -n "$NEW_HEAD" ] && [ "$OLD_HEAD" != "$NEW_HEAD" ]; then
    CHANGED_FILES=$(git diff --name-only "$OLD_HEAD..$NEW_HEAD" 2>/dev/null || echo "")
else
    CHANGED_FILES=""
fi

# Update Python deps if requirements changed
if echo "$CHANGED_FILES" | grep -q 'packages/analysis/requirements.txt'; then
    echo "Requirements changed. Updating Python dependencies..."
    "$VENV_DIR/bin/pip" install -r "$REPO_DIR/packages/analysis/requirements.txt" -q
fi

# Update Node deps if lockfile changed
if echo "$CHANGED_FILES" | grep -q 'pnpm-lock.yaml'; then
    echo "Node deps changed. Running pnpm install..."
    cd "$REPO_DIR" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install
fi

# Reinstall crontab if changed
if echo "$CHANGED_FILES" | grep -q 'infrastructure/vm-cron/crontab'; then
    echo "Crontab changed. Reinstalling..."
    ensure_crontab_installed
fi

# Update logrotate if changed
if echo "$CHANGED_FILES" | grep -q 'infrastructure/vm-cron/logrotate.conf'; then
    echo "Logrotate config changed. Updating..."
    sudo cp "$REPO_DIR/infrastructure/vm-cron/logrotate.conf" /etc/logrotate.d/buildatlas
fi

# Re-chmod scripts if new ones added
chmod +x "$REPO_DIR/infrastructure/vm-cron/"*.sh 2>/dev/null || true
chmod +x "$REPO_DIR/infrastructure/vm-cron/lib/"*.sh 2>/dev/null || true
chmod +x "$REPO_DIR/infrastructure/vm-cron/jobs/"*.sh 2>/dev/null || true
chmod +x "$REPO_DIR/infrastructure/vm-cron/monitoring/"*.sh 2>/dev/null || true

RUNNER="$REPO_DIR/infrastructure/vm-cron/lib/runner.sh"
JOBS_DIR="$REPO_DIR/infrastructure/vm-cron/jobs"

# Apply database migrations if new migration files were added
if echo "$CHANGED_FILES" | grep -qE '^database/migrations/'; then
    echo "New migrations detected. Applying performance indexes..."
    bash "$JOBS_DIR/apply-migrations.sh" performance
fi

# Auto-trigger deploys in parallel if both changed
DEPLOY_BACKEND=false
DEPLOY_FRONTEND=false

if echo "$CHANGED_FILES" | grep -qE '^(apps/api/|packages/shared/|infrastructure/kubernetes/)'; then
    DEPLOY_BACKEND=true
fi
if echo "$CHANGED_FILES" | grep -qE '^(apps/web/|packages/shared/)'; then
    DEPLOY_FRONTEND=true
fi

BACKEND_PID=""
FRONTEND_PID=""

if [ "$DEPLOY_BACKEND" = "true" ]; then
    echo "Backend code changed. Triggering backend deploy..."
    "$RUNNER" backend-deploy 20 "$JOBS_DIR/backend-deploy.sh" &
    BACKEND_PID=$!
fi

if [ "$DEPLOY_FRONTEND" = "true" ]; then
    echo "Frontend code changed. Triggering frontend deploy..."
    SKIP_PULL=1 "$RUNNER" frontend-deploy 25 "$JOBS_DIR/frontend-deploy.sh" &
    FRONTEND_PID=$!
fi

# Wait for background deploys to finish
DEPLOY_FAILED=false
if [ -n "$BACKEND_PID" ]; then
    if ! wait "$BACKEND_PID"; then
        echo "Backend deploy failed (pid $BACKEND_PID)"
        DEPLOY_FAILED=true
    fi
fi
if [ -n "$FRONTEND_PID" ]; then
    if ! wait "$FRONTEND_PID"; then
        echo "Frontend deploy failed (pid $FRONTEND_PID)"
        DEPLOY_FAILED=true
    fi
fi

if [ "$DEPLOY_FAILED" = "true" ]; then
    echo "ERROR: One or more deploys failed. Check logs."
    exit 1
fi

echo "Deploy complete at $(date -u '+%Y-%m-%d %H:%M UTC')"
