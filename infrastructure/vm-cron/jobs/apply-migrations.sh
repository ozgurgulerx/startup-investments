#!/bin/bash
# apply-migrations.sh — Shared database migration runner.
# Usage: apply-migrations.sh <migration-set>
# Sets: news, crawl, news-digest, startups, performance, research, benchmarks, all
set -uo pipefail

VENV_DIR="/opt/buildatlas/venv"
REPO_DIR="/opt/buildatlas/startup-analysis"
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

"$VENV_DIR/bin/python" << PYEOF
import asyncio
import os
import random
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
        # Per-source health stats used by ingest + monitoring (total_fetches, failures, alerts)
        "031_source_health_monitoring.sql",
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
        # Queryable state snapshots + architecture history (required by signal aggregation + delta generator)
        "039_startup_state_snapshot.sql",
        "040_architecture_history.sql",
        # Signal follows + update stream (needed for signal updates feed + delta generator signal_spike detector)
        "048_signal_follows_and_notifications.sql",
        "049_signal_updates.sql",
        # Signal deep dives (occurrences, moves, deep dive versions, diffs)
        "050_signal_deep_dives.sql",
        # Delta events (movers/changefeed) + watchlist intelligence tables
        "051_delta_events.sql",
        # Per-user movers feed state (unread counts + mark-as-seen)
        "052_user_feed_state.sql",
        "055_watchlist_intelligence.sql",
        "065_watchlist_intelligence_dedupe.sql",
        # Funding rounds enrichment source marker used by event extractor (source='news_event')
        "044_funding_source.sql",
        # Intel-first enrichment fields on news_clusters (ba_title, ba_bullets, etc.)
        "057_intel_first_enrichment.sql",
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
        # Onboarding trace events + human context injection
        "063_onboarding_trace_and_context.sql",
        # Fix: dedupe_key unique index inference for ON CONFLICT
        "064_fix_onboarding_trace_dedupe_index.sql",
        # X/Twitter trend intelligence + automated posting queue
        "061_x_social_automation.sql",
        # Community features (threads, polls, shared watchlists, notification hygiene)
        "062_community_features.sql",
        # Signals recommendations feedback persistence (dismissals + domain preferences)
        "066_signals_reco_feedback.sql",
    ],
    "crawl": [
        "011_frontier_and_incremental_recrawl.sql",
        "016_crawl_replay_and_policy_feedback.sql",
        "043_startup_refresh_jobs.sql",
        "058_onboarding_pipeline_activation.sql",
        "063_onboarding_trace_and_context.sql",
        "064_fix_onboarding_trace_dedupe_index.sql",
    ],
    "news-digest": [
        "012_daily_news.sql",
        "013_news_digest_and_llm_enrichment.sql",
        "014_news_llm_scoring_and_classification.sql",
        "031_source_health_monitoring.sql",
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
        # Queryable state snapshots + architecture history (required by signal aggregation + delta generator)
        "039_startup_state_snapshot.sql",
        "040_architecture_history.sql",
        # Signal follows + update stream (needed for signal updates feed + delta generator signal_spike detector)
        "048_signal_follows_and_notifications.sql",
        "049_signal_updates.sql",
        # Signal deep dives (occurrences, moves, deep dive versions, diffs)
        "050_signal_deep_dives.sql",
        # Delta events (movers/changefeed) + watchlist intelligence tables
        "051_delta_events.sql",
        # Signals recommendations feedback persistence (dismissals + domain preferences)
        "066_signals_reco_feedback.sql",
        # Per-user movers feed state (unread counts + mark-as-seen)
        "052_user_feed_state.sql",
        "055_watchlist_intelligence.sql",
        "065_watchlist_intelligence_dedupe.sql",
        "044_funding_source.sql",
        # Intel-first enrichment fields on news_clusters (ba_title, ba_bullets, etc.)
        "057_intel_first_enrichment.sql",
        # Event timeline effective_date column
        "043_effective_date.sql",
        # Extend scoring_method CHECK to include editorial_postgate
        "047_editorial_scoring_method.sql",
        # X/Twitter trend intelligence + automated posting queue
        "061_x_social_automation.sql",
        # Community features (threads, polls, shared watchlists, notification hygiene)
        "062_community_features.sql",
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
        "063_onboarding_trace_and_context.sql",
        "064_fix_onboarding_trace_dedupe_index.sql",
        # Capital graph + founder normalization
        "059_capital_graph_founders.sql",
        # Optional graph extension (AGE) with graceful fallback
        "060_graph_extension_optional.sql",
        # Community features (threads, polls, shared watchlists, notification hygiene)
        "062_community_features.sql",
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
        "059_capital_graph_founders.sql",
        "060_graph_extension_optional.sql",
    ],
}

if migration_set == "all":
    files = sorted(set(f for s in SETS.values() for f in s))
else:
    files = SETS.get(migration_set, [])

base = Path("$REPO_DIR/database/migrations")

TRANSIENT_SQLSTATES = {
    # 40P01: deadlock_detected
    "40P01",
    # 55P03: lock_not_available
    "55P03",
}


def is_transient_ddl_error(exc: Exception) -> bool:
    sqlstate = str(getattr(exc, "sqlstate", "") or "").strip()
    if sqlstate in TRANSIENT_SQLSTATES:
        return True
    msg = str(exc).lower()
    return (
        "deadlock detected" in msg
        or "could not obtain lock" in msg
        or "canceling statement due to lock timeout" in msg
    )


async def run():
    conn = await asyncpg.connect(db_url)
    failed = []
    try:
        for filename in files:
            path = base / filename
            if path.exists():
                try:
                    sql = path.read_text(encoding="utf-8")
                    # DDL can deadlock if another runner (e.g. GH Actions backup) is
                    # applying migrations at the same time. Retry a few times with
                    # backoff to avoid spurious cron failures.
                    max_attempts = 5
                    for attempt in range(1, max_attempts + 1):
                        try:
                            await conn.execute(sql)
                            print(f"  Applied: {filename}")
                            break
                        except Exception as e:
                            if is_transient_ddl_error(e) and attempt < max_attempts:
                                delay = (0.5 * (2 ** (attempt - 1))) + (random.random() * 0.25)
                                print(f"  RETRY: {filename} (attempt {attempt}/{max_attempts}) after {delay:.2f}s: {e}")
                                await asyncio.sleep(delay)
                                continue
                            raise
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
