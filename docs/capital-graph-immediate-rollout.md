# Capital Graph Immediate Rollout Plan

Last updated: 2026-02-13

## Goal
Ship user-visible value immediately from the new investor/founder graph model, without waiting for a full redesign.

## Phase 0 (Today): Data + API readiness

1. Apply migrations:
   - `infrastructure/vm-cron/jobs/apply-migrations.sh startups`
   - `infrastructure/vm-cron/jobs/apply-migrations.sh benchmarks`
2. Seed initial graph edges from existing investments/funding rounds.
3. Backfill curated entities/aliases via:
   - `scripts/sync-capital-graph-to-db.py --investors-csv ... --founders-csv ... --edges-csv ... --refresh-views`
   - For startups.watch bootstrap:
     - `scripts/extract-startups-watch-founders.py --xlsx ... --region turkey --out-dir ...`
     - then sync: `scripts/sync-capital-graph-to-db.py --founders-csv ... --edges-csv ... --startup-founders-csv ... --region turkey --refresh-views`
4. Enable continuous graph sync from news ingest:
   - `NEWS_GRAPH_SYNC_ENABLED=true` (default)
   - Funding stories with detected `lead_investor` now upsert `investor -> startup` graph edges (`LEADS_ROUND`).
   - Graph materialized views refresh automatically when new edges are written.
5. Verify API endpoints:
   - `/api/v1/investors/:id/network`
   - `/api/v1/startups/:id/investors`
   - `/api/v1/startups/:id/founders`

## Phase 1 (Immediate UX): Investors section enhancement

Add a lightweight **Investors section** using existing pages/components:

1. Investors list (`/investors`):
   - keep current screener cards,
   - add `portfolio_company_count` and `co_investor_count` from `graph_stats`.
2. Investor profile (`/investors/[id]`):
   - add a “Network” panel (top co-investors + portfolio startups),
   - fetch via `/api/investors/[id]/network`.
3. Company page (`/company/[slug]`):
   - add “Investors” block powered by `/api/startups/[id]/investors`.

## Phase 2 (1-2 sprints): Founder graph surfaces

1. Company page:
   - switch founder block source from `analysis_data.team_analysis` to normalized `/api/startups/:id/founders`.
2. Founder profile page (`/founders/[id]`):
   - founder bio + linked startups + role timeline.
3. Add founder search in admin ingestion workflow.

## Phase 3 (Operationalization)

1. Weekly manual curation job:
   - run `sync-capital-graph-to-db.py` with latest CSVs.
2. Add QA checks:
   - unresolved edges report threshold,
   - duplicate alias collisions,
   - materialized view refresh success.
3. Add analytics:
   - API hit rates for network endpoints,
   - investor profile engagement,
   - startup page investor-block CTR.

## Acceptance criteria

1. Investors page and investor profile visibly improve using graph data.
2. At least 80% of top investor profiles return non-empty network response.
3. Startup pages show investor relationships for seeded entities.
4. Manual CSV ingest can add/update investors/founders/edges without direct SQL edits.
