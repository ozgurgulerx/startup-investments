#!/bin/bash
# runner.sh — Common cron job wrapper for BuildAtlas VM cron jobs.
#
# Features:
#   - Sources /etc/buildatlas/.env (or repo .env fallback)
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
ENV_FILE_PRIMARY="/etc/buildatlas/.env"
ENV_FILE_FALLBACK="$REPO_DIR/.env"
DEFAULT_SLACK_SUCCESS_JOBS="news-ingest,news-digest,frontend-deploy,backend-deploy,code-update"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Source environment variables
if [ -f "$ENV_FILE_PRIMARY" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE_PRIMARY"
    set +a
elif [ -f "$ENV_FILE_FALLBACK" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE_FALLBACK"
    set +a
fi

derive_github_repository() {
    local origin=""
    origin="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)"
    origin="${origin%.git}"

    if [[ "$origin" == https://github.com/* ]]; then
        echo "${origin#https://github.com/}"
        return 0
    fi
    if [[ "$origin" == git@github.com:* ]]; then
        echo "${origin#git@github.com:}"
        return 0
    fi
    return 1
}

# Ensure GITHUB_REPOSITORY is set so slack_notify.py can fall back to repository_dispatch.
if [ -z "${GITHUB_REPOSITORY:-}" ]; then
    GITHUB_REPOSITORY="$(derive_github_repository || true)"
    export GITHUB_REPOSITORY
fi

# Export VM-specific context (used by slack_notify.py and slack_daily_summary.py)
export BUILDATLAS_RUNNER="vm-cron"
export BUILDATLAS_JOB="$JOB_NAME"
export BUILDATLAS_LOG="$LOG_FILE"
export PATH="$VENV_DIR/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export BUILDATLAS_HOST="${HOSTNAME:-vm-buildatlas-cron}"

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

# Track duration (used in Slack notifications)
START_TS="$(date +%s)"

# Run the job with timeout
cd "$REPO_DIR"
timeout "${TIMEOUT_MIN}m" bash "$SCRIPT_PATH" "$@" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
DURATION_SEC="$(( $(date +%s) - START_TS ))"

should_notify_success() {
    local raw=""
    # If SLACK_NOTIFY_SUCCESS_JOBS is explicitly set (even to empty), honor it.
    # Otherwise fall back to a low-noise default list.
    if [ "${SLACK_NOTIFY_SUCCESS_JOBS+x}" = "x" ]; then
        raw="${SLACK_NOTIFY_SUCCESS_JOBS}"
    else
        raw="$DEFAULT_SLACK_SUCCESS_JOBS"
    fi
    raw="$(echo "$raw" | tr -d '[:space:]')"
    if [ -z "$raw" ]; then
        return 1
    fi
    if [ "$raw" = "off" ] || [ "$raw" = "none" ] || [ "$raw" = "0" ]; then
        return 1
    fi
    if [ "$raw" = "all" ]; then
        return 0
    fi
    case ",$raw," in
        *,"$JOB_NAME",*) return 0 ;;
        *) return 1 ;;
    esac
}

git_sha_short() {
    git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || true
}

# Log and notify
if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] SUCCESS: $JOB_NAME" >> "$LOG_FILE"

    if should_notify_success; then
        SHA_SHORT="$(git_sha_short)"
        SLACK_TITLE="Cron success: $JOB_NAME" \
        SLACK_STATUS="success" \
        SLACK_BODY="*Host:* ${BUILDATLAS_HOST}
*Duration:* ${DURATION_SEC}s
*SHA:* ${SHA_SHORT:-unknown}
*Log:* ${LOG_FILE}" \
        python3 "$REPO_DIR/scripts/slack_notify.py" 2>/dev/null || true
    fi
elif [ $EXIT_CODE -eq 124 ]; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] TIMEOUT: $JOB_NAME (killed after ${TIMEOUT_MIN}m)" >> "$LOG_FILE"
    SLACK_TITLE="Cron timeout: $JOB_NAME" \
    SLACK_STATUS="failure" \
    SLACK_BODY="Job killed after exceeding ${TIMEOUT_MIN}m timeout on ${BUILDATLAS_HOST}.
*Duration:* ${DURATION_SEC}s
*Log:* ${LOG_FILE}" \
    python3 "$REPO_DIR/scripts/slack_notify.py" 2>/dev/null || true
else
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] FAILED: $JOB_NAME (exit $EXIT_CODE)" >> "$LOG_FILE"
    TAIL_OUTPUT=$(tail -15 "$LOG_FILE" 2>/dev/null | head -10 || echo "(no output)")
    SLACK_TITLE="Cron failed: $JOB_NAME" \
    SLACK_STATUS="failure" \
    SLACK_BODY="*Exit code:* ${EXIT_CODE}
*Host:* ${BUILDATLAS_HOST}
*Duration:* ${DURATION_SEC}s
*Log:* ${LOG_FILE}
*Last output:*
\`\`\`
${TAIL_OUTPUT}
\`\`\`" \
    python3 "$REPO_DIR/scripts/slack_notify.py" 2>/dev/null || true
fi

exit $EXIT_CODE
