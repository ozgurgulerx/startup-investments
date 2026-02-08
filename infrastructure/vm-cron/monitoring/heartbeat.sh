#!/bin/bash
# heartbeat.sh — VM self-health monitoring.
# Runs every 5 minutes. Alerts via Slack on problems.
set -uo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
VENV_DIR="/opt/buildatlas/venv"
ENV_FILE_PRIMARY="/etc/buildatlas/.env"
ENV_FILE_FALLBACK="$REPO_DIR/.env"

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

export PATH="$VENV_DIR/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

export BUILDATLAS_RUNNER="vm-cron"
export BUILDATLAS_JOB="heartbeat"
export BUILDATLAS_HOST="${HOSTNAME:-vm-buildatlas-cron}"
export BUILDATLAS_LOG="/var/log/buildatlas/heartbeat.log"

mkdir -p "$(dirname "$BUILDATLAS_LOG")"

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

if [ -z "${GITHUB_REPOSITORY:-}" ]; then
    GITHUB_REPOSITORY="$(derive_github_repository || true)"
    export GITHUB_REPOSITORY
fi

ALERT=false
ALERT_LINES=()

# Check disk usage (alert if > 85%)
DISK_PCT=$(df /opt/buildatlas 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%' || echo "0")
if [ "$DISK_PCT" -gt 85 ] 2>/dev/null; then
    ALERT=true
    ALERT_LINES+=("- Disk usage: ${DISK_PCT}% (threshold: 85%)")
fi

# Check memory (alert if < 200MB available)
FREE_MB=$(free -m 2>/dev/null | awk '/Mem:/ {print $7}' || echo "9999")
if [ "$FREE_MB" -lt 200 ] 2>/dev/null; then
    ALERT=true
    ALERT_LINES+=("- Low memory: ${FREE_MB}MB available (threshold: 200MB)")
fi

# Check if cron is running
if ! systemctl is-active --quiet cron 2>/dev/null; then
    ALERT=true
    ALERT_LINES+=("- Cron service is NOT running!")
fi

# Check for stale lock files (jobs running > 2 hours)
for lockfile in /tmp/buildatlas-*.lock; do
    [ -f "$lockfile" ] || continue
    # Check if lock is held by testing if we can acquire it
    if ! flock -n "$lockfile" true 2>/dev/null; then
        AGE_SEC=$(( $(date +%s) - $(stat -c %Y "$lockfile" 2>/dev/null || echo "$(date +%s)") ))
        AGE_MIN=$(( AGE_SEC / 60 ))
        if [ "$AGE_MIN" -gt 120 ]; then
            JOB=$(basename "$lockfile" .lock | sed 's/buildatlas-//')
            ALERT=true
            ALERT_LINES+=("- Job '$JOB' locked for ${AGE_MIN}min (possible hang)")
        fi
    fi
done

# Send alert if needed
if [ "$ALERT" = true ]; then
    BODY=$(printf '%s\n' "${ALERT_LINES[@]}")
    SLACK_TITLE="VM Health Alert (vm-buildatlas-cron)" \
    SLACK_STATUS="warning" \
    SLACK_BODY="$BODY" \
    python3 "$REPO_DIR/scripts/slack_notify.py" >> "$BUILDATLAS_LOG" 2>&1 || true
fi
