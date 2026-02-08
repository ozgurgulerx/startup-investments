#!/bin/bash
# slack-commit-notify.sh — Post Slack notifications for new commits on origin/main.
#
# Why this exists:
# - GitHub Actions workflows may be blocked (billing/spending limits).
# - VM cron can still notify Slack by polling the repo and posting via webhook.
#
# Env (from /etc/buildatlas/.env via runner.sh):
# - SLACK_WEBHOOK_URL (preferred) or SLACK_WEBHOOK
# - GITHUB_REPOSITORY (optional; runner.sh derives when missing)
#
# Optional env:
# - SLACK_COMMIT_NOTIFY_BRANCH (default: main)
# - SLACK_COMMIT_NOTIFY_MAX (default: 12)
set -euo pipefail

REPO_DIR="/opt/buildatlas/startup-analysis"

BRANCH="${SLACK_COMMIT_NOTIFY_BRANCH:-main}"
MAX_COMMITS="${SLACK_COMMIT_NOTIFY_MAX:-12}"
REMOTE_REF="origin/${BRANCH}"

if [ -z "${SLACK_WEBHOOK_URL:-${SLACK_WEBHOOK:-}}" ]; then
  # Keep silent when Slack isn't configured.
  exit 0
fi

cd "$REPO_DIR"

# Avoid racing code-update/sync-data git operations.
GIT_LOCK_FILE="/tmp/buildatlas-git.lock"
exec 201>"$GIT_LOCK_FILE"
if ! flock -w 20 201; then
  exit 0
fi

git fetch --quiet origin "$BRANCH" || exit 0

HEAD_SHA="$(git rev-parse "$REMOTE_REF")"

STATE_DIR="${BUILDATLAS_STATE_DIR:-/var/lib/buildatlas}"
if ! mkdir -p "$STATE_DIR" 2>/dev/null; then
  STATE_DIR="$REPO_DIR/.tmp"
  mkdir -p "$STATE_DIR" 2>/dev/null || STATE_DIR="/tmp"
fi
STATE_FILE="$STATE_DIR/slack-commit-notify.${BRANCH}.last"

LAST_SHA=""
if [ -f "$STATE_FILE" ]; then
  LAST_SHA="$(cat "$STATE_FILE" 2>/dev/null || true)"
fi

if [ -z "$LAST_SHA" ]; then
  # First run: don't backfill history. Start from current head.
  echo "$HEAD_SHA" > "$STATE_FILE" 2>/dev/null || true
  exit 0
fi

if ! git cat-file -e "${LAST_SHA}^{commit}" 2>/dev/null; then
  echo "$HEAD_SHA" > "$STATE_FILE" 2>/dev/null || true
  exit 0
fi

if [ "$LAST_SHA" = "$HEAD_SHA" ]; then
  exit 0
fi

mapfile -t NEW_SHAS < <(git rev-list --reverse "${LAST_SHA}..${REMOTE_REF}" || true)
if [ "${#NEW_SHAS[@]}" -eq 0 ]; then
  echo "$HEAD_SHA" > "$STATE_FILE" 2>/dev/null || true
  exit 0
fi

REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO" ]; then
  # Best effort fallback.
  REPO="$(git remote get-url origin 2>/dev/null | sed -E 's#(https://github.com/|git@github.com:)##; s#\\.git$##' || true)"
fi

COMPARE_URL=""
if [ -n "$REPO" ]; then
  if [ "${#NEW_SHAS[@]}" -gt 1 ]; then
    COMPARE_URL="https://github.com/${REPO}/compare/${LAST_SHA}...${HEAD_SHA}"
  else
    COMPARE_URL="https://github.com/${REPO}/commit/${HEAD_SHA}"
  fi
fi

TITLE="New commit(s) on ${BRANCH}"
BODY="*Repo:* \`${REPO:-unknown}\`\n*Branch:* \`${BRANCH}\`\n*Commits:* ${#NEW_SHAS[@]}\n"
BODY="${BODY}\n"

COUNT=0
for sha in "${NEW_SHAS[@]}"; do
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -gt "$MAX_COMMITS" ]; then
    break
  fi
  short="$(echo "$sha" | cut -c1-7)"
  subject="$(git log -1 --format=%s "$sha" 2>/dev/null || echo "")"
  author="$(git log -1 --format=%an "$sha" 2>/dev/null || echo "unknown")"
  url=""
  if [ -n "$REPO" ]; then
    url="https://github.com/${REPO}/commit/${sha}"
  fi
  if [ -n "$url" ]; then
    BODY="${BODY}- <${url}|\`${short}\`> ${subject} (${author})\n"
  else
    BODY="${BODY}- \`${short}\` ${subject} (${author})\n"
  fi
done

if [ "${#NEW_SHAS[@]}" -gt "$MAX_COMMITS" ]; then
  BODY="${BODY}- …and $((${#NEW_SHAS[@]} - MAX_COMMITS)) more\n"
fi

export SLACK_TITLE="$TITLE"
export SLACK_STATUS="info"
export SLACK_BODY="$(printf "%b" "$BODY")"
export SLACK_URL="${COMPARE_URL:-}"

python3 "$REPO_DIR/scripts/slack_notify.py"

# Only advance the cursor if Slack post succeeded.
echo "$HEAD_SHA" > "$STATE_FILE" 2>/dev/null || true
