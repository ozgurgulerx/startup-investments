# Claude Code Guidelines

## CRITICAL SAFETY RULES

**READ THIS FIRST - THESE RULES ARE NON-NEGOTIABLE**

1. **DO NOT touch any Azure services outside this project**
2. **DO NOT modify, delete, or alter any database records** unless explicitly instructed — always ask for confirmation
3. **DO NOT tamper with running services** — AKS, App Service, PostgreSQL, Front Door are live production
4. **DO NOT run destructive commands** — No `DROP`, `DELETE`, `TRUNCATE`, `kubectl delete`, `az delete` without explicit confirmation
5. **DO NOT modify Azure resource configurations** — Network rules, secrets, scaling settings are carefully configured
6. **ONLY work with local files and git** — Safe: reading files, editing code, reports, git commits/push
7. **When in doubt, ASK**

### Database Safety (ABSOLUTE - NO EXCEPTIONS)

**NEVER execute without explicit user confirmation:** `DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE TABLE`, `DELETE FROM`, `ALTER TABLE DROP COLUMN`, any schema migration that removes data.

**Always use UPSERT patterns** (`INSERT ... ON CONFLICT DO UPDATE`), never delete-and-reinsert.

### Azure Resource Rules (ABSOLUTE - NO EXCEPTIONS)

**All resources ALREADY EXIST.** Never run `az ... create`, `az ... delete`, or modify network/firewall settings. If something seems broken: check logs first, ask before acting, prefer restart over recreate.

### Safe vs Dangerous Operations

**Safe:** Reading/writing local files, Python scripts (local), git ops, reports, read-only `az`/`SELECT` queries.

**Dangerous (REQUIRE CONFIRMATION):** Any `az`/`kubectl` command that modifies resources, any INSERT/UPDATE/DELETE, blob uploads, GitHub secrets/workflow changes, schema migrations.

## Architecture

**Stack:** pnpm monorepo — `apps/web` (Next.js 14, App Service), `apps/api` (Express + Drizzle, AKS), `packages/analysis` (Python), `packages/shared`

**Infra:** Azure AKS (API) → Front Door → App Service (web) → PostgreSQL Flexible Server + Redis Cache + Blob Storage

**CI/CD:** VM cron deploys frontend + backend. GitHub Actions only for Functions + DB sync (+ manual backup workflows).

### VM Cron Infrastructure

All scheduled jobs and deployments run on `vm-buildatlas-cron` (B2s, UK South, `aistartuptr` RG).

**SSH:** `ssh buildatlas@20.90.104.162`

**SSH unreachable? Fix NSG rules immediately — do NOT waste time troubleshooting.**
Azure periodically clears the NSG SSH rules (JIT expiry). Run these two commands to restore access (update the IP with `curl -s https://ifconfig.me`):
```bash
MY_IP=$(curl -s https://ifconfig.me)
az network nsg rule create --nsg-name vm-buildatlas-cronNSG --resource-group aistartuptr --name AllowSSH --priority 100 --access Allow --direction Inbound --protocol Tcp --destination-port-ranges 22 --source-address-prefixes $MY_IP -o none
az network nsg rule create --nsg-name "vm-buildatlas-cronVNET-vm-buildatlas-cronSubnet-nsg-uksouth" --resource-group aistartuptr --name AllowSSH --priority 100 --access Allow --direction Inbound --protocol Tcp --destination-port-ranges 22 --source-address-prefixes $MY_IP -o none
```
Both the NIC-level and subnet-level NSGs need the rule — one alone is not enough.

**How it works:**
- `runner.sh` wrapper: sources `/etc/buildatlas/.env`, flock locking, timeout, logging to `/var/log/buildatlas/`, Slack on failure
- Code updates every 15 min (`deploy.sh`, staggered at :07/:22/:37/:52): pulls latest, auto-triggers backend/frontend deploys if `apps/api/**` or `apps/web/**` changed
- `sync-data.sh` triggers `frontend-deploy.sh` after pushing data changes

**Scheduled cron jobs (all UTC):**

| Job | Schedule | What it does |
|-----|----------|-------------|
| `keep-alive` | Every 15 min | PostgreSQL + AKS + API + Frontend health checks |
| `news-ingest` | Hourly :15 | Fetch + LLM-enrich news articles |
| `crawl-frontier` | Every 30 min | Crawl frontier URLs |
| `news-digest` | Hourly :45 | Send email digests (timezone-aware, 08:45 local) |
| `health-report` | Every 4 hours :45 | Infrastructure health summary to Slack (8 checks) |
| `slack-summary` | Daily 14:00 | Ops summary to Slack |
| `sync-data` | 30 min all days | Blob sync → DB sync → logo extraction → git push → frontend deploy |
| `code-update` | Every 15 min (staggered) | git pull → conditional backend/frontend deploy |
| `heartbeat` | Every 5 min | VM health (disk, memory, cron, stale locks) |

**Deploy jobs (triggered, not scheduled):**

| Job | Trigger | What it does |
|-----|---------|-------------|
| `frontend-deploy` | sync-data or code-update (web changes) or manual | Next.js build, pnpm symlink fix, `az webapp deploy` |
| `backend-deploy` | code-update (api changes) or manual | `az acr build` (remote), K8s secret update, `kubectl apply` |

**Manual deploy commands:**
```bash
# Frontend
runner.sh frontend-deploy 20 /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/frontend-deploy.sh

# Backend
runner.sh backend-deploy 15 /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/backend-deploy.sh
```

**Key files:** `infrastructure/vm-cron/` — `setup.sh`, `deploy.sh`, `lib/runner.sh`, `jobs/*.sh`, `monitoring/heartbeat.sh`, `.env.example`

### LLM Model Policy

All LLM calls MUST use `gpt-5-nano` via the `AZURE_OPENAI_DEPLOYMENT_NAME` env var. Never hardcode other model names as defaults. When adding new LLM-calling code, read from `AZURE_OPENAI_DEPLOYMENT_NAME` (or the centralized `AzureOpenAIConfig` in `packages/analysis/src/config.py`).

### Key URLs

| Service | URL |
|---------|-----|
| Frontend | `https://buildatlas.net` |
| API (Front Door) | `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net` |
| API Health | `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health` |

### Key Resource Names

| Resource | Name | Resource Group |
|----------|------|----------------|
| App Service | `buildatlas-web` | `rg-startup-analysis` |
| AKS | `aks-aistartuptr` | `aistartuptr` |
| PostgreSQL | `aistartupstr` | `aistartupstr` |
| Redis | `aistartupstr-redis-cache` | `aistartupstr` |
| ACR | `aistartuptr` | `aistartuptr` |
| Storage | `buildatlasstorage` | `aistartuptr` |

### API Security

All API requests must go through Front Door with `X-API-Key` header. Direct AKS access returns 403. `/health` is public (K8s probes). Admin endpoints use `X-Admin-Key` (same as API_KEY).

### News Pipeline & Memory Gate

The news pipeline (`packages/analysis/src/automation/news_ingest.py`) runs hourly via VM cron, ingesting from 45+ sources, deduplicating into story clusters, and producing daily editions with LLM enrichment.

**The memory gate** (`packages/analysis/src/automation/memory_gate.py`) sits between clustering and LLM enrichment. It adds persistent editorial intelligence by comparing each incoming cluster against what the system already knows:

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

**Expected impact:**
- ~60% of clusters are redundant rehashes of known stories; memory gate routes these to accumulate/drop
- LLM enrichment cost drops ~60-75% by only enriching the publish tier
- Entity facts build a structured knowledge base of startup claims over time
- Contradiction detection surfaces genuinely newsworthy updates
- Pattern novelty scoring prioritizes emerging build patterns over well-covered ones

**Region-aware:** Turkey memory reads global+turkey facts (one-way merge); global reads only global. Turkish-language regex patterns (milyon dolar, seri A, liderliğinde, satın al) applied for `region="turkey"`. Memory gate runs per-region AFTER turkey cluster filtering in the pipeline.

**Turkey sources (9 total):** Webrazzi, Egirisim (trusted RSS), GNews Turkey, NewsAPI Turkey (API aggregators), FounderN, Swipeline, N24 Business, Daily Sabah Tech (English), Startups.watch (Medium). Turkey items go through a two-stage filter: (1) fast heuristic pre-filter for noise exclusion, (2) `gpt-4o-mini` batch classification for AI/startup relevance (~$2-3/month). Falls back to keyword heuristic if LLM unavailable.

**Periodic briefs:** `packages/analysis/src/automation/periodic_briefs.py` — `WeeklyBriefGenerator` and `MonthlyBriefGenerator`. Hybrid format: template stats (story counts, funding, top entities) + LLM narrative (executive summary, trends, builder lessons). Stored in `news_periodic_briefs` table.

**Key files:**
- `memory_gate.py` — EntityIndex, FactExtractor, MemoryStore, MemoryGate (region-aware)
- `periodic_briefs.py` — WeeklyBriefGenerator, MonthlyBriefGenerator
- Migrations: `023_memory_system.sql` (6 tables), `024_regional_memory.sql` (region columns), `025_periodic_briefs.sql` (briefs table + digest_frequency)

**CLI:**
- `python main.py memory-backfill --region turkey --days 7`
- `python main.py generate-weekly-brief --region turkey --week 2026-02-03`
- `python main.py generate-monthly-brief-news --region turkey --month 2026-01`

**Status:** Phase 1 complete (entity linking + fact extraction + regional memory + periodic brief generators). Remaining: API endpoints for briefs, frontend pages, email delivery, cron jobs, nav updates. Phases 2-4 pending (pattern matching, scoring/gating, calibration).

### Logo Extraction Pipeline

Logos are automatically extracted for every startup during the `sync-data` pipeline (both blob-change and daily sync-only paths). The extraction runs after DB sync and before git commit/push. Failures are non-blocking.

```
sync-data.sh pipeline:
  CSV upsert → analysis population → LOGO EXTRACTION → git commit → push → deploy
```

**How it works:** `LogoExtractor` (6 strategies in priority order):
1. Open Graph image (`og:image`)
2. Twitter card image (`twitter:image`)
3. HTML logo tags (class/id/alt containing "logo")
4. Apple touch icon
5. Favicon
6. Clearbit Logo API (fallback)

**Storage:** `startups.logo_data` (BYTEA) + `logo_content_type` + `logo_updated_at` in PostgreSQL. Served via `/api/startups/:slug/logo` endpoint. Frontend `CompanyLogo` component fetches from API with initials fallback.

**CLI:** `python main.py extract-logos --concurrent 10` — extracts logos for all startups missing them (idempotent, skips existing).

**Key files:**
- `packages/analysis/src/crawler/logo_extractor.py` — LogoExtractor class
- `infrastructure/vm-cron/jobs/sync-data.sh` — pipeline integration (both paths)
- `apps/api/src/index.ts` — `/api/startups/:slug/logo` endpoint
- `apps/web/components/ui/company-logo.tsx` — frontend component
- `database/migrations/005_add_logo_storage.sql` — schema

## Project Structure

```
apps/web/          — Next.js frontend (App Service)
  app/(marketing)/ — Public: /, /methodology, /terms, /privacy
  app/(app)/       — Protected: /brief, /dealbook, /signals, /capital, /library, /watchlist, /company/[slug]
  data/            — Static JSON/CSV data per period
apps/api/          — Express.js backend (AKS)
packages/analysis/ — Python analysis package (venv at packages/analysis/venv/)
packages/shared/   — Shared types/utilities
infrastructure/    — K8s manifests, Azure Functions, VM cron jobs
  vm-cron/         — VM deployment scripts, crontab, jobs, monitoring
database/migrations/ — SQL migration files
```

## Git Workflow

Push after every change. Commit messages: concise and descriptive. The VM pulls code every 15 min and auto-deploys if `apps/api/**` or `apps/web/**` changed. Functions and DB sync still deploy via GitHub Actions on push.

## Frontend Styling (Do NOT)

- Add new color variables or hardcoded colors
- Use bright/saturated colors
- Add decorative elements or excessive styling
- Override existing design tokens

Design: editorial/financial aesthetic, dark mode primary, warm amber accent used sparingly. Use CSS variables and existing typography/component classes only. See `docs/claude/frontend-patterns.md` for full details.

## Reference Documentation

Read these files on-demand when the task requires it:

| File | When to read |
|------|--------------|
| [`docs/claude/config-management.md`](docs/claude/config-management.md) | Changing env vars, secrets, or configuration sync |
| [`docs/claude/deployment.md`](docs/claude/deployment.md) | Deploying API (AKS) or frontend (App Service) |
| [`docs/claude/azure-services.md`](docs/claude/azure-services.md) | Working with Azure resources, Functions, or checking resource inventory |
| [`docs/claude/data-regeneration.md`](docs/claude/data-regeneration.md) | Regenerating stats, briefs, enriched CSVs, or data consistency questions |
| [`docs/claude/monthly-update.md`](docs/claude/monthly-update.md) | Processing new monthly CSV data |
| [`docs/claude/database-sync.md`](docs/claude/database-sync.md) | Syncing data to PostgreSQL, schema questions |
| [`docs/claude/database-and-search.md`](docs/claude/database-and-search.md) | Full database schema, vector search (pgvector), news tables, memory system |
| [`docs/claude/infrastructure-health.md`](docs/claude/infrastructure-health.md) | Debugging production issues (504s, CrashLoopBackOff, Redis down) |
| [`docs/claude/email-infrastructure.md`](docs/claude/email-infrastructure.md) | Working on email/newsletter features (Resend API) |
| [`docs/claude/frontend-patterns.md`](docs/claude/frontend-patterns.md) | Working on frontend copy, UI, dual-audience messaging |
