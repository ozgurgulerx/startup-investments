#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRONJOBS_FILE="$ROOT_DIR/infrastructure/kubernetes/pipelines-cronjobs.yaml"
DOC_FILE="$ROOT_DIR/docs/OPERATING_MODEL.md"

if [ ! -f "$CRONJOBS_FILE" ]; then
  echo "ERROR: Missing pipelines cronjobs file: $CRONJOBS_FILE"
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

python3 - "$CRONJOBS_FILE" > "$CRON_JOBS_FILE" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
docs = path.read_text(encoding="utf-8").split("\n---\n")
for doc in docs:
    lines = doc.splitlines()
    if "kind: CronJob" not in lines:
        continue
    in_metadata = False
    for line in lines:
        if line.startswith("metadata:"):
            in_metadata = True
            continue
        if in_metadata and line.startswith("  name: "):
            print(line.split("  name: ", 1)[1].strip().strip('"'))
            break
PY

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

cp "$DOC_JOBS_FILE" "$DOC_JOBS_FILTERED_FILE"

MISSING_FROM_DOC="$(comm -23 "$CRON_JOBS_FILE" "$DOC_JOBS_FILTERED_FILE" || true)"
EXTRA_IN_DOC="$(comm -13 "$CRON_JOBS_FILE" "$DOC_JOBS_FILTERED_FILE" || true)"

if [ -n "$MISSING_FROM_DOC" ] || [ -n "$EXTRA_IN_DOC" ]; then
  echo "ERROR: docs/OPERATING_MODEL.md cron inventory is out of sync with infrastructure/kubernetes/pipelines-cronjobs.yaml"
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

echo "OK: docs/OPERATING_MODEL.md cron inventory matches infrastructure/kubernetes/pipelines-cronjobs.yaml"
python3 "$ROOT_DIR/scripts/verify_pipelines_cronjobs.py"
