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

# ---------------------------------------------------------------------------
# Job freshness checks — alert when scheduled jobs haven't run on time.
#
# Format: "job_name:overdue_minutes:schedule"
#   overdue_minutes = alert if last run was more than this many minutes ago
#   schedule:
#     always           — checked 24/7
#     weekday_business — only checked Mon-Fri 08:00-20:30 UTC (legacy window; keep for future restricted jobs)
# ---------------------------------------------------------------------------
FRESHNESS_JOBS=(
    "keep-alive:40:always"
    "news-ingest:150:always"
    "event-processor:60:always"
    "deep-research:90:always"
    "onboarding-alerts:30:always"
    "crawl-frontier:90:always"
    "news-digest:3000:always"
    "sync-data:90:always"
    "code-update:800:always"
    "release-reconciler:30:always"
    "product-canary:90:always"
    "health-report:600:always"
)

LOG_DIR="/var/log/buildatlas"
STALE_ALERT_DIR="/tmp/buildatlas-stale-alerts"
mkdir -p "$STALE_ALERT_DIR"
NOW_TS=$(date +%s)
DOW=$(date -u +%u)        # 1=Mon … 7=Sun
HOUR=$(date -u +%-H)

for entry in "${FRESHNESS_JOBS[@]}"; do
    IFS=: read -r JOB OVERDUE_MIN SCHEDULE <<< "$entry"

    # Skip schedule-restricted jobs outside their window
    if [ "$SCHEDULE" = "weekday_business" ]; then
        if [ "$DOW" -gt 5 ] || [ "$HOUR" -lt 8 ] || [ "$HOUR" -ge 21 ]; then
            continue
        fi
    fi

    JOB_LOG="$LOG_DIR/$JOB.log"
    [ -f "$JOB_LOG" ] || continue

    # Find last completion timestamp (SUCCESS, FAILED, or TIMEOUT — any means it ran)
    LAST_LINE=$(grep -E '^\[.*UTC\] (SUCCESS|FAILED|TIMEOUT):' "$JOB_LOG" | tail -1)
    if [ -z "$LAST_LINE" ]; then
        continue  # No runs recorded yet, skip
    fi

    # Parse timestamp: [2026-02-08 07:00:06 UTC] SUCCESS: keep-alive
    LAST_TS_STR=$(echo "$LAST_LINE" | sed -n 's/^\[\(.*\) UTC\].*/\1/p')
    if [ -z "$LAST_TS_STR" ]; then
        continue
    fi
    LAST_TS=$(date -u -d "$LAST_TS_STR" +%s 2>/dev/null || echo "0")
    if [ "$LAST_TS" -eq 0 ]; then
        continue
    fi

    MINS_AGO=$(( (NOW_TS - LAST_TS) / 60 ))

    if [ "$MINS_AGO" -gt "$OVERDUE_MIN" ]; then
        # Dedup: only alert once per hour per job
        SENTINEL="$STALE_ALERT_DIR/$JOB"
        if [ -f "$SENTINEL" ]; then
            SENTINEL_AGE=$(( NOW_TS - $(stat -c %Y "$SENTINEL" 2>/dev/null || echo "$NOW_TS") ))
            if [ "$SENTINEL_AGE" -lt 3600 ]; then
                continue  # Already alerted within the last hour
            fi
        fi
        touch "$SENTINEL"

        # Extract last status from the line
        LAST_STATUS=$(echo "$LAST_LINE" | sed -n 's/.*UTC\] \(SUCCESS\|FAILED\|TIMEOUT\):.*/\1/p')
        ALERT=true
        ALERT_LINES+=("- Job '$JOB' overdue: last ran ${MINS_AGO}min ago (threshold: ${OVERDUE_MIN}min, last status: ${LAST_STATUS})")
    else
        # Job is on time — remove stale sentinel if it exists
        rm -f "$STALE_ALERT_DIR/$JOB"
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
