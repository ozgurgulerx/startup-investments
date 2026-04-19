#!/usr/bin/env bash
# ecosystem-ingest.sh — weekly refresh of TR ecosystem memory (PR #4.8).
#
# Runs the KPMG quarterly PDFs, startups.watch blog posts, and a small
# set of high-signal YouTube channels through the ecosystem-memory
# distiller. Each call is incremental — content_hash on
# news_ecosystem_sources short-circuits unchanged documents before the
# LLM fires, so re-running is cheap.
#
# Schedule suggestion (crontab on vm-buildatlas-cron):
#   5 0 * * 1  /opt/buildatlas/infrastructure/vm-cron/jobs/ecosystem-ingest.sh
# i.e. Mondays 00:05 UTC, before the weekly brief runs.

set -euo pipefail

if [ -n "${BUILDATLAS_ENV_FILE:-}" ] && [ -f "${BUILDATLAS_ENV_FILE}" ]; then
    # shellcheck disable=SC1090
    set -a && . "${BUILDATLAS_ENV_FILE}" && set +a
elif [ -f /etc/buildatlas/.env ]; then
    set -a && . /etc/buildatlas/.env && set +a
fi

REPO_ROOT="${BUILDATLAS_REPO_ROOT:-/opt/buildatlas/startup-investments}"
VENV_DIR="${REPO_ROOT}/packages/analysis/venv"
MAIN_PY="${REPO_ROOT}/packages/analysis/main.py"

if [ ! -x "${VENV_DIR}/bin/python" ]; then
    echo "[ecosystem-ingest] venv missing at ${VENV_DIR}" >&2
    exit 1
fi

cd "${REPO_ROOT}/packages/analysis"

echo "--- Seeding curated facts + exclusions (idempotent) ---"
"${VENV_DIR}/bin/python" "${MAIN_PY}" seed-ecosystem-memory || {
    echo "[ecosystem-ingest] seed failed" >&2
    exit 2
}

echo "--- Ingesting KPMG reports ---"
"${VENV_DIR}/bin/python" "${MAIN_PY}" ingest-ecosystem --source kpmg || {
    echo "[ecosystem-ingest] kpmg ingest failed (non-fatal)" >&2
}

echo "--- Ingesting startups.watch blog ---"
"${VENV_DIR}/bin/python" "${MAIN_PY}" ingest-ecosystem --source startups-watch || {
    echo "[ecosystem-ingest] startups-watch ingest failed (non-fatal)" >&2
}

echo "--- Ingesting YouTube transcripts: startups.watch ---"
"${VENV_DIR}/bin/python" "${MAIN_PY}" ingest-ecosystem \
    --source youtube \
    --channel "https://www.youtube.com/@startupswatch" \
    --max-videos 3 || {
    echo "[ecosystem-ingest] startups.watch YouTube ingest failed (non-fatal)" >&2
}

echo "--- Ingesting YouTube transcripts: TRAI ---"
"${VENV_DIR}/bin/python" "${MAIN_PY}" ingest-ecosystem \
    --source youtube \
    --channel "https://www.youtube.com/@turkiyeyapayzekainisiyatifi" \
    --max-videos 3 || {
    echo "[ecosystem-ingest] TRAI YouTube ingest failed (non-fatal)" >&2
}

echo "--- Ingesting YouTube transcripts: İTÜ Çekirdek ---"
"${VENV_DIR}/bin/python" "${MAIN_PY}" ingest-ecosystem \
    --source youtube \
    --channel "https://www.youtube.com/@itucekirdek" \
    --max-videos 3 || {
    echo "[ecosystem-ingest] İTÜ Çekirdek YouTube ingest failed (non-fatal)" >&2
}

echo "--- Done ---"
