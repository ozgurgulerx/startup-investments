#!/bin/bash
# crawl-frontier.sh — Crawl frontier worker (every 30 min).
# Replaces: .github/workflows/crawl-frontier.yml (scheduled runs)
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
STATE_DIR="${CRAWL_FRONTIER_STATE_DIR:-/var/lib/buildatlas}"
SEED_CURSOR_FILE="$STATE_DIR/crawl-frontier.seed.cursor"
SEED_LAST_FILE="$STATE_DIR/crawl-frontier.seed.last"

SEED_ENABLED_RAW="${CRAWL_FRONTIER_SEED_ENABLED:-true}"
SEED_FORCE_RAW="${CRAWL_FRONTIER_FORCE_SEED:-false}"
SEED_INTERVAL_HOURS="${CRAWL_FRONTIER_SEED_INTERVAL_HOURS:-6}"
SEED_LIMIT="${CRAWL_FRONTIER_SEED_LIMIT:-5000}"
SEED_MAX_STARTUPS="${CRAWL_FRONTIER_SEED_MAX_STARTUPS:-500}"
SEED_MAX_SECONDS="${CRAWL_FRONTIER_SEED_MAX_SECONDS:-600}"
SEED_TIMEOUT_MIN="${CRAWL_FRONTIER_SEED_TIMEOUT_MIN:-20}"
WORKER_BATCH_SIZE="${CRAWLER_FRONTIER_BATCH_SIZE:-50}"
WORKER_MAX_LOOPS="${CRAWL_FRONTIER_MAX_LOOPS:-1}"

mkdir -p "$STATE_DIR"

is_true() {
    local value
    value="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
    case "$value" in
        1|true|yes|on) return 0 ;;
        *) return 1 ;;
    esac
}

echo "=== Crawl Frontier ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Log active unblock provider
PROVIDER="${CRAWLER_UNBLOCK_PROVIDER:-stealth}"
echo "Unblock provider: $PROVIDER"

# Apply migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" crawl

cd "$REPO_DIR/packages/analysis"

# Process event-driven refresh jobs (boost priority before seeding)
echo "Processing refresh jobs..."
if ! "$VENV_DIR/bin/python" main.py process-refresh-jobs --batch-size 50; then
    echo "Refresh job processing failed; continuing with worker"
fi

RUN_SEED=0
if is_true "$SEED_ENABLED_RAW"; then
    if is_true "$SEED_FORCE_RAW"; then
        RUN_SEED=1
        echo "Seed mode: forced"
    elif [ -s "$SEED_CURSOR_FILE" ]; then
        RUN_SEED=1
        echo "Seed mode: resuming from existing cursor"
    elif [ ! -f "$SEED_LAST_FILE" ]; then
        RUN_SEED=1
        echo "Seed mode: first run (no last-seed marker)"
    else
        NOW_EPOCH="$(date +%s)"
        LAST_EPOCH="$(cat "$SEED_LAST_FILE" 2>/dev/null || echo 0)"
        if [ $((NOW_EPOCH - LAST_EPOCH)) -ge $((SEED_INTERVAL_HOURS * 3600)) ]; then
            RUN_SEED=1
            echo "Seed mode: interval elapsed (${SEED_INTERVAL_HOURS}h)"
        else
            echo "Seed mode: skipped (interval ${SEED_INTERVAL_HOURS}h not reached)"
        fi
    fi
else
    echo "Seed mode: disabled via CRAWL_FRONTIER_SEED_ENABLED=${SEED_ENABLED_RAW}"
fi

if [ "$RUN_SEED" -eq 1 ]; then
    CURRENT_CURSOR="$(cat "$SEED_CURSOR_FILE" 2>/dev/null || true)"
    echo "Seeding frontier..."
    echo "  cursor=${CURRENT_CURSOR:-0} limit=${SEED_LIMIT} max_startups=${SEED_MAX_STARTUPS} max_seconds=${SEED_MAX_SECONDS} timeout=${SEED_TIMEOUT_MIN}m"

    SEED_OUTPUT_FILE="$(mktemp /tmp/crawl-frontier-seed.XXXXXX)"
    SEED_CMD=(
        "$VENV_DIR/bin/python" -m src.crawl_runtime.seed_frontier
        --limit "$SEED_LIMIT"
        --max-startups "$SEED_MAX_STARTUPS"
        --max-seconds "$SEED_MAX_SECONDS"
    )
    if [ -n "$CURRENT_CURSOR" ]; then
        SEED_CMD+=(--cursor "$CURRENT_CURSOR")
    fi

    if timeout "${SEED_TIMEOUT_MIN}m" "${SEED_CMD[@]}" >"$SEED_OUTPUT_FILE" 2>&1; then
        cat "$SEED_OUTPUT_FILE"

        read -r NEXT_CURSOR EXHAUSTED < <(
            python3 - "$SEED_OUTPUT_FILE" <<'PY'
import json
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace").strip()
if not text:
    print("__NONE__\ttrue")
    raise SystemExit(0)

obj = None
for candidate in reversed(text.splitlines()):
    candidate = candidate.strip()
    if not candidate:
        continue
    try:
        obj = json.loads(candidate)
        break
    except Exception:
        continue

if not isinstance(obj, dict):
    try:
        obj = json.loads(text)
    except Exception:
        obj = {}

next_cursor = obj.get("next_cursor")
exhausted = bool(obj.get("exhausted", False))
print(f"{next_cursor if next_cursor is not None else '__NONE__'}\t{'true' if exhausted else 'false'}")
PY
        )
        if [ "$NEXT_CURSOR" = "__NONE__" ]; then
            NEXT_CURSOR=""
        fi

        if [ "$EXHAUSTED" = "true" ]; then
            rm -f "$SEED_CURSOR_FILE"
            date +%s > "$SEED_LAST_FILE"
            echo "  Seed chunk reached end of dataset; cursor cleared"
        elif [ -n "$NEXT_CURSOR" ]; then
            echo "$NEXT_CURSOR" > "$SEED_CURSOR_FILE"
            date +%s > "$SEED_LAST_FILE"
            echo "  Seed chunk incomplete; next cursor=$NEXT_CURSOR"
        else
            echo "  Seed output had no next cursor; keeping previous cursor state"
        fi
    else
        cat "$SEED_OUTPUT_FILE"
        echo "Seed frontier step failed/timed out; continuing with existing queue"
    fi

    rm -f "$SEED_OUTPUT_FILE"
fi

# Run worker
echo "Running frontier worker..."
"$VENV_DIR/bin/python" -m src.crawl_runtime.worker --batch-size "$WORKER_BATCH_SIZE" --max-loops "$WORKER_MAX_LOOPS"

# Cleanup old raw captures (run once daily, during the midnight window)
HOUR=$(date -u +%H)
if [ "$HOUR" = "00" ] || [ "$HOUR" = "01" ]; then
    echo "Running retention cleanup..."
    "$VENV_DIR/bin/python" -m src.crawl_runtime.retention
fi

echo "=== Crawl Frontier complete ==="
