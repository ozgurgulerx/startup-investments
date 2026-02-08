#!/bin/bash
# verify.sh — Sanity checks for BuildAtlas VM cron setup.
#
# Run on the VM:
#   bash /opt/buildatlas/startup-analysis/infrastructure/vm-cron/verify.sh
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/buildatlas/startup-analysis}"
VENV_DIR="${VENV_DIR:-/opt/buildatlas/venv}"
ENV_FILE="${ENV_FILE:-/etc/buildatlas/.env}"
LOG_DIR="${LOG_DIR:-/var/log/buildatlas}"
EXPECTED_CRONTAB_FILE="$REPO_DIR/infrastructure/vm-cron/crontab"

FAIL=0

ok() { echo "OK   $*"; }
warn() { echo "WARN $*"; }
bad() { echo "FAIL $*"; FAIL=1; }

echo "=== BuildAtlas VM Cron Verify ==="
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# --- Files / dirs ---
if [ -d "$REPO_DIR" ]; then
  ok "Repo dir: $REPO_DIR"
else
  bad "Repo dir missing: $REPO_DIR"
fi

if [ -x "$REPO_DIR/infrastructure/vm-cron/lib/runner.sh" ]; then
  ok "Runner: infrastructure/vm-cron/lib/runner.sh"
else
  bad "Runner missing/not executable: $REPO_DIR/infrastructure/vm-cron/lib/runner.sh"
fi

if [ -d "$VENV_DIR" ] && [ -x "$VENV_DIR/bin/python" ]; then
  ok "Venv: $VENV_DIR"
else
  bad "Venv missing/not usable: $VENV_DIR (expected $VENV_DIR/bin/python)"
fi

if [ -f "$ENV_FILE" ]; then
  ok "Env file: $ENV_FILE"
else
  warn "Env file missing: $ENV_FILE (cron jobs may fail to authenticate)"
fi

mkdir -p "$LOG_DIR" 2>/dev/null || true
if [ -d "$LOG_DIR" ]; then
  ok "Log dir: $LOG_DIR"
else
  warn "Log dir missing: $LOG_DIR"
fi

echo ""

# --- Services ---
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet cron 2>/dev/null; then
    ok "cron service: active"
  else
    bad "cron service: NOT active (systemctl is-active cron)"
  fi
else
  warn "systemctl not available; cannot check cron service status"
fi

echo ""

# --- Crontab entries ---
if ! command -v crontab >/dev/null 2>&1; then
  bad "crontab command not found"
else
  CURRENT="$(crontab -l 2>/dev/null || true)"
  if [ -z "$CURRENT" ]; then
    bad "crontab is empty (no scheduled jobs installed)"
  else
    if echo "$CURRENT" | grep -q "BuildAtlas VM Cron Jobs"; then
      ok "crontab signature present"
    else
      bad "crontab signature missing (expected BuildAtlas VM Cron Jobs header)"
    fi

    # Required scheduled jobs (best-effort checks)
    REQUIRED=(
      "runner.sh keep-alive"
      "runner.sh news-ingest"
      "runner.sh crawl-frontier"
      "runner.sh news-digest"
      "runner.sh slack-summary"
      "runner.sh sync-data"
      "runner.sh code-update"
      "monitoring/heartbeat.sh"
    )
    for needle in "${REQUIRED[@]}"; do
      if echo "$CURRENT" | grep -q "$needle"; then
        ok "crontab contains: $needle"
      else
        bad "crontab missing: $needle"
      fi
    done

    # If the expected file exists, compare (cron-as-code)
    if [ -f "$EXPECTED_CRONTAB_FILE" ]; then
      if diff -q <(printf "%s\n" "$CURRENT") "$EXPECTED_CRONTAB_FILE" >/dev/null 2>&1; then
        ok "crontab matches repo file"
      else
        warn "crontab differs from repo file: $EXPECTED_CRONTAB_FILE"
        echo "     Fix: crontab $EXPECTED_CRONTAB_FILE"
      fi
    else
      warn "Expected crontab file missing in repo: $EXPECTED_CRONTAB_FILE"
    fi
  fi
fi

echo ""

# --- Tooling ---
if command -v az >/dev/null 2>&1; then ok "az: installed"; else warn "az: missing"; fi
if command -v kubectl >/dev/null 2>&1; then ok "kubectl: installed"; else warn "kubectl: missing"; fi
if command -v node >/dev/null 2>&1; then ok "node: $(node -v 2>/dev/null || true)"; else warn "node: missing"; fi
if command -v pnpm >/dev/null 2>&1; then ok "pnpm: $(pnpm -v 2>/dev/null || true)"; else warn "pnpm: missing"; fi

echo ""

if [ "$FAIL" -ne 0 ]; then
  echo "Result: FAIL"
  exit 1
fi
echo "Result: OK"
exit 0

