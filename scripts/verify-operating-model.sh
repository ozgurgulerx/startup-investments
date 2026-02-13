#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRONTAB_FILE="$ROOT_DIR/infrastructure/vm-cron/crontab"
DOC_FILE="$ROOT_DIR/docs/OPERATING_MODEL.md"

if [ ! -f "$CRONTAB_FILE" ]; then
  echo "ERROR: Missing crontab file: $CRONTAB_FILE"
  exit 1
fi

if [ ! -f "$DOC_FILE" ]; then
  echo "ERROR: Missing operating model doc: $DOC_FILE"
  exit 1
fi

CRON_JOBS_FILE="$(mktemp)"
DOC_JOBS_FILE="$(mktemp)"
DOC_JOBS_FILTERED_FILE="$(mktemp)"
trap 'rm -f "$CRON_JOBS_FILE" "$DOC_JOBS_FILE" "$DOC_JOBS_FILTERED_FILE"' EXIT

# Extract scheduled jobs executed via runner.sh.
awk '
  $0 !~ /^#/ && $0 ~ /runner\.sh/ {
    for (i = 1; i <= NF; i++) {
      if ($i ~ /runner\.sh$/) {
        print $(i + 1)
      }
    }
  }
' "$CRONTAB_FILE" > "$CRON_JOBS_FILE"

# Add heartbeat (direct invocation, not via runner.sh).
if awk '$0 !~ /^#/ && $0 ~ /heartbeat\.sh/' "$CRONTAB_FILE" >/dev/null; then
  echo "heartbeat" >> "$CRON_JOBS_FILE"
fi

sort -u "$CRON_JOBS_FILE" -o "$CRON_JOBS_FILE"

# Extract jobs documented in the cron inventory section.
awk '
  /^## 8\) Cron Schedule Inventory \(UTC\)/ {in_section = 1; next}
  /^## 9\) Pipeline Maps/ {in_section = 0}
  in_section && /^\| `[^`]+` \|/ {
    line = $0
    sub(/^\| `/, "", line)
    split(line, parts, "`")
    print parts[1]
  }
' "$DOC_FILE" | sort -u > "$DOC_JOBS_FILE"

# Keep only scheduled job names for strict comparison.
# `frontend-deploy` and `backend-deploy` are intentionally documented as triggered jobs.
grep -Ev '^(frontend-deploy|backend-deploy)$' "$DOC_JOBS_FILE" > "$DOC_JOBS_FILTERED_FILE" || true

MISSING_FROM_DOC="$(comm -23 "$CRON_JOBS_FILE" "$DOC_JOBS_FILTERED_FILE" || true)"
EXTRA_IN_DOC="$(comm -13 "$CRON_JOBS_FILE" "$DOC_JOBS_FILTERED_FILE" || true)"

if [ -n "$MISSING_FROM_DOC" ] || [ -n "$EXTRA_IN_DOC" ]; then
  echo "ERROR: docs/OPERATING_MODEL.md cron inventory is out of sync with infrastructure/vm-cron/crontab"
  if [ -n "$MISSING_FROM_DOC" ]; then
    echo
    echo "Jobs in crontab but missing from docs:"
    echo "$MISSING_FROM_DOC" | sed 's/^/- /'
  fi
  if [ -n "$EXTRA_IN_DOC" ]; then
    echo
    echo "Jobs in docs but not scheduled in crontab:"
    echo "$EXTRA_IN_DOC" | sed 's/^/- /'
  fi
  exit 1
fi

echo "OK: docs/OPERATING_MODEL.md cron inventory matches infrastructure/vm-cron/crontab"
