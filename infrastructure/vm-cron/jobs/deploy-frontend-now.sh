#!/bin/bash
# deploy-frontend-now.sh — Trigger an immediate frontend deploy, bypassing cron wait.
#
# Usage (from local machine):
#   ssh buildatlas@20.90.104.162 '/opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/deploy-frontend-now.sh'
#
# Usage (on the VM):
#   /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/deploy-frontend-now.sh
#
# Optional env vars:
#   CLEAN_BUILD=1  — delete .next cache before building
#   SKIP_PULL=1    — skip git pull (use current code)
set -euo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
RUNNER="$REPO_DIR/infrastructure/vm-cron/lib/runner.sh"
JOBS_DIR="$REPO_DIR/infrastructure/vm-cron/jobs"

# Pull latest code first (unless caller already did)
if [ "${SKIP_PULL:-}" != "1" ]; then
    echo "Pulling latest code..."
    cd "$REPO_DIR"
    git pull --ff-only origin main
fi

echo "Triggering frontend deploy..."
exec "$RUNNER" frontend-deploy 25 "$JOBS_DIR/frontend-deploy.sh"
