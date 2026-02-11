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

**Safe:** Reading/writing local files, Python scripts (local), git ops, reports, read-only `az`/`SELECT` queries.
**Dangerous (REQUIRE CONFIRMATION):** Any `az`/`kubectl` that modifies resources, any INSERT/UPDATE/DELETE, blob uploads, GitHub secrets/workflow changes, schema migrations.

## Architecture

**Stack:** pnpm monorepo — `apps/web` (Next.js 14, App Service), `apps/api` (Express + Drizzle, AKS), `packages/analysis` (Python), `packages/shared`

**Infra:** Azure AKS (API) → Front Door → App Service (web) → PostgreSQL Flexible Server + Redis Cache + Blob Storage

**CI/CD:** VM cron deploys frontend + backend. GitHub Actions only for Functions + DB sync (+ manual backup workflows).

**VM Cron:** All scheduled jobs run on `vm-buildatlas-cron`. See `docs/claude/vm-cron.md` for SSH, cron schedule, deploy commands.

**LLM Model Policy:** All LLM calls MUST use `gpt-5-nano` via `AZURE_OPENAI_DEPLOYMENT_NAME` env var. Never hardcode model names.

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

All API requests go through Front Door with `X-API-Key` header. Direct AKS access returns 403. `/health` is public. Admin endpoints use `X-Admin-Key`.

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

Push after every change. Commit messages: concise and descriptive. The VM pulls code every 15 min and auto-deploys if `apps/api/**` or `apps/web/**` changed.

## Reference Documentation

Read these files on-demand when the task requires it:

| File | When to read |
|------|--------------|
| `docs/claude/vm-cron.md` | VM cron jobs, SSH access, NSG fix, deploy commands |
| `docs/claude/news-pipeline.md` | News ingest, memory gate, Turkey sources, periodic briefs |
| `docs/claude/logo-extraction.md` | Logo extraction pipeline |
| `docs/claude/deployment.md` | Deploying API (AKS) or frontend (App Service) |
| `docs/claude/config-management.md` | Changing env vars, secrets, or configuration sync |
| `docs/claude/azure-services.md` | Working with Azure resources, Functions, or checking resource inventory |
| `docs/claude/data-regeneration.md` | Regenerating stats, briefs, enriched CSVs, or data consistency questions |
| `docs/claude/monthly-update.md` | Processing new monthly CSV data |
| `docs/claude/database-sync.md` | Syncing data to PostgreSQL, schema questions |
| `docs/claude/database-and-search.md` | Full database schema, vector search (pgvector), news tables, memory system |
| `docs/claude/infrastructure-health.md` | Debugging production issues (504s, CrashLoopBackOff, Redis down) |
| `docs/claude/email-infrastructure.md` | Working on email/newsletter features (Resend API) |
| `docs/claude/frontend-patterns.md` | Working on frontend copy, UI, dual-audience messaging |
| `docs/claude/card-schema.md` | Brief card format and components |
