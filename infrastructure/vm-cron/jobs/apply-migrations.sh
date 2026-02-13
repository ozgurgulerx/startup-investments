#!/bin/bash
# apply-migrations.sh — Shared database migration runner.
# Usage: apply-migrations.sh <migration-set>
# Sets: news, crawl, news-digest, startups, performance, research, benchmarks, all
set -uo pipefail

VENV_DIR="${VENV_DIR:-/opt/buildatlas/venv}"
REPO_DIR="${REPO_DIR:-/opt/buildatlas/startup-analysis}"
MIGRATION_SET="${1:-all}"

echo "Applying migrations (set: $MIGRATION_SET)..."

# Serialize DB migrations across cron jobs to avoid DDL deadlocks when multiple
# pipelines start at the same time (e.g. news-ingest + event-processor).
#
# Default lock location is repo-local (writable by the buildatlas user). /tmp can
# be affected by stale root-owned files in some environments.
MIGRATIONS_LOCK_FILE="${BUILDATLAS_MIGRATIONS_LOCK_FILE:-$REPO_DIR/.tmp/db-migrations.lock}"
MIGRATIONS_LOCK_WAIT_SECONDS="${BUILDATLAS_MIGRATIONS_LOCK_WAIT_SECONDS:-300}"
mkdir -p "$(dirname "$MIGRATIONS_LOCK_FILE")" 2>/dev/null || true
exec 210>"$MIGRATIONS_LOCK_FILE"
if ! flock -w "$MIGRATIONS_LOCK_WAIT_SECONDS" 210; then
    echo "SKIP: migrations lock busy ($MIGRATIONS_LOCK_FILE); another job may be applying migrations."
    exit 0
fi

# Single source of truth for migration sets lives in scripts/apply_migrations.py
"$VENV_DIR/bin/python" "$REPO_DIR/scripts/apply_migrations.py" "$MIGRATION_SET"

