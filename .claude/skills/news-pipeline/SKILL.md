# News Pipeline

Quick reference for news pipeline operations.

## CLI Commands

```bash
cd packages/analysis

# News ingest (usually runs hourly via cron)
python main.py ingest-news --region global
python main.py ingest-news --region turkey

# Memory backfill
python main.py memory-backfill --region turkey --days 7

# Periodic briefs
python main.py generate-weekly-brief --region turkey --week 2026-02-03
python main.py generate-monthly-brief-news --region turkey --month 2026-01

# Embedding backfill
python main.py embed-backfill --days 30 --dry-run

# Email digest
python main.py send-news-digest --region global --edition-date 2026-02-07
```

## Key Files
- `news_ingest.py` — Main pipeline: collect → cluster → memory gate → LLM enrich → persist → edition
- `memory_gate.py` — Entity linking, fact extraction, memory store (region-aware)
- `periodic_briefs.py` — Weekly/monthly brief generators (hybrid stats + LLM narrative)
- `embedding.py` — EmbeddingService for pgvector search

## Architecture
Full pipeline details: `docs/claude/news-pipeline.md`
Memory system schema: `docs/claude/database-and-search.md`
Email delivery: `docs/claude/email-infrastructure.md`
