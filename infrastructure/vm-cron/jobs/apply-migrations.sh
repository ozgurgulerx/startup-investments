#!/bin/bash
# apply-migrations.sh — Shared database migration runner.
# Usage: apply-migrations.sh <migration-set>
# Sets: news, crawl, news-digest, startups, performance, all
set -uo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
MIGRATION_SET="${1:-all}"

echo "Applying migrations (set: $MIGRATION_SET)..."

"$VENV_DIR/bin/python" << PYEOF
import asyncio
import os
from pathlib import Path

import asyncpg

db_url = os.environ["DATABASE_URL"]
migration_set = "$MIGRATION_SET"

SETS = {
    "news": [
        "011_frontier_and_incremental_recrawl.sql",
        "012_daily_news.sql",
        "013_news_digest_and_llm_enrichment.sql",
        "014_news_llm_scoring_and_classification.sql",
        # Regional editions (number may vary across branches; apply whichever exists)
        "019_news_editions_by_region.sql",
        "020_news_editions_by_region.sql",
        # Region-aware clusters (prevents global representative leakage into TR editions)
        "030_news_clusters_by_region.sql",
        # Memory-gated editorial intelligence system (Phase 1)
        "023_memory_system.sql",
        "024_regional_memory.sql",
        "025_periodic_briefs.sql",
        # Phase 2: Refinery enhancements (scoring, gating, pattern/GTM tables)
        "026_refinery_enhancements.sql",
        # Vector embeddings for semantic search (requires pgvector extension)
        "028_pgvector_embeddings.sql",
    ],
    "crawl": [
        "011_frontier_and_incremental_recrawl.sql",
        "016_crawl_replay_and_policy_feedback.sql",
    ],
    "news-digest": [
        "012_daily_news.sql",
        "013_news_digest_and_llm_enrichment.sql",
        "014_news_llm_scoring_and_classification.sql",
        "019_news_editions_by_region.sql",
        "020_news_editions_by_region.sql",
        "030_news_clusters_by_region.sql",
        "023_memory_system.sql",
        "024_regional_memory.sql",
        "025_periodic_briefs.sql",
        "026_refinery_enhancements.sql",
        "028_pgvector_embeddings.sql",
        "017_email_confirmation_and_region.sql",
        "018_news_subscription_rate_limits.sql",
    ],
    "startups": [
        "008_startup_analysis_data.sql",
        "010_add_constraints.sql",
        "019_startup_vertical_taxonomy_indexes.sql",
        "021_build_patterns_and_funding_indexes.sql",
        "022_startup_dataset_region.sql",
    ],
    "performance": [
        "015_performance_indexes.sql",
        "019_startup_vertical_taxonomy_indexes.sql",
        "021_build_patterns_and_funding_indexes.sql",
    ],
}

if migration_set == "all":
    files = sorted(set(f for s in SETS.values() for f in s))
else:
    files = SETS.get(migration_set, [])

base = Path("$REPO_DIR/database/migrations")

async def run():
    conn = await asyncpg.connect(db_url)
    try:
        for filename in files:
            path = base / filename
            if path.exists():
                sql = path.read_text(encoding="utf-8")
                await conn.execute(sql)
                print(f"  Applied: {filename}")
            else:
                print(f"  Skipped (not found): {filename}")
    finally:
        await conn.close()

asyncio.run(run())
PYEOF
