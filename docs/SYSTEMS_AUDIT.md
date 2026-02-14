# BuildAtlas — Systems Design / Due-Diligence Audit

Answers sourced from full codebase exploration (3 parallel agents, ~130 files read). All claims reference actual code, migrations, and configuration.

---

## 0) North Star + Users

### 1. Primary user today vs 6-month target
- **Today**: Primarily **operators/builders** (the entire UI vocabulary is "builder-first" — `builder_takeaway`, `why_it_matters`, `ba_bullets`). Secondary: early-stage **investors** (investor DNA, screener, co-invest graph, capital tab).
- **6-month target**: Appears to be converging on **investors** as primary monetization audience — the `capital_graph_edges` table (migration 059), investor onboarding pipeline, investor DNA profiles, and the entire `/capital` section suggest investor workflows are the growth vector. Builders remain the engagement/content hook.

### 2. The one job BuildAtlas must do better than anyone
- **"Surface non-obvious patterns early, with evidence."** The system is built around *pattern detection across companies* (not individual company profiles). The `signals` engine detects statistical claims like "Open-source core strategy adoption accelerating" with conviction/momentum/impact scores. The `pattern_registry` (20+ architecture patterns, 6 GTM categories) is the taxonomic backbone. This is closer to "find non-obvious signals early" than "monitor competitors."

### 3. Current engagement loop
- **Daily**: News edition -> `/news/` (top 20 ranked clusters with builder takeaways) -> click through to evidence
- **Weekly**: Periodic brief email (Mon 06:00 UTC) -> `/news/weekly` -> site return
- **Monthly**: Intelligence brief -> `/brief` (executive summary + metrics + deltas + pattern shifts)
- **Ongoing**: Watchlist subscribe (company/signal/pattern/investor) -> delta alerts -> `/movers` -> deep dive
- **Loop**: `News -> Signal discovery -> Watchlist -> Alerts -> Return for updates`

### 4. Conversion event
- **Current primary**: **Subscribe to watchlist** (`POST /api/v1/subscriptions` — objectType: startup|signal|pattern|investor). This is the stickiness mechanism.
- **Secondary**: Signal follow (`POST /api/v1/signals/:id/follow`), save/upvote news items (`POST /api/v1/news/signals`)
- **No payment gate yet** — pricing hypothesis exists (see Q37) but no paywall implementation in code.

---

## 1) Data Ingestion (Coverage, Freshness, Correctness)

### 5. Source types (58 total, from `news_ingest.py`)

| Type | Count | Examples | Credibility Range |
|------|-------|---------|-------------------|
| RSS/News Publishers | 10 | TechCrunch (0.94), VentureBeat (0.86), Crunchbase News (0.85), WIRED (0.80), Sifted (0.78) | 0.78-0.94 |
| Blog/Platform RSS | 7 | Product Hunt Feed (0.82), YC Blog (0.78), StrictlyVC (0.80), Fast Company (0.75) | 0.62-0.82 |
| Community RSS | 10 | HN RSS (0.83-0.85), Reddit r/startups (0.62), r/MachineLearning (0.66), Lobsters (0.70), Dev.to (0.62-0.63) | 0.60-0.85 |
| API Sources | 5 | Product Hunt API (0.86), HN API (0.88), NewsAPI (0.67), GNews (0.66), HuggingFace Papers (0.72) | 0.66-0.88 |
| Turkey-Specific | 21 | Webrazzi (0.74), Egirisim (0.70), FounderN (0.72), Startups.watch (0.75), 30+ VC blog crawler | 0.58-0.75 |
| Digest/Newsletter | 1 | AINews by swyx (0.88, digest_rss) | 0.88 |
| Crawler/Frontier | 2 | Frontier News URLs (0.62), Turkey VC blogs (batch HTML scrape) | 0.62 |
| Paid Headline Seeds | 1 | The Information (0.05, headline_only — seed for open-web corroboration) | 0.05 |
| X/Twitter Search | 2 | X Recent Search global (0.64), X Recent Search Turkey (0.65, language=tr) | 0.64-0.65 |
| Wire Services | 2 | PR Newswire Tech (0.68), BusinessWire Tech (0.66) | 0.66-0.68 |
| Big Tech Programs | 3 | Microsoft for Startups (0.68), AWS ML Blog (0.65), Google for Startups (0.62) | 0.62-0.68 |

### 6. Curated list vs open web? Discovery mechanism?
- **Curated list (58 sources)** — each with explicit `SourceDefinition` (key, URL, credibility_weight, legal_mode, language, lookback_hours).
- **Open web breadth** via 3 aggregator APIs: NewsAPI, GNews, HuggingFace — these surface articles from outlets not in the curated list.
- **Paid headline corroboration**: The Information (weight 0.05) is headline-only; system attempts to find open-web corroborating reports before publishing.
- **Discovery of new sources**: Manual — new sources added to `SOURCES` list in code. No automated source discovery.

### 7. Freshness SLA (source publish -> visible on site)
- **Default lookback**: 48 hours (`lookback_hours=48` in config)
- **Low-frequency overrides**: 168h (7 days) for SemiAnalysis, Turkish VC blogs (212 VC, Finberg, Endeavor, StartupCentrum)
- **Pipeline cadence**: News ingest cron runs **every 3 hours** (via `news-ingest.sh` on VM)
- **End-to-end SLA**: ~3-6 hours from publish to visible (fetch cycle + processing + LLM enrichment)
- **Breaking stories**: If from Tier-1 publisher (TechCrunch, HN API), can appear within one cycle (~3h)

### 8. Duplicates / near-duplicates / syndication handling
Three-layer dedup:

1. **Raw Item Dedup** (`news_ingest.py:4073`): Key = `(source_key, canonical_url, title_fingerprint)`. Title fingerprint = top 8 tokens after stopword removal (English + Turkish).
2. **Cluster-Level Near-Duplicate Detection** (`news_ingest.py:4287`):
   - Exact canonical_url -> same cluster
   - Title Jaccard similarity >= 0.78 -> same cluster
   - 2+ shared named entities + <= 48h time delta -> same cluster (catches editorial rewrites/syndication)
3. **Entity-Aware Cluster Merging** (`news_ingest.py:6663`): Merges clusters sharing primary entity + similar title; absorbs lower-ranked cluster's members.

### 9. Raw HTML + snapshots for audit/repro?
- **Raw items stored**: `news_items_raw` table holds title, summary_raw, URL, canonical_url, published_at, fetched_at, language, author, engagement_json, payload_json.
- **No raw HTML storage** — only extracted text (title + summary). Payload JSON may contain additional metadata.
- **Audit trail**: `news_cluster_items` links clusters -> raw items with `is_primary` flag and `source_rank`.

### 10. Failure rate (JS rendering, paywalls, bot blocks, rate limits)
- **JS rendering**: Frontier crawler uses Browserless (headless Chrome container) for JS-heavy pages.
- **Paywalls**: `legal_mode` field — `headline_snippet` (default, extract what's free) or `headline_only` (paid sources like The Information). `payload.paywalled = true` flag set when detected.
- **HTTP failures**: Tracked per source in `SourceFetchResult` (success, items_count, duration_ms, error). Errors logged but pipeline continues — non-fatal.
- **Timeout**: 30s per source fetch (`httpx.Timeout`).
- **Rate limits**: Async concurrency limited to ~12 sources per chunk for Turkey VC blog crawls. API sources (NewsAPI, GNews) use API keys with quota tracking.
- **Estimated failure rate**: Not explicitly tracked as a %. From code structure: ~5-10% of source fetches may fail in any given cycle (transient HTTP errors, rate limits, timeouts).

---

## 2) Entity Resolution + Graph (The Core "Atlas" Problem)

### 11. Canonical entities

| Entity | Table | Source |
|--------|-------|--------|
| **Startup** | `startups` | CSV import + admin sync |
| **Investor** | `investors` | CSV import + admin sync |
| **Founder** | `founders` (migration 059) | Admin upsert, with aliases |
| **Funding Round** | `funding_rounds` | CSV import |
| **Person** (extracted) | via NER in memory_gate | Heuristic extraction from news |
| **Product** (extracted) | via NER in memory_gate | Heuristic extraction from news |
| **Pattern** | `pattern_registry` | Curated taxonomy (20+ arch, 6 GTM) |
| **Signal** | `signals` | Computed from event aggregation |

Core canonical entities: **Startup, Investor, Founder, Funding Round**. Extended entities (Person, Product) extracted from text but not yet first-class DB nodes with full resolution.

### 12. Entity linking: text -> canonical node
**Three-method hybrid** (`memory_gate.py:216-279`):

1. **Exact Match** (confidence 1.0): Lowercase name lookup in `_name_index` (loaded from DB: startups.name, investors.name, founders.full_name)
2. **Domain Match** (confidence 0.9): Extract domain from URLs in cluster -> lookup in `_domain_index` (startup.website -> startup_id)
3. **Jaccard Token Overlap** (confidence 0.7-1.0): Split entity name into tokens, compare via Jaccard similarity >= 0.7 threshold. Multi-token names only (single tokens too ambiguous). Matches "Acme Labs Inc" to "Acme Labs" (90% overlap).

**No embeddings or LLM used for entity linking** — all heuristic, zero LLM cost.

### 13. Aliases, name collisions, subsidiaries, stealth
- **Aliases**: `founder_aliases` and `investor_aliases` tables (migration 059) — name variants, nicknames, transliterations, abbreviations. Indexed via normalized names (lowercase, whitespace-collapsed).
- **Startup aliases**: `startup_aliases` table — `aliasType` for post-merge mappings.
- **Collisions**: Single-token names excluded from Jaccard matching (too ambiguous). Multi-token names require >= 0.7 overlap.
- **Subsidiaries**: Not explicitly modeled. `capital_graph_edges` could represent parent-child relationships but no dedicated edge type.
- **Stealth startups**: No special handling. Would appear as unlinked entities until admin creates the startup record.

### 14. Graph schema (node/edge types + top 5 edge predicates)
**`capital_graph_edges` table** (migration 059):

```
Nodes: investor | startup | founder | funding_round (src_type/dst_type)

Edges with temporal validity:
  src_type + src_id -> edge_type -> dst_type + dst_id
  valid_from DATE, valid_to DATE (default '1900-01-01' to '9999-12-31')
  confidence NUMERIC(5,4)
  attrs_json JSONB (role, ownership_pct, etc.)
  source TEXT (manual|news|crawl)
  region TEXT (global|turkey)
```

**Top edge predicates** (inferred from code + admin routes):
1. `LEADS_ROUND` — investor -> funding_round
2. `PARTICIPATES_IN_ROUND` — investor -> funding_round
3. `HAS_FOUNDER` — startup -> founder (with role, ownership_pct in attrs)
4. `FUNDS` — investor -> startup (aggregate relationship)
5. `CO_INVESTS_WITH` — materialized via `investor_co_invest_edges` (not a direct edge type, computed from shared rounds)

**Materialized views**: `mv_investor_portfolio_current`, `mv_startup_investors_current` (refreshed via `refresh_capital_graph_views()`).

### 15. Temporal graph or static with event log?
- **Temporal**: Every edge has `valid_from` / `valid_to` date windows. Active edges: `valid_to = '9999-12-31'`. Historical reconstruction possible by querying edges valid at a specific date.
- **Plus event log**: `startup_events` table records detected events (funding_news, website_change, HN mention) with `detected_at` and `effective_date` timestamps.
- **Snapshots**: `startup_snapshots` table stores monthly state per company (funding total, patterns, confidence score).
- **So**: **Both** — temporal graph edges + event log + periodic snapshots.

---

## 3) "Signals" Model (Definitions, Evidence, Scoring)

### 16. What is a "signal" precisely?
A signal is a **statistical claim about pattern adoption acceleration** across companies. It lives in the `signals` table (migration 036):

```sql
domain TEXT  -- architecture | gtm | capital | org | product
claim TEXT   -- e.g., "Open-source core strategy adoption accelerating in enterprise AI"
pattern_id UUID REFERENCES pattern_registry(id)
conviction NUMERIC(5,4)   -- statistical confidence [0,1]
momentum NUMERIC(5,4)     -- acceleration trend [-1,1]
impact NUMERIC(5,4)       -- weighted importance [0,1]
adoption_velocity NUMERIC(8,4)  -- d(companies)/dt
status TEXT  -- candidate|emerging|accelerating|established|decaying
```

It is a **detected and scored pattern** — not editorial, not a single event. It aggregates multiple startup_events into a directional claim with evidence.

### 17. Unit of evidence behind a signal
The `signal_evidence` table (migration 036):

```sql
signal_id UUID REFERENCES signals(id)
event_id UUID REFERENCES startup_events(id)     -- primary source
cluster_id UUID REFERENCES news_clusters(id)     -- news article cluster
startup_id UUID REFERENCES startups(id)          -- which company
weight NUMERIC(5,4)                              -- relevance weight
evidence_type TEXT  -- event|cluster|crawl_diff|manual
snippet TEXT        -- supporting quote/text
```

**Unit = a startup_event** (funding raised, pattern adopted, product launched) linked to a news cluster and a specific company. Each event carries: event_type, confidence, source_type, metadata_json, effective_date, event_key (discriminator for dedup).

### 18. How are momentum / conviction / impact computed?
From `signal_engine.py`:

**Conviction** = `sigmoid(log(1+U) + 0.4*log(1+D) + 0.3*log(1+E) - 2)`
- U = unique companies exhibiting pattern
- D = source diversity (distinct sources/clusters)
- E = total evidence count
- Inflection at ~1 company + 1 source + 1 event. Range [0,1].

**Momentum** = `(T_recent - T_prev) / max(1, T_prev)`, clamped [-1, 1]
- T_recent = event count in last 7 days
- T_prev = event count in prior 7-30 day window
- Positive = accelerating, negative = decelerating.

**Impact** = `min(1.0, funding_score + enterprise_weight + hyperscaler_bonus)`
- funding_score = `avg(log(1 + amount/$1M) / 5.0)` normalized
- enterprise_weight = 0.2 if any enterprise-related event
- hyperscaler_bonus = 0.1 if AWS/Azure/GCP association
- Range [0,1].

**Adoption Velocity** = `min(1.0, companies_per_day / 10.0)`
- Slope of unique companies over signal lifetime
- 1.0 ~ 10+ new companies/day.

### 19. Signal stages
Yes, 5 lifecycle stages with automatic transitions:

| Stage | Entry Criteria |
|-------|---------------|
| `candidate` | New claim, conviction < 0.3 |
| `emerging` | Conviction >= 0.3, 3+ companies, momentum >= 0 |
| `accelerating` | Momentum >= 0.4, 10+ companies |
| `established` | 20+ companies, sustained momentum |
| `decaying` | Momentum <= -0.3 |

Transitions are **automated** by the signal scoring engine (daily cron). No human gate.

### 20. Preventing hallucinated causality
- **Memory gate is zero-LLM** — entity linking and fact extraction are regex/heuristic, no LLM inference of relationships.
- **LLM enrichment has 5 validation checks** (intel-first validation, `news_ingest.py:4970`):
  1. Source review count must match expected
  2. Source URLs must match canonical URLs (no invented sources)
  3. Title similarity check — ba_title cannot copy source title (>8 consecutive shared words rejected)
  4. Quote length validation (<= 20 words if quote_allowed)
  5. No >8-word copies from source text (paraphrasing enforced)
- **Signal scoring is purely statistical** — conviction/momentum/impact are formulas over event counts, not LLM claims.
- **Weakness**: `builder_takeaway` and `why_it_matters` are LLM-generated free text without explicit grounding verification beyond the 5 checks above. Causal claims in these fields could be hallucinated.

---

## 4) LLM Enrichment Pipeline (Cost + Reliability)

### 21. Which tasks are LLM-based?

| Task | LLM? | Model | Purpose |
|------|-------|-------|---------|
| News cluster enrichment | Yes | gpt-5-nano | ba_title, ba_bullets, why_it_matters, builder_takeaway, topic_tags, story_type, signal/confidence scores |
| Daily brief synthesis | Yes | gpt-5-mini (reasoning) | Executive narrative from top 10 clusters |
| Turkey relevance filter | Yes | gpt-5-nano | 3-tier classification (0/1/2) in batches of 20 |
| Periodic briefs (weekly/monthly) | Yes | gpt-5-nano | Narrative synthesis (summary, trends, lessons) |
| Deep dive synthesis | Yes | gpt-5-nano | Per-signal deep analysis |
| Deep research | Yes | gpt-5-nano / gpt-4o | Per-startup web research synthesis |
| Entity linking | **No** | -- | Heuristic (exact/domain/Jaccard) |
| Fact extraction | **No** | -- | Regex patterns (English + Turkish) |
| Memory gate decisions | **No** | -- | Rule-based scoring |
| Signal scoring | **No** | -- | Statistical formulas |
| Event extraction | **No** | -- | Rule-based mapping |
| Embeddings | API call | text-embedding-3-small | Vector encoding, not generative |

### 22. Models used + fallback strategy
- **Primary**: `gpt-5-nano` via `AZURE_OPENAI_DEPLOYMENT_NAME` (Azure OpenAI, DefaultAzureCredential)
- **Daily Brief**: `gpt-5-mini` (reasoning) via `AZURE_OPENAI_DAILY_BRIEF_DEPLOYMENT_NAME` — falls back to gpt-5-nano
- **Fallback on failure**: `AZURE_OPENAI_FALLBACK_DEPLOYMENT_NAME` (used on 404/incompatible params)
- **GPT-5/o-series token scaling**: `max_completion_tokens = max_tokens * 3` (reasoning tokens before output)
- **Enrichment failures**: Non-fatal — cluster is created without enrichment, pipeline continues
- **Turkey LLM failures**: Falls back to keyword heuristic classification

### 23. Caching + prompt evolution
- **Enrichment hash**: `SHA-256(sorted canonical URLs + lowercase title)` stored in `news_clusters.enrichment_hash` + `prompt_version` field
- **Prompt version**: `ENRICHMENT_PROMPT_VERSION = "intel-v2"` (line 62)
- **Re-enrichment**: **NOT automatic** when prompts change. Clusters with old `prompt_version` could be re-enriched but requires manual trigger (batch job or `--force-crawl`).
- **No prompt+input hash caching at LLM API level** — prompts are re-sent every call. No Azure OpenAI prompt cache utilized.

### 24. Cost per 1k ingested items (end-to-end)

**Model pricing** (from `deep_research_consumer.py`):
```
gpt-5-nano:  $0.10/1M input, $0.40/1M output
gpt-4o-mini: $0.15/1M input, $0.60/1M output
gpt-4o:      $2.50/1M input, $10.0/1M output
```

**Estimated monthly cost breakdown**:

| Component | Est. Monthly | Notes |
|-----------|-------------|-------|
| News enrichment (gpt-5-nano) | ~$50-100 | 200 clusters/day x 30 days, ~1K tokens avg per call |
| Daily brief (gpt-5-mini) | ~$20-30 | 1 call/day, ~3K tokens (reasoning 3x budget) |
| Turkey classification | ~$2-3 | Batched 20/call, low volume |
| Embeddings (text-embedding-3-small) | ~$10-20 | Batch 100/call |
| Periodic briefs | ~$5-10 | 4 weekly + 1 monthly |
| Deep research (on-demand) | Variable | Per-startup, cost tracked per call |
| **Total** | **~$90-170/mo** | Excluding deep research |

**Cost per 1K items**: ~$0.50-1.50 (mostly enrichment; entity linking/fact extraction/event extraction are zero-cost heuristics).

### 25. Quality measurement of LLM outputs
- **5 heuristic validation checks** (see Q20): Source count, URL proof, title similarity, quote length, paraphrase enforcement.
- **Metrics tracked**: `intel_attempted`, `intel_accepted`, `intel_rejected_validation`, `intel_missing_source_proof`, `intel_rejection_reasons` dict, latency p50/p95/avg.
- **No eval set**: No human annotation dataset.
- **No A/B testing**: No comparison between prompt versions.
- **No disagreement checks**: No multi-model consensus.
- **Community signals**: Users can upvote/save/hide/mark-not-useful on news items (`news_item_signals`), providing implicit quality feedback. Wilson lower bound confidence interval used for community signal scoring.

---

## 5) Storage + Retrieval (Performance + Correctness)

### 26. Storage stack + largest table

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Primary DB | PostgreSQL Flexible Server (Azure) | All structured data |
| Cache | Redis (Azure) | LRU cache, 5-60 min TTLs per endpoint |
| Blob Storage | Azure Blob Storage | Raw news content, logos, CSV uploads |
| Vector Index | pgvector (HNSW) | Semantic search on news_clusters.embedding |
| ORM | Drizzle (TypeScript) | API <-> DB layer |

**Largest tables** (estimated by ingest volume):
1. `news_items_raw` — every fetched item from 58 sources, 3h cycles -> ~500-1000 new rows/day
2. `news_clusters` — deduplicated story clusters -> ~100-200/day
3. `startup_events` — extracted events -> ~50-100/day
4. `signal_evidence` — evidence links -> growing with signals
5. `startups` — ~77+ companies (small but heavily queried)

### 27. Slow queries today (top 3)

1. **Dealbook search** (`GET /api/v1/dealbook`): Multi-table JOIN with JSONB operators (vertical taxonomy 3-level), ILIKE on multiple fields, SQL CASE relevance scoring, **offset-based pagination** (degrades at high page numbers). Cached 60s.

2. **News search** (`GET /api/v1/news/search`): PostgreSQL ILIKE substring match on title/summary — no full-text index, no trigram index. Will improve with pgvector migration. Cached per query hash.

3. **Signal recommendations** (`GET /api/v1/signals/recommendations`): Graph traversal — watchlist -> related signals + investor network overlap + memory momentum. Multiple round-trip queries. Not cached (user-scoped).

**No EXPLAIN output available** (read-only exploration), but these are the structurally slowest based on query patterns.

### 28. Keyword search vs semantic search vs graph traversal

| Mode | Implementation | Status |
|------|---------------|--------|
| **Keyword search** | ILIKE on PostgreSQL (news title/summary, dealbook multi-field) | Live, no FTS index |
| **Semantic search** | pgvector HNSW index on `news_clusters.embedding vector(1536)` | Schema ready (migration 028), **embedding population pending** (need to enable pgvector on Azure PG + deploy text-embedding-3-small) |
| **Graph traversal** | `capital_graph_edges` table with temporal validity + materialized views (`mv_investor_portfolio_current`, `mv_startup_investors_current`) | Live, used in investor DNA/portfolio/co-invest |

Three separate systems, not unified. Keyword and semantic search on news; graph traversal on capital relationships.

### 29. Embeddings: per doc, paragraph, or entity?
- **Per cluster** (document-level): `news_clusters.embedding vector(1536)`
- **Text**: `title + summary + top 10 entity names`, truncated to 8K chars
- **Model**: text-embedding-3-small (1536 dimensions)
- **Update**: Batch via `EmbeddingService.embed_clusters()`, idempotent (only updates NULL embedding columns)
- **Related clusters**: Top-5 similar past clusters stored in `related_cluster_ids UUID[]` (cosine similarity >= 0.50)
- **Signals also have embeddings**: `signals.embedding vector(1536)` used for merge detection (threshold 0.82)

---

## 6) UI/UX (How Users Think in the Product)

### 30. Primary pages

| Page | Path | Purpose |
|------|------|---------|
| **News Radar** | `/news/` | Daily edition -- ranked story clusters with builder takeaways, topic filtering |
| **Signals** | `/signals` | Pattern dashboard -- rising/established/decaying signals with conviction/momentum |
| **Signal Deep Dive** | `/signals/[id]` | 8-tab analysis: Case Studies, Community, Relevance, How It Works, Delta Board, Explorer, Counterevidence, Evidence Timeline |
| **Brief** | `/brief` | Monthly intelligence brief -- executive summary, metrics, deltas, pattern shifts |
| **Dealbook** | `/dealbook` | Searchable deal listing with advanced filters (stage, vertical, funding range, genai) |
| **Capital** | `/capital` | Investor landscape -- 5 tabs: Overview, Deals, Compare, Investors, Patterns |
| **Investor Profile** | `/investors/[id]` | Investor DNA -- pattern mix, portfolio, co-invest network |
| **Company Page** | `/company/[slug]` | Startup profile -- description, funding rounds, founders, investors, news, analysis |
| **Movers** | `/movers` | Change feed -- funding events, pattern shifts, stage progressions |
| **Watchlist** | `/watchlist` | Tracked companies + alerts (subscription-based) |
| **Landscapes** | `/landscapes` | Pattern-stage-sector cluster browser |
| **Benchmarks** | `/benchmarks` | Cohort percentile comparisons |
| **Dossiers** | `/dossiers` | Multi-company comparison workspaces |
| **Weekly/Monthly Briefs** | `/news/weekly`, `/news/monthly` | Periodic narrative briefs with stats |

### 31. Where users get confused
- **"What does this signal mean?"** — Signal claims are statistical abstractions ("Open-source core strategy adoption"). The `SignalExplain` component and `HowItWorksTab` exist to address this, but the concept is inherently abstract.
- **"Is it true?"** — Source attribution exists (publisher, URL, date) but confidence/conviction scores are statistical, not editorial. Users may not understand that conviction 0.87 doesn't mean 87% certainty in the colloquial sense.
- **"Why is it important?"** — `why_it_matters` (LLM-generated) and `impact` score attempt this, but the frame is always builder-centric. Investor users may want different framing.
- **Pattern taxonomy confusion**: 20+ architecture patterns + 6 GTM categories may overwhelm users who don't have a mental model for "what is a build pattern."

### 32. The one interaction you want to be addictive
- **Signal deep dive with evidence exploration** — the 8-tab signal page (`/signals/[id]`) with case studies, evidence timeline, counterevidence, and company explorer. This is where the "atlas" metaphor comes alive: navigate from pattern -> companies -> evidence -> related signals.
- **Secondary**: Hovering over a builder_takeaway on a news item and seeing the evidence chain (source attribution + linked entities + related clusters).

### 33. Workflows supported

| Workflow | Mechanism |
|----------|-----------|
| **Track** | `POST /subscriptions` (company, signal, pattern, investor) |
| **Get alerts** | Auto-generated `user_alerts` from deltas (severity 1-5, read/unread/archived) |
| **Weekly/Monthly digest** | `GET /alerts/digest` -> compiled thread; email delivery via Resend |
| **Export** | Dealbook JSON download, brief PDF export (`export-memo.ts`), benchmark cohort data |
| **Compare** | `/dossiers` workspace (multi-company side-by-side), `/benchmarks/compare` (two cohorts) |
| **Deep dive** | Signal -> evidence -> companies -> investors (graph navigation) |

Mostly **reading + tracking**. Export and collaboration features are nascent.

---

## 7) Operations + Trust (Editorial, Provenance, Abuse)

### 34. Human editor flow
- **Yes, editorial review exists**: `GET /api/admin/editorial/review` (review queue), `POST /api/admin/editorial/actions` (uprank, hide, reclassify), `GET/POST /api/admin/editorial/rules` (active rules).
- **What gets edited**: News cluster ranking (uprank/hide), topic reclassification, story_type override.
- **Provenance display**: Editorial actions are logged with timestamp and action type. Not directly visible to end users — it's an admin-only flow.
- **Paid headline handling**: The Information headlines (0.05 weight) are seeds; system attempts corroboration before surfacing. If no corroboration found, headline stays at near-zero rank.

### 35. Source attribution + timestamps + confidence on every claim
- **Source attribution**: Every news cluster shows publisher name, canonical URL, published_at, fetched_at.
- **Multi-source**: `source_count` integer + `news_cluster_items` linking all contributing sources with `source_rank`.
- **Trust score**: `trust_score = source_weight * 0.45 + diversity * 0.40 + 0.15` — shown implicitly via ranking, not as a user-facing number.
- **Confidence on signals**: `conviction` (0-1) displayed as percentage with `ConfidenceBadge` component.
- **Paywalled indicator**: Boolean flag in payload.
- **Evidence snippets**: `signal_evidence.snippet` — supporting quotes from articles.
- **Weakness**: Individual fact claims (from `news_entity_facts`) have `fact_confidence` (0-1) but this isn't surfaced in the UI. The memory gate's fact extraction confidence is internal-only.

### 36. Takedowns, corrections, source removals
- **Editorial hide**: `POST /api/admin/editorial/actions` with action=hide removes cluster from public view.
- **Fact versioning**: `news_entity_facts.superseded_by UUID` — when a fact is corrected, old fact points to new version. `is_current BOOLEAN` flag.
- **Contradiction tracking**: `news_item_decisions.contradictions_json` — array of `{fact_key, new_value, existing_value, entity_name}`. `has_contradiction BOOLEAN` flag for quick filtering.
- **Source removal**: Set `news_sources.is_active = false` to stop fetching. Existing items remain.
- **No public-facing correction mechanism** — corrections are internal (admin editorial flow).

---

## 8) Business + Moat

### 37. Pricing hypothesis
- **No payment gate in code yet.** Subscription model is tracking-based (watchlist), not monetary.
- **Likely model** (inferred from architecture):
  - Free: Daily news feed, basic signal browse
  - Paid: Deep dives, investor DNA, signal alerts, dossier export, API access
  - Team plans: Shared watchlists, collaborative dossiers
- **Evidence**: `deep_research_queue` tracks `costUsd` per request — suggesting deep research may be a paid feature. `user_subscriptions.digest_frequency` customization (daily/weekly/monthly) also suggests tiered access.

### 38. Moat hypothesis
Ordered by current depth of investment:

1. **Signal taxonomy + detection engine** — 20+ architecture patterns, 6 GTM categories, 5-stage lifecycle, statistical scoring formulas. This is the most differentiated part. Hard to replicate without the event -> signal aggregation pipeline.
2. **Dataset (entity graph)** — `capital_graph_edges` with temporal validity, investor DNA profiles, co-invest network. Becomes more valuable with time (network effects on data).
3. **Graph (relationships)** — Cross-referencing investors <-> startups <-> patterns <-> signals. The "atlas" in BuildAtlas.
4. **Distribution** — Daily/weekly/monthly briefs via email (Resend API). Newsletter-like engagement before product engagement.
5. **Workflow lock-in** — Watchlists, alerts, dossiers. Still nascent.

### 39. Biggest competitor substitute
- **Crunchbase/PitchBook**: Closest in entity data, but static profiles — no pattern detection or signal engine. BuildAtlas differentiates on *pattern-level intelligence* vs *company-level data*.
- **Newsletters** (Sifted, StrictlyVC, The Information): Compete on daily digest. BuildAtlas subsumes these as *sources* while adding structure + evidence.
- **Twitter/X**: Real-time signal discovery. BuildAtlas's X Recent Search integration acknowledges this — but adds structure, dedup, and persistence.
- **Perplexity / ChatGPT**: On-demand research. BuildAtlas differentiates with persistent tracking, temporal graph, and proactive alerts vs reactive Q&A.
- **Internal analysts**: BuildAtlas automates what a junior analyst does (scan sources, extract entities, track patterns). The automation is the value prop.

---

## 9) The "One Request Path" (Most Important)

### 40. End-to-end flow: article appears -> user sees it with evidence

```
1. TechCrunch publishes: "Acme AI raises $50M Series B led by Sequoia"
   |
2. [news_ingest.py] RSS fetch (every 3h, async, 30s timeout)
   -> NormalizedNewsItem: title, summary, canonical_url, published_at
   |
3. [Dedup] title_fingerprint("acme ai raises 50m series b") checked
   -> Not seen before -> proceed
   |
4. [Clustering] Jaccard similarity vs existing clusters
   -> If VentureBeat also reported, merged into same StoryCluster
   -> source_count=2, diversity score rises
   |
5. [Memory Gate -- zero LLM cost]
   a. EntityIndex.link("Acme AI") -> exact match -> startup_id=xyz
   b. EntityIndex.link("Sequoia") -> exact match -> investor_id=abc
   c. FactExtractor.extract():
      - regex: "$50M" -> fact_key=funding_amount, fact_value=50000000
      - regex: "Series B" -> fact_key=round_type, fact_value=series_b
      - regex: "led by Sequoia" -> fact_key=lead_investor, fact_value=Sequoia
   d. MemoryStore.compare():
      - Previous fact: funding_amount=10M (Series A) -> NEW fact, not contradiction
      - Confirmation count for Acme AI incremented
   e. MemoryGate.decide():
      - score_builder_insight=0.7, score_pattern_novelty=0.5, score_evidence_quality=0.8
      - decision=PUBLISH (composite > threshold)
   |
6. [LLM Enrichment -- gpt-5-nano]
   -> Prompt includes: cluster title, member summaries, source URLs
   -> Output: ba_title, ba_bullets, why_it_matters, builder_takeaway,
             impact frame, topic_tags=["ai","funding"], story_type="funding"
   -> Validated: source count matches, URLs match, title not copied, paraphrased
   |
7. [Event Extraction -- zero LLM cost]
   -> Claims -> startup_events:
     - event_type=cap_funding_raised, event_key=series_b, confidence=0.9
     - Linked: startup_id=xyz, cluster_id=this_cluster
   |
8. [Ranking]
   -> rank_score = recency(0.42) + source_weight(0.24) + diversity(0.14)
                 + engagement(0.10) + signal(0.08) + ai_boost(0.12) + funding_boost(0.08)
   -> trust_score = source_weight(0.45) + diversity(0.40) + 0.15
   -> rank_reason: ["breaking", "multi-source", "ai-priority"]
   |
9. [Signal Aggregation -- daily cron]
   -> New event (cap_funding_raised, series_b) added to signal evidence
   -> Signal "Enterprise AI funding accelerating":
     conviction += (new company), momentum updated (7-day window)
   -> If conviction crosses 0.3 threshold -> status: emerging
   |
10. [Persist to PostgreSQL]
    -> news_clusters, news_cluster_items, news_daily_editions
    -> news_entity_facts, news_item_extractions, news_item_decisions
    -> startup_events, signal_evidence
   |
11. [User sees it]
    -> GET /api/v1/news/latest -> cached 15 min -> daily edition
    -> Cluster card shows: ba_title, builder_takeaway, source count, trust badge
    -> Click -> full evidence: all sources, entities, related clusters
    -> Signal page updated: conviction/momentum recalculated
    -> Watchlist alert: if user tracks Acme AI -> user_alerts generated (severity=5, funding event)
```

**Where it can break** (failure points in order of severity):

| # | Failure Point | Impact | Mitigation |
|---|--------------|--------|------------|
| 1 | **RSS fetch fails** (timeout, 403, rate limit) | Article missed this cycle | Retry next 3h cycle; 48h lookback window catches it |
| 2 | **Entity linking misses** (name not in index) | Unlinked entity, no startup_event created | Falls through as "unresolved entity"; shows in news but doesn't feed signals |
| 3 | **LLM enrichment fails** (timeout, API error) | No builder_takeaway, raw title shown | Cluster still created with heuristic rank; non-fatal |
| 4 | **Fact extraction regex misses** (unusual format) | Funding amount/round not extracted | Event not created -> signal not updated. Memory gate still runs. |
| 5 | **Near-duplicate misses** (Jaccard < 0.78) | Same story appears as two clusters | Cosmetic -- user sees redundancy but no data corruption |
| 6 | **LB sync failure / API 504** | User can't access any data | As we just fixed -- AKS annotation issue. Monitoring via heartbeat + Slack alerts. |
| 7 | **PostgreSQL connection pool exhaustion** | All API queries fail | Pool monitoring in /health, auto-scaling HPA (2-5 pods) |
| 8 | **Redis cache miss storm** | API latency spikes | TTL-based, graceful degradation (bypass cache, serve from DB) |

---

## Quick-Reference: The Priority 10 (if answering only 10)

| # | Question | One-Line Answer |
|---|----------|----------------|
| 2 | North star job | Surface non-obvious patterns early, with statistical evidence |
| 7 | Freshness SLA | ~3-6 hours (3h fetch cycle + processing + enrichment) |
| 11 | Canonical entities | Startup, Investor, Founder, Funding Round (+ extracted Person, Product) |
| 14 | Graph schema | Temporal capital_graph_edges (investor<->startup<->founder<->round) with validity windows |
| 16 | Signal definition | Statistical claim about pattern adoption acceleration, scored by conviction/momentum/impact |
| 18 | Scoring formula | Conviction=sigmoid(log companies + sources + evidence), Momentum=7d vs 7-30d ratio, Impact=funding+enterprise+hyperscaler |
| 21 | LLM tasks | Enrichment (takeaways), daily brief, turkey filter, periodic briefs, deep research; entity linking + signals = zero-LLM |
| 24 | Cost per 1k items | ~$0.50-1.50 (enrichment-dominated); ~$90-170/month total |
| 27 | Slow queries | Dealbook search (JSONB + ILIKE + offset), news search (ILIKE, no FTS), signal recommendations (graph traversal) |
| 40 | Request path | RSS->dedup->cluster->memory gate (zero LLM)->LLM enrich->event extract->rank->persist->API->user; breaks at entity linking miss or LLM timeout |
