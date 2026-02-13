#!/bin/bash
# apply-migrations.sh — Shared database migration runner.
# Usage: apply-migrations.sh <migration-set>
# Sets: news, crawl, news-digest, startups, performance, research, benchmarks, all
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
        # Subscriber timezone support for digest delivery windows
        "027_subscriber_timezone.sql",
        # Email subscriptions: confirmation + region support + rate limits
        "017_email_confirmation_and_region.sql",
        "018_news_subscription_rate_limits.sql",
        # Topic research queue for automated deep-dive research
        "032_topic_research.sql",
        # Signal intelligence engine — event registry, pattern registry, signals, evidence
        "036_signal_intelligence_schema.sql",
        # Fix signal deduplication — unique indexes + count recompute
        "038_fix_signal_dedupe.sql",
        # Signal deep dives (occurrences, moves, deep dive versions, diffs)
        "050_signal_deep_dives.sql",
        # Event key discriminator — allows multiple events of same type per cluster
        "042_event_key_discriminator.sql",
        # Event-driven refresh jobs — boost frontier priority for startups with news events
        "043_startup_refresh_jobs.sql",
        # Event timeline effective_date column
        "043_effective_date.sql",
        # Startup merge infrastructure — adds onboarding_status (used by memory_gate.py)
        "046_startup_merge_infrastructure.sql",
        # Extend scoring_method CHECK to include editorial_postgate
        "047_editorial_scoring_method.sql",
        # End-to-end onboarding activation (attempt telemetry + deep_research_queue hardening)
        "058_onboarding_pipeline_activation.sql",
    ],
    "crawl": [
        "011_frontier_and_incremental_recrawl.sql",
        "016_crawl_replay_and_policy_feedback.sql",
        "043_startup_refresh_jobs.sql",
        "058_onboarding_pipeline_activation.sql",
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
        "027_subscriber_timezone.sql",
        # Signal deep dives (occurrences, moves, deep dive versions, diffs)
        "050_signal_deep_dives.sql",
        # Event timeline effective_date column
        "043_effective_date.sql",
        # Extend scoring_method CHECK to include editorial_postgate
        "047_editorial_scoring_method.sql",
    ],
    "startups": [
        "008_startup_analysis_data.sql",
        "010_add_constraints.sql",
        "019_startup_vertical_taxonomy_indexes.sql",
        "021_build_patterns_and_funding_indexes.sql",
        "022_startup_dataset_region.sql",
        # Startup merge infrastructure — adds onboarding_status (used by memory_gate.py)
        "046_startup_merge_infrastructure.sql",
        "058_onboarding_pipeline_activation.sql",
    ],
    "performance": [
        "015_performance_indexes.sql",
        "019_startup_vertical_taxonomy_indexes.sql",
        "021_build_patterns_and_funding_indexes.sql",
    ],
    "research": [
        "012_daily_news.sql",
        "032_topic_research.sql",
    ],
    "benchmarks": [
        "039_startup_state_snapshot.sql",
        "053_neighbors_benchmarks.sql",
        "054_investor_dna.sql",
        "056_benchmark_percentile_ranks.sql",
    ],
}

if migration_set == "all":
    files = sorted(set(f for s in SETS.values() for f in s))
else:
    files = SETS.get(migration_set, [])

base = Path("$REPO_DIR/database/migrations")

async def run():
    conn = await asyncpg.connect(db_url)
    failed = []
    try:
        for filename in files:
            path = base / filename
            if path.exists():
                try:
                    sql = path.read_text(encoding="utf-8")
                    await conn.execute(sql)
                    print(f"  Applied: {filename}")
                except Exception as e:
                    print(f"  FAILED: {filename}: {e}")
                    failed.append(filename)
            else:
                print(f"  Skipped (not found): {filename}")
    finally:
        await conn.close()
    if failed:
        print(f"\nWARNING: {len(failed)} migration(s) failed: {', '.join(failed)}")
        raise SystemExit(1)

asyncio.run(run())
PYEOF
