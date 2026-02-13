#!/bin/bash
# release-reconciler.sh — Track desired vs live commit SHA for web/api and post Slack updates.
#
# This job compares:
# - Desired SHA: latest origin/<branch>
# - Frontend live SHA: `ba-build-sha` meta tag from public site
# - Backend live SHA: `build_sha` field from API /health response
#
# It posts Slack on:
# - State changes (new pending or resolved)
# - Persistent drift reminders
#
# Run via:
#   runner.sh release-reconciler 5 .../jobs/release-reconciler.sh
set -uo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"
STATE_DIR_DEFAULT="/var/lib/buildatlas"
STATE_FILE_BASENAME="release-reconciler.state"
GIT_LOCK_FILE="/tmp/buildatlas-git.lock"

BRANCH="${RELEASE_RECONCILE_BRANCH:-main}"
DESIRED_REF="origin/${BRANCH}"
FRONTEND_URL="${RELEASE_RECONCILE_FRONTEND_URL:-${PUBLIC_BASE_URL:-https://buildatlas.net}}"
API_HEALTH_URL="${RELEASE_RECONCILE_API_HEALTH_URL:-${API_URL:-https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net}/health}"
ALERT_AFTER_MINUTES="${RELEASE_RECONCILE_ALERT_AFTER_MINUTES:-20}"
REMINDER_MINUTES="${RELEASE_RECONCILE_REMINDER_MINUTES:-60}"

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

resolve_state_dir() {
    local state_dir="${BUILDATLAS_STATE_DIR:-$STATE_DIR_DEFAULT}"
    if mkdir -p "$state_dir" 2>/dev/null; then
        echo "$state_dir"
        return 0
    fi
    state_dir="$REPO_DIR/.tmp"
    if mkdir -p "$state_dir" 2>/dev/null; then
        echo "$state_dir"
        return 0
    fi
    echo "/tmp"
}

normalize_bool() {
    case "${1:-}" in
        true|1|yes|on) echo "true" ;;
        *) echo "false" ;;
    esac
}

sha_matches() {
    local desired="${1:-}"
    local live="${2:-}"
    desired="$(echo "$desired" | tr '[:upper:]' '[:lower:]')"
    live="$(echo "$live" | tr '[:upper:]' '[:lower:]')"
    if [ -z "$desired" ] || [ -z "$live" ]; then
        return 1
    fi
    if [ "$desired" = "$live" ]; then
        return 0
    fi
    case "$desired" in
        "$live"*) return 0 ;;
    esac
    case "$live" in
        "$desired"*) return 0 ;;
    esac
    return 1
}

extract_frontend_live_sha() {
    local html="$1"
    printf "%s" "$html" \
        | grep -o 'ba-build-sha" content="[0-9A-Fa-f]\{7,40\}"' \
        | sed -E 's/.*content="([0-9A-Fa-f]+)"/\1/' \
        | head -1
}

extract_backend_live_sha() {
    local json_payload="$1"
    PAYLOAD="$json_payload" python3 - <<'PY'
import json
import os

raw = os.environ.get("PAYLOAD", "")
try:
    data = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)

sha = data.get("build_sha") or data.get("sha") or ""
print(str(sha).strip())
PY
}

pending_commit_count() {
    local live_sha="${1:-}"
    if [ -z "$live_sha" ]; then
        echo ""
        return 0
    fi
    if ! git -C "$REPO_DIR" cat-file -e "${live_sha}^{commit}" 2>/dev/null; then
        echo ""
        return 0
    fi
    git -C "$REPO_DIR" rev-list --count "${live_sha}..${DESIRED_REF}" 2>/dev/null || echo ""
}

build_context_json() {
    CTX_BRANCH="$BRANCH" \
    CTX_DESIRED="$DESIRED_SHA" \
    CTX_DESIRED_FULL="$DESIRED_FULL_SHA" \
    CTX_FRONTEND="$FRONTEND_LIVE_SHA" \
    CTX_BACKEND="$BACKEND_LIVE_SHA" \
    CTX_FRONTEND_SYNC="$FRONTEND_IN_SYNC" \
    CTX_BACKEND_SYNC="$BACKEND_IN_SYNC" \
    CTX_FRONTEND_AGE="$FRONTEND_AGE_MIN" \
    CTX_BACKEND_AGE="$BACKEND_AGE_MIN" \
    CTX_FRONTEND_PENDING="$FRONTEND_PENDING_COMMITS" \
    CTX_BACKEND_PENDING="$BACKEND_PENDING_COMMITS" \
    CTX_STATUS_KEY="$STATUS_KEY" \
    python3 - <<'PY'
import json
import os

payload = {
    "event_type": "release_reconcile",
    "branch": os.environ.get("CTX_BRANCH", ""),
    "desired_sha": os.environ.get("CTX_DESIRED", ""),
    "desired_sha_full": os.environ.get("CTX_DESIRED_FULL", ""),
    "frontend_live_sha": os.environ.get("CTX_FRONTEND", ""),
    "backend_live_sha": os.environ.get("CTX_BACKEND", ""),
    "frontend_in_sync": os.environ.get("CTX_FRONTEND_SYNC", ""),
    "backend_in_sync": os.environ.get("CTX_BACKEND_SYNC", ""),
    "frontend_mismatch_age_min": os.environ.get("CTX_FRONTEND_AGE", ""),
    "backend_mismatch_age_min": os.environ.get("CTX_BACKEND_AGE", ""),
    "frontend_pending_commits": os.environ.get("CTX_FRONTEND_PENDING", ""),
    "backend_pending_commits": os.environ.get("CTX_BACKEND_PENDING", ""),
    "status_key": os.environ.get("CTX_STATUS_KEY", ""),
}
clean = {k: v for k, v in payload.items() if v not in ("", None)}
print(json.dumps(clean, ensure_ascii=True))
PY
}

format_component_line() {
    local label="$1"
    local live_sha="$2"
    local in_sync="$3"
    local pending="$4"
    local age="$5"

    if [ "$in_sync" = "true" ]; then
        echo "- *${label}:* \`${live_sha:-unknown}\` (in sync)"
        return 0
    fi

    local detail_parts=()
    if [ -n "$pending" ]; then
        detail_parts+=("${pending} commit(s) behind")
    else
        detail_parts+=("behind")
    fi
    if [ -n "$age" ]; then
        detail_parts+=("${age}m")
    fi
    local detail
    detail="$(IFS=', '; echo "${detail_parts[*]}")"

    echo "- *${label}:* \`${live_sha:-unknown}\` (${detail})"
}

STATE_DIR="$(resolve_state_dir)"
STATE_FILE="${STATE_DIR}/${STATE_FILE_BASENAME}"
NOW_EPOCH="$(date +%s)"

# State defaults
LAST_STATUS_KEY=""
LAST_ALERT_EPOCH="0"
FRONTEND_MISMATCH_SINCE=""
BACKEND_MISMATCH_SINCE=""
STATE_DESIRED_FULL_SHA=""

if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE" || true
fi

cd "$REPO_DIR"

# Keep fetch serialized with other git jobs.
exec 201>"$GIT_LOCK_FILE"
if flock -w 20 201; then
    git fetch --quiet origin "$BRANCH" || true
fi
exec 201>&-

DESIRED_FULL_SHA="$(git -C "$REPO_DIR" rev-parse "$DESIRED_REF" 2>/dev/null || true)"
DESIRED_SHA="$(git -C "$REPO_DIR" rev-parse --short "$DESIRED_REF" 2>/dev/null || true)"

if [ -z "$DESIRED_FULL_SHA" ]; then
    echo "ERROR: Could not resolve desired SHA from ${DESIRED_REF}"
    exit 1
fi

FRONTEND_HTML="$(curl -fsS --max-time 15 -H 'Cache-Control: no-cache' "${FRONTEND_URL}/?release_check=${NOW_EPOCH}" 2>/dev/null || true)"
FRONTEND_LIVE_SHA="$(extract_frontend_live_sha "$FRONTEND_HTML")"

BACKEND_HEALTH_JSON="$(curl -fsS --max-time 15 "$API_HEALTH_URL" 2>/dev/null || true)"
BACKEND_LIVE_SHA="$(extract_backend_live_sha "$BACKEND_HEALTH_JSON")"

FRONTEND_IN_SYNC="false"
BACKEND_IN_SYNC="false"
if sha_matches "$DESIRED_FULL_SHA" "$FRONTEND_LIVE_SHA"; then
    FRONTEND_IN_SYNC="true"
fi
if sha_matches "$DESIRED_FULL_SHA" "$BACKEND_LIVE_SHA"; then
    BACKEND_IN_SYNC="true"
fi

# If desired SHA changed, reset mismatch ages for currently-behind components.
if [ -n "${STATE_DESIRED_FULL_SHA:-}" ] && [ "$STATE_DESIRED_FULL_SHA" != "$DESIRED_FULL_SHA" ]; then
    if [ "$FRONTEND_IN_SYNC" != "true" ]; then
        FRONTEND_MISMATCH_SINCE="$NOW_EPOCH"
    fi
    if [ "$BACKEND_IN_SYNC" != "true" ]; then
        BACKEND_MISMATCH_SINCE="$NOW_EPOCH"
    fi
fi

if [ "$FRONTEND_IN_SYNC" = "true" ]; then
    FRONTEND_MISMATCH_SINCE=""
else
    if [ -z "${FRONTEND_MISMATCH_SINCE:-}" ]; then
        FRONTEND_MISMATCH_SINCE="$NOW_EPOCH"
    fi
fi

if [ "$BACKEND_IN_SYNC" = "true" ]; then
    BACKEND_MISMATCH_SINCE=""
else
    if [ -z "${BACKEND_MISMATCH_SINCE:-}" ]; then
        BACKEND_MISMATCH_SINCE="$NOW_EPOCH"
    fi
fi

FRONTEND_AGE_MIN=""
BACKEND_AGE_MIN=""
if [ -n "$FRONTEND_MISMATCH_SINCE" ]; then
    FRONTEND_AGE_MIN="$(( (NOW_EPOCH - FRONTEND_MISMATCH_SINCE) / 60 ))"
fi
if [ -n "$BACKEND_MISMATCH_SINCE" ]; then
    BACKEND_AGE_MIN="$(( (NOW_EPOCH - BACKEND_MISMATCH_SINCE) / 60 ))"
fi

FRONTEND_PENDING_COMMITS="$(pending_commit_count "$FRONTEND_LIVE_SHA")"
BACKEND_PENDING_COMMITS="$(pending_commit_count "$BACKEND_LIVE_SHA")"

REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO" ]; then
    REPO="$(derive_github_repository || true)"
fi

PENDING_COMPONENTS=0
if [ "$FRONTEND_IN_SYNC" != "true" ]; then PENDING_COMPONENTS=$((PENDING_COMPONENTS + 1)); fi
if [ "$BACKEND_IN_SYNC" != "true" ]; then PENDING_COMPONENTS=$((PENDING_COMPONENTS + 1)); fi

FRONTEND_SYNC_BOOL="$(normalize_bool "$FRONTEND_IN_SYNC")"
BACKEND_SYNC_BOOL="$(normalize_bool "$BACKEND_IN_SYNC")"

STATUS_KEY="${DESIRED_SHA}|${FRONTEND_LIVE_SHA:-unknown}|${BACKEND_LIVE_SHA:-unknown}|${FRONTEND_SYNC_BOOL}|${BACKEND_SYNC_BOOL}"
NEEDS_POST="false"

if [ "$STATUS_KEY" != "${LAST_STATUS_KEY:-}" ]; then
    NEEDS_POST="true"
fi

MAX_AGE_MIN=0
if [ -n "$FRONTEND_AGE_MIN" ] && [ "$FRONTEND_AGE_MIN" -gt "$MAX_AGE_MIN" ] 2>/dev/null; then
    MAX_AGE_MIN="$FRONTEND_AGE_MIN"
fi
if [ -n "$BACKEND_AGE_MIN" ] && [ "$BACKEND_AGE_MIN" -gt "$MAX_AGE_MIN" ] 2>/dev/null; then
    MAX_AGE_MIN="$BACKEND_AGE_MIN"
fi

if [ "$NEEDS_POST" != "true" ] && [ "$PENDING_COMPONENTS" -gt 0 ]; then
    ALERT_AFTER_SEC=$((ALERT_AFTER_MINUTES * 60))
    REMINDER_SEC=$((REMINDER_MINUTES * 60))
    ELAPSED_SINCE_ALERT=$((NOW_EPOCH - ${LAST_ALERT_EPOCH:-0}))
    if [ "$MAX_AGE_MIN" -ge "$ALERT_AFTER_MINUTES" ] && [ "$ELAPSED_SINCE_ALERT" -ge "$REMINDER_SEC" ]; then
        NEEDS_POST="true"
    fi
fi

if [ "$NEEDS_POST" = "true" ]; then
    if [ "$PENDING_COMPONENTS" -eq 0 ]; then
        SLACK_TITLE="Release status: all live"
        SLACK_STATUS="success"
    else
        SLACK_TITLE="Release pending: ${PENDING_COMPONENTS} component(s) behind"
        SLACK_STATUS="warning"
    fi

    BODY_LINES=()
    BODY_LINES+=("*Desired (${BRANCH}):* \`${DESIRED_SHA}\`")
    BODY_LINES+=("$(format_component_line "Frontend" "$FRONTEND_LIVE_SHA" "$FRONTEND_SYNC_BOOL" "$FRONTEND_PENDING_COMMITS" "$FRONTEND_AGE_MIN")")
    BODY_LINES+=("$(format_component_line "Backend" "$BACKEND_LIVE_SHA" "$BACKEND_SYNC_BOOL" "$BACKEND_PENDING_COMMITS" "$BACKEND_AGE_MIN")")
    BODY_LINES+=("")
    BODY_LINES+=("*Frontend URL:* ${FRONTEND_URL}")
    BODY_LINES+=("*API health URL:* ${API_HEALTH_URL}")
    BODY_LINES+=("_Checked: $(date -u '+%Y-%m-%d %H:%M UTC')_")

    SLACK_URL=""
    if [ -n "$REPO" ]; then
        BASE_GH_URL="https://github.com/${REPO}"
        SLACK_URL="${BASE_GH_URL}/commits/${BRANCH}"
        if [ "$FRONTEND_SYNC_BOOL" != "true" ] && [ -n "$FRONTEND_LIVE_SHA" ] && git -C "$REPO_DIR" cat-file -e "${FRONTEND_LIVE_SHA}^{commit}" 2>/dev/null; then
            SLACK_URL="${BASE_GH_URL}/compare/${FRONTEND_LIVE_SHA}...${DESIRED_FULL_SHA}"
        elif [ "$BACKEND_SYNC_BOOL" != "true" ] && [ -n "$BACKEND_LIVE_SHA" ] && git -C "$REPO_DIR" cat-file -e "${BACKEND_LIVE_SHA}^{commit}" 2>/dev/null; then
            SLACK_URL="${BASE_GH_URL}/compare/${BACKEND_LIVE_SHA}...${DESIRED_FULL_SHA}"
        fi
    fi

    SLACK_CONTEXT_JSON="$(build_context_json)"
    SLACK_BODY="$(printf "%s\n" "${BODY_LINES[@]}")"
    SLACK_TITLE="$SLACK_TITLE" \
    SLACK_STATUS="$SLACK_STATUS" \
    SLACK_BODY="$SLACK_BODY" \
    SLACK_URL="$SLACK_URL" \
    SLACK_CONTEXT_JSON="$SLACK_CONTEXT_JSON" \
    python3 "$REPO_DIR/scripts/slack_notify.py" || true

    LAST_ALERT_EPOCH="$NOW_EPOCH"
fi

TMP_STATE="${STATE_FILE}.tmp"
{
    printf 'LAST_STATUS_KEY=%q\n' "$STATUS_KEY"
    printf 'LAST_ALERT_EPOCH=%q\n' "$LAST_ALERT_EPOCH"
    printf 'FRONTEND_MISMATCH_SINCE=%q\n' "${FRONTEND_MISMATCH_SINCE:-}"
    printf 'BACKEND_MISMATCH_SINCE=%q\n' "${BACKEND_MISMATCH_SINCE:-}"
    printf 'STATE_DESIRED_FULL_SHA=%q\n' "$DESIRED_FULL_SHA"
} > "$TMP_STATE"
mv "$TMP_STATE" "$STATE_FILE"

echo "Release reconcile complete: desired=${DESIRED_SHA} frontend=${FRONTEND_LIVE_SHA:-unknown} backend=${BACKEND_LIVE_SHA:-unknown} pending=${PENDING_COMPONENTS}"
exit 0
