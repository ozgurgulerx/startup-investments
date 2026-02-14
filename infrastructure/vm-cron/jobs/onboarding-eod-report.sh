#!/bin/bash
# onboarding-eod-report.sh — Post end-of-day onboarding/graph/news relationship report to Slack.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/buildatlas/startup-analysis}"
VENV_DIR="${VENV_DIR:-/opt/buildatlas/venv}"

cd "$REPO_DIR"

BODY="$("$VENV_DIR/bin/python" scripts/onboarding_eod_report.py --max-items 15 --slack-max-chars 3400)"
EMAIL_BODY="$("$VENV_DIR/bin/python" scripts/onboarding_eod_report.py --max-items 50 --slack-max-chars 20000)"

echo ""
echo "=== EOD report body ==="
echo "$BODY"
echo "=== /EOD report body ==="

SLACK_TITLE="EOD Onboarding/Graph/News Report (UTC $(date -u '+%Y-%m-%d'))" \
SLACK_STATUS="info" \
SLACK_BODY="$BODY" \
"$VENV_DIR/bin/python" "$REPO_DIR/scripts/slack_notify.py"

# Optional daily email delivery (best-effort). Uses the same Resend config as the daily ops summary:
# - RESEND_API_KEY + METRICS_REPORT_EMAIL_TO enable sending.
# - METRICS_REPORT_EMAIL_FROM overrides sender.
EMAIL_PREFIX="${ONBOARDING_EOD_REPORT_EMAIL_SUBJECT_PREFIX:-${METRICS_REPORT_EMAIL_SUBJECT_PREFIX:-}}"
if [ -n "$EMAIL_PREFIX" ] && [ "${EMAIL_PREFIX: -1}" != " " ]; then
  EMAIL_PREFIX="${EMAIL_PREFIX} "
fi
EMAIL_SUBJECT="${EMAIL_PREFIX}EOD Onboarding/Graph/News Report — $(date -u '+%Y-%m-%d') (UTC)"

echo ""
echo "=== EOD report email ==="
"$VENV_DIR/bin/python" scripts/send_onboarding_eod_report_email.py --subject "$EMAIL_SUBJECT" --body "$EMAIL_BODY" \
  || echo "EOD report email failed (non-fatal)"
echo "=== /EOD report email ==="
