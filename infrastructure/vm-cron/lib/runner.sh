#!/bin/bash
# runner.sh — Common cron job wrapper for BuildAtlas VM cron jobs.
#
# Features:
#   - Sources /etc/buildatlas/.env
#   - flock-based locking (prevents overlapping runs)
#   - Timeout enforcement
#   - Logging to /var/log/buildatlas/<job>.log
#   - Slack notification on failure/timeout
#
# Usage: runner.sh <job_name> <timeout_minutes> <script_path> [args...]
set -uo pipefail

JOB_NAME="${1:?Usage: runner.sh <job_name> <timeout_min> <script_path> [args...]}"
TIMEOUT_MIN="${2:?}"
SCRIPT_PATH="${3:?}"
shift 3

LOG_DIR="/var/log/buildatlas"
LOG_FILE="$LOG_DIR/$JOB_NAME.log"
LOCK_FILE="/tmp/buildatlas-$JOB_NAME.lock"
REPO_DIR="/opt/buildatlas/startup-analysis"
VENV_DIR="/opt/buildatlas/venv"
ENV_FILE="/etc/buildatlas/.env"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Source environment variables
if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
fi

# Export VM-specific context (used by slack_notify.py and slack_daily_summary.py)
export BUILDATLAS_RUNNER="vm-cron"
export BUILDATLAS_JOB="$JOB_NAME"
export BUILDATLAS_LOG="$LOG_FILE"
export PATH="$VENV_DIR/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Acquire exclusive lock (non-blocking). If already running, skip.
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] SKIP: $JOB_NAME already running" >> "$LOG_FILE"
    exit 0
fi

# Log start
{
    echo ""
    echo "========================================"
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] START: $JOB_NAME"
} >> "$LOG_FILE"

# Run the job with timeout
cd "$REPO_DIR"
timeout "${TIMEOUT_MIN}m" bash "$SCRIPT_PATH" "$@" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

# Log and notify
if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] SUCCESS: $JOB_NAME" >> "$LOG_FILE"
elif [ $EXIT_CODE -eq 124 ]; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] TIMEOUT: $JOB_NAME (killed after ${TIMEOUT_MIN}m)" >> "$LOG_FILE"
    SLACK_TITLE="Cron timeout: $JOB_NAME" \
    SLACK_STATUS="failure" \
    SLACK_BODY="Job killed after exceeding ${TIMEOUT_MIN}m timeout on vm-buildatlas-cron." \
    python3 "$REPO_DIR/scripts/slack_notify.py" 2>/dev/null || true
else
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] FAILED: $JOB_NAME (exit $EXIT_CODE)" >> "$LOG_FILE"
    TAIL_OUTPUT=$(tail -15 "$LOG_FILE" 2>/dev/null | head -10 || echo "(no output)")
    SLACK_TITLE="Cron failed: $JOB_NAME" \
    SLACK_STATUS="failure" \
    SLACK_BODY="*Exit code:* ${EXIT_CODE}
*Last output:*
\`\`\`
${TAIL_OUTPUT}
\`\`\`" \
    python3 "$REPO_DIR/scripts/slack_notify.py" 2>/dev/null || true
fi

exit $EXIT_CODE
