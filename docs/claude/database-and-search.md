# Database Schema & Vector Search

## Server

- **Host:** `aistartupstr.postgres.database.azure.com`
- **Database:** `startupinvestments`
- **Engine:** Azure PostgreSQL Flexible Server (v16)
- **Extensions:** `gen_random_uuid()` (built-in), `vector` (pgvector — requires enablement, see below)

## Complete Table Reference

### Startup Data Domain

| Table | Source Migration | Purpose |
|-------|-----------------|---------|
| `startups` | 001, 002, 005, 008, 009, 022 | Core startup records with analysis fields, logo BYTEA, slug, period tracking |
| `funding_rounds` | 001, 010 | Individual funding round details (amount, type, lead investor, date) |
| `investors` | 001 | Investor profiles (VC, angel, corporate) |
| `investments` | 001 | Junction: investors ↔ funding_rounds (with is_lead flag) |
| `startup_briefs` | 002 | Versioned LLM-generated brief content per startup |
| `startup_snapshots` | 003 | Monthly point-in-time snapshots (funding, patterns, market position) |
| `investor_startup_links` | 003 | Relationship tracking (lead, participant, board, advisor) |
| `competitor_links` | 003 | Competitive relationships with similarity scoring |
| `pattern_correlations` | 003 | Build pattern co-occurrence statistics |
| `newsletters` | 001, 002 | Generated newsletter content (draft/published) |

**Key `startups` columns (accumulated across migrations):**
- Identity: `id`, `name`, `slug`, `description`, `website`, `canonical_url`
- Location: `headquarters_city`, `headquarters_country`, `continent`
- Business: `industry`, `industries`, `pattern`, `stage`, `employee_count`, `market_type`, `sub_vertical`, `target_market`
- Funding: `funding_type`, `money_raised_usd`, `announced_date`, `funding_stage`, `num_funding_rounds`, `lead_investors`
- Analysis: `genai_native`, `genai_intensity`, `models_mentioned`, `build_patterns`, `unique_findings`, `confidence_score`, `technical_depth`, `newsletter_potential`
- Content: `brief_content`, `brief_generated_at`, `content_hash`, `content_analyzed_chars`, `analysis_timestamp`
- Logo: `logo_data` (BYTEA), `logo_content_type`, `logo_updated_at`
- Crawl: `html_hash`, `change_rate`, `last_changed_at`, `consecutive_unchanged`, `last_crawl_at`, `crawl_success_rate`
- Meta: `period`, `created_at`, `updated_at`

### News Pipeline Domain

| Table | Source Migration | Purpose |
|-------|-----------------|---------|
| `news_sources` | 012, 020 | Source registry (RSS/API/community/crawler) with credibility_weight and region |
| `news_items_raw` | 012 | Raw normalized items from sources (title, URL, summary, published_at, language) |
| `news_clusters` | 012, 013, 014, **028** | Deduplicated story clusters with ranking, tags, LLM enrichment, **embeddings** |
| `news_cluster_items` | 012 | Junction: clusters ↔ raw items (with is_primary, source_rank) |
| `news_daily_editions` | 012, 020 | Daily edition snapshots per region (top_cluster_ids, stats_json) |
| `news_topic_index` | 012, 020 | Topic-to-cluster lookup by edition date and region |
| `news_ingestion_runs` | 012 | Operational telemetry for ingest runs |

**Key `news_clusters` columns:**
- Core: `id`, `cluster_key` (unique), `canonical_url`, `title`, `summary`, `published_at`
- Classification: `story_type`, `topic_tags[]`, `entities[]`, `source_count`
- Ranking: `rank_score`, `rank_reason`, `trust_score`
- LLM enrichment (013): `builder_takeaway`, `llm_summary`, `llm_model`
- LLM scoring (014): `llm_signal_score`, `llm_confidence_score`, `llm_topic_tags[]`, `llm_story_type`
- Vector search (028): `embedding` (vector 1536), `embedded_at`, `related_cluster_ids[]`

**Region model:** `news_clusters` has NO `region` column. Region is determined by:
- `news_daily_editions.region` (global | turkey) — PK is `(edition_date, region)`
- `news_topic_index.region` (global | turkey) — PK is `(topic, cluster_id, edition_date, region)`
- A cluster can appear in multiple regional editions

### Memory Gate Domain

| Table | Source Migration | Purpose |
|-------|-----------------|---------|
| `news_entity_facts` | 023, 024 | Persistent entity claims with provenance, lifecycle, and region |
| `news_item_extractions` | 023 | Per-cluster extraction results (claims, entities, patterns, GTM tags) |
| `news_item_decisions` | 023 | Routing decisions per cluster (publish/watchlist/accumulate/drop) |
| `news_pattern_library` | 023, 024 | Build patterns accumulated from news with region |
| `news_gtm_taxonomy` | 023 | Go-to-market tags hierarchy with frequency |
| `news_calibration_labels` | 023 | Human feedback for threshold tuning |

**`news_entity_facts` key columns:**
- `entity_name`, `entity_type` (company/person/investor/product)
- `linked_startup_id`, `linked_investor_id` — FK to startups/investors
- `fact_key`, `fact_value`, `fact_confidence`
- `source_cluster_id` — FK to news_clusters
- `is_current`, `superseded_by` — lifecycle tracking
- `confirmation_count`, `first_seen_at`, `last_confirmed_at`
- `region` (global | turkey) — added by migration 024

### Email & Subscriptions Domain

| Table | Source Migration | Purpose |
|-------|-----------------|---------|
| `news_email_subscriptions` | 013, 017, 018, 025 | Email subscriptions (double opt-in, region, digest_frequency) |
| `news_digest_deliveries` | 013 | Delivery tracking per edition per subscriber |
| `news_periodic_briefs` | 025 | Weekly/monthly briefs (stats_json + narrative_json) per region |

**`news_email_subscriptions` key columns:**
- `email`, `email_normalized` (unique per region), `status` (pending_confirmation/active/unsubscribed/bounced)
- `region` (global | turkey), `digest_frequency` (daily/weekly/monthly)
- `unsubscribe_token`, `confirmation_token`, `confirmed_at`
- `timezone` — for timezone-aware digest delivery

### User & Engagement Domain

| Table | Source Migration | Purpose |
|-------|-----------------|---------|
| `users` | 006 | Authenticated users (Google OAuth + credentials) |
| `user_watchlists` | 006 | User's saved startups |
| `user_preferences` | 006 | User settings (audience: builders/investors, filters) |

### Crawling & Frontier Domain

| Table | Source Migration | Purpose |
|-------|-----------------|---------|
| `crawl_logs` | 003, 009, 011 | Crawl attempt history with quality scoring and error tracking |
| `crawl_frontier_urls` | 011 | Canonical URL registry for crawl frontier |
| `crawl_frontier_queue` | 011 | Lease-based queue for crawl workers |
| `domain_stats` | 009 | Per-domain throttling, error rates, capability flags |
| `domain_policies` | 011 | Per-domain crawl policies (delay, concurrency, proxy tier) |
| `deep_research_queue` | 003 | LLM deep research queue for startups |
| `startup_events` | 003 | Events triggering re-analysis (funding, website change, mentions) |

---

## Vector Search Architecture (pgvector)

### Overview

Semantic search over news clusters using `text-embedding-3-small` (1536 dimensions) via Azure OpenAI. Serves two purposes:

1. **User-facing search** — `/news/search` page with semantic similarity across all historical news
2. **Editorial memory** — automatically links related past clusters when processing new stories

### Prerequisites

1. **Enable pgvector extension** on Azure PostgreSQL Flexible Server:
   - Portal → Server Parameters → `azure.extensions` → add `vector`
   - No restart needed, one-time operation
2. **Deploy embedding model** (`text-embedding-3-small`) on Azure OpenAI resource `aoai-ep-swedencentral02`
3. **AKS pod identity** needs `Cognitive Services OpenAI User` role on AOAI resource (VM already has this)

### Schema (Migration 028)

```sql
-- On news_clusters:
embedding vector(1536)         -- text-embedding-3-small vector
embedded_at TIMESTAMPTZ        -- NULL = needs embedding (backfill flag)
related_cluster_ids UUID[]     -- top-5 similar past clusters (editorial memory)

-- Indexes:
idx_news_clusters_embedding    -- HNSW (vector_cosine_ops, m=16, ef_construction=64)
idx_news_clusters_unembedded   -- partial index WHERE embedding IS NULL
```

### Embedding Pipeline

```
news_ingest.py pipeline:
  collect → cluster → memory_gate → LLM enrich → persist_clusters → persist_memory
  → embed_clusters()              ← NEW: generate embeddings (non-blocking)
  → populate_related_clusters()   ← NEW: find top-5 similar past clusters
  → persist_edition
```

**Key file:** `packages/analysis/src/automation/embedding.py`

- `EmbeddingService` class with Azure OpenAI client (AAD auth via `DefaultAzureCredential`)
- `_prepare_text(title, summary, entities)` — concatenates fields for embedding input (max 8000 chars)
- `embed_texts(texts)` — batched Azure OpenAI call (batch size 100)
- `embed_clusters()` — non-blocking: if AOAI down, clusters created without embeddings
- `find_similar()` — cosine similarity search with date/region filters
- `populate_related_clusters()` — stores top-5 similar (threshold > 0.5) in `related_cluster_ids`

**Backfill CLI:**
```bash
python main.py embed-backfill                # All unembedded clusters
python main.py embed-backfill --days 30      # Last 30 days only
python main.py embed-backfill --dry-run      # Count only
```

### Search API

```
GET /api/v1/news/search?q=AI+agent+funding&region=global&limit=20&story_type=funding&date_from=2026-01-01
```

**Flow:**
1. API server embeds query text via `generateQueryEmbedding()` (`apps/api/src/services/embedding.ts`)
2. pgvector similarity search: `ORDER BY embedding <=> $query_embedding`
3. Region filter via JOIN on `news_topic_index`
4. Fallback to `ILIKE` text search if embedding fails
5. Results cached 5 minutes in Redis

**Response:** `NewsSearchResult[]` with `similarity` score (0-1), title, summary, entities, dates

### Cost

- ~100 clusters/day × ~200 tokens each = $0.001/day for embedding
- ~100 searches/day = $0.0001/day for query embedding
- **Total: < $1/month**

---

## Key Relationships

```
startups ──┬── funding_rounds ── investments ── investors
           ├── startup_briefs
           ├── startup_snapshots
           ├── investor_startup_links ── investors
           ├── competitor_links (self-ref)
           ├── crawl_logs
           ├── deep_research_queue
           ├── startup_events
           └── news_entity_facts (linked_startup_id)

news_sources ── news_items_raw ── news_cluster_items ── news_clusters
                                                          ├── news_item_extractions (1:1)
                                                          ├── news_item_decisions (1:1)
                                                          ├── news_entity_facts
                                                          ├── news_calibration_labels
                                                          └── (via topic_index) ── news_daily_editions

news_email_subscriptions ── news_digest_deliveries
news_periodic_briefs (standalone, references cluster_ids)

crawl_frontier_urls ── crawl_frontier_queue
domain_stats (standalone)
domain_policies (standalone)
```

---

## Migration Index

| # | File | What it does |
|---|------|-------------|
| 001 | `001_initial_schema.sql` | startups, funding_rounds, investors, investments, newsletters |
| 002 | `002_add_analysis_fields.sql` | Analysis columns on startups, startup_briefs table |
| 003 | `003_context_management.sql` | crawl_logs, startup_snapshots, investor/competitor links, pattern_correlations, deep_research_queue, startup_events |
| 005 | `005_add_logo_storage.sql` | Logo BYTEA + slug on startups |
| 006 | `006_add_users_table.sql` | users, user_watchlists, user_preferences |
| 007 | `007_engagement_loops.sql` | Engagement tracking |
| 008 | `008_startup_analysis_data.sql` | Additional analysis fields |
| 009 | `009_crawler_improvements.sql` | domain_stats, crawler quality/retry fields |
| 010 | `010_add_constraints.sql` | Unique indexes on startups.slug, funding_rounds |
| 011 | `011_frontier_and_incremental_recrawl.sql` | crawl_frontier_urls, crawl_frontier_queue, domain_policies |
| 012 | `012_daily_news.sql` | news_sources, news_items_raw, news_clusters, news_cluster_items, news_daily_editions, news_topic_index, news_ingestion_runs |
| 013 | `013_news_digest_and_llm_enrichment.sql` | LLM columns on clusters, news_email_subscriptions, news_digest_deliveries |
| 014 | `014_news_llm_scoring_and_classification.sql` | LLM scoring columns on clusters |
| 015 | `015_performance_indexes.sql` | Performance indexes |
| 016 | `016_crawl_replay_and_policy_feedback.sql` | Crawl replay, event retry tracking |
| 017 | `017_email_confirmation_and_region.sql` | Double opt-in, region on subscriptions |
| 018 | `018_news_subscription_rate_limits.sql` | Rate limits on subscriptions |
| 019 | `019_startup_vertical_taxonomy_indexes.sql` | Vertical taxonomy indexes |
| 020 | `020_news_editions_by_region.sql` | Region columns on sources, editions, topic_index |
| 021 | `021_build_patterns_and_funding_indexes.sql` | Build pattern + funding indexes |
| 022 | `022_startup_dataset_region.sql` | Region on startup dataset |
| 023 | `023_memory_system.sql` | 6 memory gate tables (entity_facts, extractions, decisions, patterns, GTM, calibration) |
| 024 | `024_regional_memory.sql` | Region columns on entity_facts, pattern_library |
| 025 | `025_periodic_briefs.sql` | news_periodic_briefs, digest_frequency on subscriptions |
| 026 | `026_refinery_enhancements.sql` | Refinery enhancements |
| 027 | `027_subscriber_timezone.sql` | Timezone on email subscriptions |
| 028 | `028_pgvector_embeddings.sql` | pgvector extension, embedding/related columns on news_clusters |
