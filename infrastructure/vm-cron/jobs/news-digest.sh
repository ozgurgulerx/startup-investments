#!/bin/bash
# news-digest.sh — Daily digest sender for both regions.
# Replaces: .github/workflows/news-digest-daily.yml (scheduled runs)
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
LOG_FILE="${BUILDATLAS_LOG:-/var/log/buildatlas/news-digest.log}"

echo "=== News Digest ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Apply migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news-digest

cd "$REPO_DIR/packages/analysis"

extract_metric() {
    local label="$1"
    local text="$2"
    LABEL="$label" TEXT="$text" python3 - <<'PY'
import os
import re

label = os.environ.get("LABEL", "")
text = os.environ.get("TEXT", "")
text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)
m = re.search(rf"{re.escape(label)}\s*:\s*([0-9]+)", text, flags=re.IGNORECASE)
print(m.group(1) if m else "")
PY
}

to_int() {
    local v="${1:-}"
    if [[ "$v" =~ ^[0-9]+$ ]]; then
        echo "$v"
    else
        echo "0"
    fi
}

build_digest_context_json() {
    CTX_GLOBAL_SENT="$GLOBAL_SENT" \
    CTX_GLOBAL_SKIPPED="$GLOBAL_SKIPPED" \
    CTX_GLOBAL_FAILED="$GLOBAL_FAILED" \
    CTX_GLOBAL_EXIT="$GLOBAL_EXIT" \
    CTX_TURKEY_SENT="$TURKEY_SENT" \
    CTX_TURKEY_SKIPPED="$TURKEY_SKIPPED" \
    CTX_TURKEY_FAILED="$TURKEY_FAILED" \
    CTX_TURKEY_EXIT="$TURKEY_EXIT" \
    CTX_TOTAL_SENT="$TOTAL_SENT" \
    CTX_TOTAL_SKIPPED="$TOTAL_SKIPPED" \
    CTX_TOTAL_FAILED="$TOTAL_FAILED" \
    python3 - <<'PY'
import json
import os

payload = {
    "event_type": "digest_delivery",
    "global_sent": os.environ.get("CTX_GLOBAL_SENT", ""),
    "global_skipped": os.environ.get("CTX_GLOBAL_SKIPPED", ""),
    "global_failed": os.environ.get("CTX_GLOBAL_FAILED", ""),
    "global_exit": os.environ.get("CTX_GLOBAL_EXIT", ""),
    "turkey_sent": os.environ.get("CTX_TURKEY_SENT", ""),
    "turkey_skipped": os.environ.get("CTX_TURKEY_SKIPPED", ""),
    "turkey_failed": os.environ.get("CTX_TURKEY_FAILED", ""),
    "turkey_exit": os.environ.get("CTX_TURKEY_EXIT", ""),
    "total_sent": os.environ.get("CTX_TOTAL_SENT", ""),
    "total_skipped": os.environ.get("CTX_TOTAL_SKIPPED", ""),
    "total_failed": os.environ.get("CTX_TOTAL_FAILED", ""),
}
clean = {k: v for k, v in payload.items() if v not in ("", None)}
print(json.dumps(clean, ensure_ascii=True))
PY
}

set +e
echo "--- Sending global digest ---"
GLOBAL_OUTPUT="$("$VENV_DIR/bin/python" main.py send-news-digest --region global 2>&1)"
GLOBAL_EXIT=$?
printf "%s\n" "$GLOBAL_OUTPUT"

echo "--- Sending turkey digest ---"
TURKEY_OUTPUT="$("$VENV_DIR/bin/python" main.py send-news-digest --region turkey 2>&1)"
TURKEY_EXIT=$?
printf "%s\n" "$TURKEY_OUTPUT"
set -e

GLOBAL_SENT="$(extract_metric "Sent" "$GLOBAL_OUTPUT")"
GLOBAL_SKIPPED="$(extract_metric "Skipped" "$GLOBAL_OUTPUT")"
GLOBAL_FAILED="$(extract_metric "Failed" "$GLOBAL_OUTPUT")"

TURKEY_SENT="$(extract_metric "Sent" "$TURKEY_OUTPUT")"
TURKEY_SKIPPED="$(extract_metric "Skipped" "$TURKEY_OUTPUT")"
TURKEY_FAILED="$(extract_metric "Failed" "$TURKEY_OUTPUT")"

GLOBAL_SENT_N="$(to_int "$GLOBAL_SENT")"
GLOBAL_SKIPPED_N="$(to_int "$GLOBAL_SKIPPED")"
GLOBAL_FAILED_N="$(to_int "$GLOBAL_FAILED")"
TURKEY_SENT_N="$(to_int "$TURKEY_SENT")"
TURKEY_SKIPPED_N="$(to_int "$TURKEY_SKIPPED")"
TURKEY_FAILED_N="$(to_int "$TURKEY_FAILED")"

TOTAL_SENT="$((GLOBAL_SENT_N + TURKEY_SENT_N))"
TOTAL_SKIPPED="$((GLOBAL_SKIPPED_N + TURKEY_SKIPPED_N))"
TOTAL_FAILED="$((GLOBAL_FAILED_N + TURKEY_FAILED_N))"

SLACK_STATUS="success"
SLACK_TITLE="News digest delivery summary"
if [ "$GLOBAL_EXIT" -ne 0 ] || [ "$TURKEY_EXIT" -ne 0 ]; then
    SLACK_STATUS="failure"
    SLACK_TITLE="News digest delivery failed"
elif [ "$TOTAL_FAILED" -gt 0 ]; then
    SLACK_STATUS="warning"
    SLACK_TITLE="News digest delivery partial failures"
fi

SLACK_BODY="*Global:* sent=${GLOBAL_SENT_N} skipped=${GLOBAL_SKIPPED_N} failed=${GLOBAL_FAILED_N} (exit=${GLOBAL_EXIT})
*Turkey:* sent=${TURKEY_SENT_N} skipped=${TURKEY_SKIPPED_N} failed=${TURKEY_FAILED_N} (exit=${TURKEY_EXIT})
*Total:* sent=${TOTAL_SENT} skipped=${TOTAL_SKIPPED} failed=${TOTAL_FAILED}
*Log:* ${LOG_FILE}"

SLACK_CONTEXT_JSON="$(build_digest_context_json)"
SLACK_TITLE="$SLACK_TITLE" \
SLACK_STATUS="$SLACK_STATUS" \
SLACK_BODY="$SLACK_BODY" \
SLACK_CONTEXT_JSON="$SLACK_CONTEXT_JSON" \
python3 "$REPO_DIR/scripts/slack_notify.py" || true

if [ "$GLOBAL_EXIT" -ne 0 ] || [ "$TURKEY_EXIT" -ne 0 ]; then
    echo "ERROR: Digest send failed (global=$GLOBAL_EXIT, turkey=$TURKEY_EXIT)"
    exit 1
fi

echo "=== News Digest complete ==="
