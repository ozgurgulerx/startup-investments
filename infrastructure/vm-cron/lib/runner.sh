#!/bin/bash
# runner.sh — Common cron job wrapper for BuildAtlas VM cron jobs.
#
# Features:
#   - Sources /etc/buildatlas/.env (or repo .env fallback)
#   - flock-based locking (prevents overlapping runs)
#   - Timeout enforcement
#   - Logging to /var/log/buildatlas/<job>.log
#   - Structured Slack notifications (start/success/failure/timeout)
#
# Usage: runner.sh <job_name> <timeout_minutes> <script_path> [args...]
set -uo pipefail

JOB_NAME="${1:?Usage: runner.sh <job_name> <timeout_min> <script_path> [args...]}"
TIMEOUT_MIN="${2:?}"
SCRIPT_PATH="${3:?}"
shift 3

LOG_DIR="${BUILDATLAS_LOG_DIR:-/var/log/buildatlas}"
LOG_FILE="$LOG_DIR/$JOB_NAME.log"
LOCK_FILE="/tmp/buildatlas-$JOB_NAME.lock"
REPO_DIR="${REPO_DIR:-/opt/buildatlas/startup-analysis}"
VENV_DIR="${VENV_DIR:-/opt/buildatlas/venv}"
ENV_FILE_PRIMARY="/etc/buildatlas/.env"
ENV_FILE_FALLBACK="$REPO_DIR/.env"
DEFAULT_SLACK_SUCCESS_JOBS="news-ingest,news-digest,frontend-deploy,backend-deploy,functions-deploy,code-update,sync-data,crawl-frontier"
DEFAULT_SLACK_START_JOBS="frontend-deploy,backend-deploy,functions-deploy,sync-data,code-update,news-digest"

AZURE_CONFIG_DIR_CREATED=0

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

list_contains_job() {
    local raw="${1:-}"
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

is_disabled() {
    # Allow disabling jobs without editing the installed crontab.
    # Useful for AKS cutovers where the VM may still run the cron schedule.
    list_contains_job "${BUILDATLAS_DISABLED_JOBS:-}" || list_contains_job "${BUILDATLAS_VM_CRON_DISABLED_JOBS:-}"
}

should_notify_success() {
    local raw=""
    # If SLACK_NOTIFY_SUCCESS_JOBS is explicitly set (even to empty), honor it.
    # Otherwise fall back to a low-noise default list.
    if [ "${SLACK_NOTIFY_SUCCESS_JOBS+x}" = "x" ]; then
        raw="${SLACK_NOTIFY_SUCCESS_JOBS}"
    else
        raw="$DEFAULT_SLACK_SUCCESS_JOBS"
    fi

    # Footgun prevention: a blank value should behave like defaults, not "disable everything".
    if [ -z "$(echo "$raw" | tr -d '[:space:]')" ]; then
        raw="$DEFAULT_SLACK_SUCCESS_JOBS"
    fi

    list_contains_job "$raw"
}

should_notify_start() {
    local raw=""
    if [ "${SLACK_NOTIFY_START_JOBS+x}" = "x" ]; then
        raw="${SLACK_NOTIFY_START_JOBS}"
    else
        raw="$DEFAULT_SLACK_START_JOBS"
    fi

    if [ -z "$(echo "$raw" | tr -d '[:space:]')" ]; then
        raw="$DEFAULT_SLACK_START_JOBS"
    fi

    list_contains_job "$raw"
}

git_sha_short() {
    git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || true
}

slack_url_for_job() {
    case "$JOB_NAME" in
        frontend-deploy) echo "${PUBLIC_BASE_URL:-https://buildatlas.net}" ;;
        backend-deploy) echo "${API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}/health" ;;
        functions-deploy) echo "https://${AZURE_FUNCTIONAPP_NAME:-buildatlas-functions}.azurewebsites.net/api/health" ;;
        *) echo "" ;;
    esac
}

build_slack_context_json() {
    local phase="${1:-}"
    local status="${2:-}"
    local exit_code="${3:-}"
    local duration_sec="${4:-}"
    local ended_at="${5:-}"

    CTX_EVENT_TYPE="cron_job" \
    CTX_PHASE="$phase" \
    CTX_STATUS="$status" \
    CTX_JOB_NAME="$JOB_NAME" \
    CTX_SCRIPT_PATH="$SCRIPT_PATH" \
    CTX_HOST="$BUILDATLAS_HOST" \
    CTX_TIMEOUT_MIN="$TIMEOUT_MIN" \
    CTX_RUN_ID="$RUN_ID" \
    CTX_SHA_SHORT="$SHA_SHORT" \
    CTX_STARTED_AT="$STARTED_AT_UTC" \
    CTX_ENDED_AT="$ended_at" \
    CTX_DURATION_SEC="$duration_sec" \
    CTX_EXIT_CODE="$exit_code" \
    CTX_LOG_FILE="$LOG_FILE" \
    python3 - <<'PY'
import json
import os

payload = {
    "event_type": os.environ.get("CTX_EVENT_TYPE", ""),
    "phase": os.environ.get("CTX_PHASE", ""),
    "status": os.environ.get("CTX_STATUS", ""),
    "job": os.environ.get("CTX_JOB_NAME", ""),
    "script": os.environ.get("CTX_SCRIPT_PATH", ""),
    "host": os.environ.get("CTX_HOST", ""),
    "timeout_min": os.environ.get("CTX_TIMEOUT_MIN", ""),
    "run_id": os.environ.get("CTX_RUN_ID", ""),
    "sha": os.environ.get("CTX_SHA_SHORT", ""),
    "started_at": os.environ.get("CTX_STARTED_AT", ""),
    "ended_at": os.environ.get("CTX_ENDED_AT", ""),
    "duration_sec": os.environ.get("CTX_DURATION_SEC", ""),
    "exit_code": os.environ.get("CTX_EXIT_CODE", ""),
    "log": os.environ.get("CTX_LOG_FILE", ""),
}

clean = {k: v for k, v in payload.items() if v not in ("", None)}
print(json.dumps(clean, ensure_ascii=True))
PY
}

send_slack_event() {
    local phase="${1:-}"
    local status="${2:-info}"
    local title="${3:-BuildAtlas Cron Event}"
    local body="${4:-}"
    local url="${5:-}"
    local exit_code="${6:-}"
    local duration_sec="${7:-}"
    local ended_at="${8:-}"
    local context_json=""

    context_json="$(build_slack_context_json "$phase" "$status" "$exit_code" "$duration_sec" "$ended_at")"

    SLACK_URL="$url" \
    SLACK_TITLE="$title" \
    SLACK_STATUS="$status" \
    SLACK_BODY="$body" \
    SLACK_CONTEXT_JSON="$context_json" \
    python3 "$REPO_DIR/scripts/slack_notify.py" >> "$LOG_FILE" 2>&1 || true
}

# Ensure GITHUB_REPOSITORY is set so slack_notify.py can fall back to repository_dispatch.
if [ -z "${GITHUB_REPOSITORY:-}" ]; then
    GITHUB_REPOSITORY="$(derive_github_repository || true)"
    export GITHUB_REPOSITORY
fi

# If the job is disabled, log a skip and exit cleanly.
if is_disabled; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] SKIP: $JOB_NAME disabled via BUILDATLAS_DISABLED_JOBS/BUILDATLAS_VM_CRON_DISABLED_JOBS" >> "$LOG_FILE"
    exit 0
fi

# Export VM-specific context (used by slack_notify.py and slack_daily_summary.py)
export BUILDATLAS_RUNNER="${BUILDATLAS_RUNNER:-vm-cron}"
export BUILDATLAS_JOB="$JOB_NAME"
export BUILDATLAS_LOG="$LOG_FILE"
export PATH="$VENV_DIR/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export BUILDATLAS_HOST="${HOSTNAME:-vm-buildatlas-cron}"
RUN_ID="${JOB_NAME}-$(date -u '+%Y%m%dT%H%M%SZ')-$$"
STARTED_AT_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
SHA_SHORT="$(git_sha_short)"

# Isolate Azure CLI state per job run to avoid concurrency races across cron jobs.
# (deploy.sh can trigger multiple deploys in parallel; other jobs also call `az login`.)
if [ -z "${AZURE_CONFIG_DIR:-}" ]; then
    export AZURE_CONFIG_DIR="/tmp/buildatlas-azure-${JOB_NAME}-${RUN_ID}"
    AZURE_CONFIG_DIR_CREATED=1
fi

cleanup_runner_tmp() {
    if [ "${AZURE_CONFIG_DIR_CREATED:-0}" = "1" ] && [ -n "${AZURE_CONFIG_DIR:-}" ]; then
        rm -rf "$AZURE_CONFIG_DIR" 2>/dev/null || true
    fi
}
trap cleanup_runner_tmp EXIT

mkdir -p "$AZURE_CONFIG_DIR" 2>/dev/null || true

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

# Optional start notification for high-signal jobs.
if should_notify_start || [ "$JOB_NAME" = "frontend-deploy" ] || [ "$JOB_NAME" = "backend-deploy" ] || [ "$JOB_NAME" = "functions-deploy" ]; then
    send_slack_event \
        "start" \
        "info" \
        "Cron start: $JOB_NAME" \
        "*Host:* ${BUILDATLAS_HOST}
*Timeout:* ${TIMEOUT_MIN}m
*SHA:* ${SHA_SHORT:-unknown}
*Run ID:* \`${RUN_ID}\`
*Script:* \`${SCRIPT_PATH}\`
*Log:* ${LOG_FILE}" \
        "$(slack_url_for_job)"
fi

# Track duration (used in Slack notifications)
START_TS="$(date +%s)"

# Run the job with timeout.
#
# Important: we strip NUL bytes from stdout/stderr before appending to the log.
# Some upstream tooling can emit occasional NULs which makes grep treat logs as
# binary ("binary file matches") and breaks freshness monitors (heartbeat).
cd "$REPO_DIR"
timeout "${TIMEOUT_MIN}m" bash "$SCRIPT_PATH" "$@" 2>&1 | tr -d '\000' | tee -a "$LOG_FILE"
EXIT_CODE=$?
DURATION_SEC="$(( $(date +%s) - START_TS ))"
ENDED_AT_UTC="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Log and notify
if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] SUCCESS: $JOB_NAME" >> "$LOG_FILE"

    # Deploys are high-signal operational events; always notify on success.
    if should_notify_success || [ "$JOB_NAME" = "frontend-deploy" ] || [ "$JOB_NAME" = "backend-deploy" ] || [ "$JOB_NAME" = "functions-deploy" ]; then
        send_slack_event \
            "finish" \
            "success" \
            "Cron success: $JOB_NAME" \
            "*Host:* ${BUILDATLAS_HOST}
*Duration:* ${DURATION_SEC}s
*SHA:* ${SHA_SHORT:-unknown}
*Run ID:* \`${RUN_ID}\`
*Log:* ${LOG_FILE}" \
            "$(slack_url_for_job)" \
            "0" \
            "$DURATION_SEC" \
            "$ENDED_AT_UTC"
    fi
elif [ $EXIT_CODE -eq 124 ]; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] TIMEOUT: $JOB_NAME (killed after ${TIMEOUT_MIN}m)" >> "$LOG_FILE"
    send_slack_event \
        "timeout" \
        "failure" \
        "Cron timeout: $JOB_NAME" \
        "Job killed after exceeding ${TIMEOUT_MIN}m timeout on ${BUILDATLAS_HOST}.
*Duration:* ${DURATION_SEC}s
*Run ID:* \`${RUN_ID}\`
*Log:* ${LOG_FILE}" \
        "$(slack_url_for_job)" \
        "$EXIT_CODE" \
        "$DURATION_SEC" \
        "$ENDED_AT_UTC"
else
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] FAILED: $JOB_NAME (exit $EXIT_CODE)" >> "$LOG_FILE"
    # Use the true tail so we don't cut off the actual error (tracebacks, etc).
    TAIL_OUTPUT=$(tail -20 "$LOG_FILE" 2>/dev/null || echo "(no output)")
    send_slack_event \
        "finish" \
        "failure" \
        "Cron failed: $JOB_NAME" \
        "*Exit code:* ${EXIT_CODE}
*Host:* ${BUILDATLAS_HOST}
*Duration:* ${DURATION_SEC}s
*Run ID:* \`${RUN_ID}\`
*Log:* ${LOG_FILE}
*Last output:*
\`\`\`
${TAIL_OUTPUT}
\`\`\`" \
        "$(slack_url_for_job)" \
        "$EXIT_CODE" \
        "$DURATION_SEC" \
        "$ENDED_AT_UTC"
fi

exit $EXIT_CODE
