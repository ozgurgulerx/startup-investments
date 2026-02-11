# News Pipeline & Memory Gate

The news pipeline (`packages/analysis/src/automation/news_ingest.py`) runs hourly via VM cron, ingesting from 45+ sources, deduplicating into story clusters, and producing daily editions with LLM enrichment.

## Pipeline Flow

```
Sources → collect → cluster → MEMORY GATE → LLM enrich → persist → edition
                                   │
                         ┌─────────┴──────────┐
                         │  1. Entity linking   │  Link to known startups/investors
                         │  2. Fact extraction   │  Heuristic regex (funding, M&A, launch)
                         │  3. Memory diff       │  new_fact / confirmation / contradiction
                         │  4. Novelty scoring   │  (Phase 3: 4-dimension rubric)
                         │  5. Gating decision   │  (Phase 3: publish/watchlist/accumulate/drop)
                         └──────────────────────┘
```

## Expected Impact

- ~60% of clusters are redundant rehashes; memory gate routes to accumulate/drop
- LLM enrichment cost drops ~60-75% by only enriching the publish tier
- Entity facts build a structured knowledge base of startup claims over time
- Contradiction detection surfaces genuinely newsworthy updates

## Region-Aware Processing

Turkey memory reads global+turkey facts (one-way merge); global reads only global. Turkish-language regex patterns (milyon dolar, seri A, liderliğinde, satın al) applied for `region="turkey"`. Memory gate runs per-region AFTER turkey cluster filtering.

**Turkey sources (9 total):** Webrazzi, Egirisim (trusted RSS), GNews Turkey, NewsAPI Turkey (API aggregators), FounderN, Swipeline, N24 Business, Daily Sabah Tech (English), Startups.watch (Medium).

Turkey items go through a two-stage filter:
1. Fast heuristic pre-filter for noise exclusion
2. `gpt-4o-mini` batch classification for AI/startup relevance (~$2-3/month)
3. Fallback: keyword heuristic if LLM unavailable

## Periodic Briefs

`packages/analysis/src/automation/periodic_briefs.py` — `WeeklyBriefGenerator` and `MonthlyBriefGenerator`. Hybrid format: template stats (story counts, funding, top entities) + LLM narrative (executive summary, trends, builder lessons). Stored in `news_periodic_briefs` table.

## Key Files

- `news_ingest.py` — Main pipeline, Turkey pre-filter, LLM classifier
- `memory_gate.py` — EntityIndex, FactExtractor, MemoryStore, MemoryGate (region-aware)
- `periodic_briefs.py` — WeeklyBriefGenerator, MonthlyBriefGenerator
- `embedding.py` — EmbeddingService for pgvector
- Migrations: `023_memory_system.sql` (6 tables), `024_regional_memory.sql`, `025_periodic_briefs.sql`

## CLI

```bash
python main.py ingest-news --region global
python main.py memory-backfill --region turkey --days 7
python main.py generate-weekly-brief --region turkey --week 2026-02-03
python main.py generate-monthly-brief-news --region turkey --month 2026-01
python main.py embed-backfill --days 30 --dry-run
python main.py send-news-digest --region global --edition-date 2026-02-07
```

## Status

Phase 1 complete (entity linking + fact extraction + regional memory + periodic brief generators). Phases 2-4 pending (pattern matching, scoring/gating, calibration).
