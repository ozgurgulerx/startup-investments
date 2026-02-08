#!/bin/bash
# news-ingest.sh — Hourly news ingestion.
# Replaces: .github/workflows/news-ingest.yml (scheduled runs)
set -euo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"

echo "=== News Ingest ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Apply database migrations
bash "$REPO_DIR/infrastructure/vm-cron/jobs/apply-migrations.sh" news

# Run ingestion
cd "$REPO_DIR/packages/analysis"
"$VENV_DIR/bin/python" main.py ingest-news --lookback-hours 48

echo ""
echo "Daily brief model check (today):"
"$VENV_DIR/bin/python" - <<'PY'
import os
import sys

try:
    import asyncpg  # type: ignore
except Exception as e:
    print("  asyncpg missing:", e)
    sys.exit(0)

DATABASE_URL = os.getenv("DATABASE_URL") or ""
if not DATABASE_URL:
    print("  DATABASE_URL missing; skipping")
    sys.exit(0)

QUERY = """
SELECT region, COALESCE(stats_json->'daily_brief'->>'model', '') AS model
FROM news_daily_editions
WHERE edition_date = CURRENT_DATE
  AND region IN ('global','turkey')
ORDER BY region;
"""

async def main() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch(QUERY)
    finally:
        await conn.close()

    if not rows:
        print("  none")
        return
    for r in rows:
        region = r.get("region")
        model = (r.get("model") or "").strip() or "none"
        print(f"  {region}: {model}")

import asyncio
asyncio.run(main())
PY

echo "=== News Ingest complete ==="
