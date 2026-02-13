#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if git -C "$SCRIPT_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
else
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT_DIR"

EVENT_NAME="${EVENT_NAME:-}"
BASE_SHA="${BASE_SHA:-}"
HEAD_SHA="${HEAD_SHA:-$(git rev-parse HEAD)}"

if [ -z "$BASE_SHA" ] || [ "$BASE_SHA" = "0000000000000000000000000000000000000000" ]; then
  if git rev-parse --verify "${HEAD_SHA}~1" >/dev/null 2>&1; then
    BASE_SHA="$(git rev-parse "${HEAD_SHA}~1")"
  else
    echo "INFO: Could not determine BASE_SHA (likely first commit). Skipping crontab/doc touch guard."
    exit 0
  fi
fi

if ! git cat-file -e "$BASE_SHA^{commit}" >/dev/null 2>&1; then
  echo "INFO: BASE_SHA not present locally. Fetching additional history..."
  git fetch --no-tags --prune --depth=200 origin +refs/heads/*:refs/remotes/origin/* >/dev/null 2>&1 || true
fi

if ! git cat-file -e "$BASE_SHA^{commit}" >/dev/null 2>&1; then
  echo "ERROR: BASE_SHA still unavailable after fetch. Cannot enforce crontab/doc touch guard."
  exit 1
fi

CHANGED_FILES="$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")"

if [ -z "$CHANGED_FILES" ]; then
  echo "OK: No changed files detected between $BASE_SHA and $HEAD_SHA"
  exit 0
fi

CRONTAB_PATH="infrastructure/vm-cron/crontab"
DOC_A="docs/OPERATING_MODEL.md"
DOC_B="docs/CHANGE_CONTROL.md"

if ! echo "$CHANGED_FILES" | grep -qx "$CRONTAB_PATH"; then
  echo "OK: $CRONTAB_PATH not changed."
  exit 0
fi

DOC_A_CHANGED=0
DOC_B_CHANGED=0

echo "$CHANGED_FILES" | grep -qx "$DOC_A" && DOC_A_CHANGED=1 || true
echo "$CHANGED_FILES" | grep -qx "$DOC_B" && DOC_B_CHANGED=1 || true

if [ "$DOC_A_CHANGED" -eq 0 ] && [ "$DOC_B_CHANGED" -eq 0 ]; then
  echo "ERROR: $CRONTAB_PATH changed without updating operational docs."
  echo
  echo "Required: update at least one of:"
  echo "- $DOC_A"
  echo "- $DOC_B"
  echo
  echo "Changed files:"
  echo "$CHANGED_FILES" | sed 's/^/- /'
  exit 1
fi

echo "OK: $CRONTAB_PATH changed and related docs were updated."
