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

**How it works:**
- `runner.sh` wrapper: sources `/etc/buildatlas/.env`, flock locking, timeout, logging to `/var/log/buildatlas/`, Slack on failure
- Code updates every 6 hours (`deploy.sh`): pulls latest, auto-triggers backend/frontend deploys if `apps/api/**` or `apps/web/**` changed
- `sync-data.sh` triggers `frontend-deploy.sh` after pushing data changes

**Scheduled cron jobs (all UTC):**

| Job | Schedule | What it does |
|-----|----------|-------------|
| `keep-alive` | Every 15 min | PostgreSQL + AKS + API + Frontend health checks |
| `news-ingest` | Hourly :15 | Fetch + LLM-enrich news articles |
| `crawl-frontier` | Every 30 min | Crawl frontier URLs |
| `news-digest` | Daily 13:10 | Send email digests (global + turkey) |
| `slack-summary` | Daily 14:00 | Ops summary to Slack |
| `sync-data` | 30 min weekdays 8-20 | Blob sync → git push → frontend deploy |
| `code-update` | Every 6 hours | git pull → conditional backend/frontend deploy |
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

Push after every change. Commit messages: concise and descriptive. The VM pulls code every 6 hours and auto-deploys if `apps/api/**` or `apps/web/**` changed. Functions and DB sync still deploy via GitHub Actions on push.

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
| [`docs/claude/infrastructure-health.md`](docs/claude/infrastructure-health.md) | Debugging production issues (504s, CrashLoopBackOff, Redis down) |
| [`docs/claude/email-infrastructure.md`](docs/claude/email-infrastructure.md) | Working on email/newsletter features (Resend API) |
| [`docs/claude/frontend-patterns.md`](docs/claude/frontend-patterns.md) | Working on frontend copy, UI, dual-audience messaging |
