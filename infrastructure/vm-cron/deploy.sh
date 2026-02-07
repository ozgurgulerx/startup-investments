#!/bin/bash
# deploy.sh — Update code on the VM (git pull + conditional dep updates).
#
# Usage:
#   deploy.sh          # Interactive mode
#   deploy.sh --auto   # Quiet mode (for cron)
set -uo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
VENV_DIR="/opt/buildatlas/venv"

cd "$REPO_DIR"

# Stash any local changes (shouldn't exist, but safety)
git stash --include-untracked 2>/dev/null || true

# Pull latest
echo "Pulling latest code..."
git pull --ff-only origin main

# Check what changed in the last pull
CHANGED_FILES=$(git diff HEAD~1 --name-only 2>/dev/null || echo "")

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
    crontab "$REPO_DIR/infrastructure/vm-cron/crontab"
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

# Auto-trigger backend deploy if API code changed
if echo "$CHANGED_FILES" | grep -qE '^(apps/api/|packages/shared/|infrastructure/kubernetes/)'; then
    echo "Backend code changed. Triggering backend deploy..."
    "$RUNNER" backend-deploy 15 "$JOBS_DIR/backend-deploy.sh" || echo "Backend deploy failed (exit $?)"
fi

# Auto-trigger frontend deploy if web code changed
if echo "$CHANGED_FILES" | grep -qE '^(apps/web/|packages/shared/)'; then
    echo "Frontend code changed. Triggering frontend deploy..."
    "$RUNNER" frontend-deploy 20 "$JOBS_DIR/frontend-deploy.sh" || echo "Frontend deploy failed (exit $?)"
fi

echo "Deploy complete at $(date -u '+%Y-%m-%d %H:%M UTC')"
