# BuildAtlas Operating Model

Last updated: 2026-02-13
Status: Canonical operator reference for architecture, deploys, cron jobs, and runbooks.

## 1) What This Document Is

Use this file as the source of truth before touching:
- infrastructure,
- deployments,
- scheduled jobs,
- data/news pipelines,
- API auth and routing.

If this document conflicts with older docs, trust this file plus the code paths linked below.

## 2) Production Architecture

### Runtime components

| Layer | Runtime | Resource / Entry | Purpose |
|---|---|---|---|
| Web | Azure App Service | `https://buildatlas.net` (`buildatlas-web`) | Next.js 14 frontend (standalone container) |
| API edge | Azure Front Door | `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net` | Public API entrypoint, probes, header enforcement path |
| API compute | AKS | `startup-investments-api` deployment | Express API (`apps/api`) |
| Data | Azure Postgres Flexible Server | `startupinvestments` DB | Primary application + pipeline data |
| Cache | Azure Redis (optional) | `REDIS_URL`-driven | API caching when configured |
| Scheduler | Azure VM cron | `vm-buildatlas-cron` | Primary automation runner |
| Container builds | Azure Container Registry | `aistartuptr.azurecr.io` | Remote builds for web/api images |
| Object data source | Azure Blob Storage | Synced into `apps/web/data/**` | Dataset ingestion source for sync pipeline |

### Request/data flow

1. Browser -> `buildatlas.net` (App Service).
2. Server-side web code calls API via Front Door.
3. Front Door routes to AKS API.
4. API reads/writes Postgres (and Redis when enabled).
5. If API is unhealthy, web can fall back to file-based dataset reads from `apps/web/data/**` (degradation mode).

### Security invariants

- API production routing expects Front Door header (`x-azure-fdid`) on most non-health routes.
- `/api/*` requires `x-api-key`; `/api/admin/*` requires `x-admin-key`.
- `/health`, `/healthz`, `/readyz` must stay public and cheap.
- `API_KEY` and `ADMIN_KEY` must never be exposed client-side.

## 3) Repository Map (Operationally Important Paths)

| Path | Role |
|---|---|
| `apps/web` | Next.js frontend |
| `apps/api` | Express backend |
| `packages/analysis` | Python automation (news, research, sync tooling) |
| `database/migrations` | SQL migrations |
| `infrastructure/kubernetes` | AKS manifests |
| `infrastructure/vm-cron` | Primary scheduler, deploy scripts, health monitors |
| `.github/workflows` | Backup/manual deploys + selected always-on GitHub automation |
| `scripts` | Operational scripts (Slack, sync helpers, deploy helpers) |

## 4) Deployment Model

### Primary deployment path (production default)

VM cron is the primary control plane.

- `code-update` (`infrastructure/vm-cron/deploy.sh`) runs every 15 minutes:
  - `git pull --ff-only origin main`
  - reinstalls cron if drift is detected
  - conditionally triggers:
    - `backend-deploy.sh` when API/shared/k8s files changed
    - `frontend-deploy.sh` when web/shared files changed
- `sync-data.sh` also triggers `frontend-deploy.sh` after blob data sync + git push.

### How web deploy works (`infrastructure/vm-cron/jobs/frontend-deploy.sh`)

1. Azure login via VM managed identity.
2. Build web image remotely on ACR (`az acr build`) with commit SHA tags.
3. Point App Service to that image.
4. Update app settings (without wiping missing secrets).
5. Smoke-check build marker on `buildatlas.net`; restart webapp if needed.

### How API deploy works (`infrastructure/vm-cron/jobs/backend-deploy.sh`)

1. Validate required envs: `DATABASE_URL`, `API_KEY`, `ADMIN_KEY`, `FRONT_DOOR_ID`.
2. Build API image on ACR.
3. Ensure AKS is running; fetch credentials.
4. Refresh Kubernetes secret `startup-investments-secrets`.
5. `kubectl apply` + rollout restart.
6. Health-check `/health`; rollback to previous image if unhealthy.

## 5) GitHub Actions: Backup vs Active Responsibilities

| Workflow | Current role |
|---|---|
| `frontend-deploy.yml` | Manual backup deploy only (`workflow_dispatch`) |
| `backend-deploy.yml` | Manual backup deploy only (`workflow_dispatch`) |
| `news-ingest.yml` | Manual backup only (scheduled run moved to VM cron) |
| `news-digest-daily.yml` | Manual backup only (scheduled run moved to VM cron) |
| `keep-aks-alive.yml` | Manual backup only |
| `keep-aks-running.yml` | Manual backup only |
| `sync-data.yml` | Manual + repository_dispatch backup |
| `slack-daily-summary.yml` | Manual backup only |
| `crawl-frontier.yml` | Manual workflow (cron schedule disabled) |
| `functions-deploy.yml` | Active GitHub workflow (`push` + manual) |
| `sync-to-database.yml` | Active GitHub workflow (`push` + manual) |
| `slack-commit-notify.yml` | Active on every push to `main` |
| `vm-watchdog.yml` | Active scheduled safety net (every 30m) |
| `vm-cron-slack-notify.yml` | Active event receiver for VM dispatch fallback |

## 6) VM Cron Operational Model

Source of truth: `infrastructure/vm-cron/crontab`.

### Wrapper behavior (`infrastructure/vm-cron/lib/runner.sh`)

`runner.sh` provides:
- env sourcing (`/etc/buildatlas/.env`, fallback repo `.env`),
- per-job lock files (`/tmp/buildatlas-<job>.lock`),
- timeout enforcement,
- log routing (`/var/log/buildatlas/<job>.log`),
- Slack start/success/failure/timeout notifications.

### Global git safety lock

`deploy.sh`, `sync-data.sh`, and other git-touching jobs use `/tmp/buildatlas-git.lock` to serialize git operations and avoid cross-job races.

### Logs and monitoring

- Job logs: `/var/log/buildatlas/*.log`
- VM heartbeat log: `/var/log/buildatlas/heartbeat.log`
- Heartbeat detects stale/overdue jobs, resource pressure, and cron daemon issues.

## 7) Cron Schedule Inventory (UTC)

### Scheduled jobs

| Job | Schedule (UTC) | Timeout (min) | Script |
|---|---|---:|---|
| `keep-alive` | `*/15 * * * *` | 20 | `infrastructure/vm-cron/jobs/keep-alive.sh` |
| `news-ingest` | `15 * * * *` | 30 | `infrastructure/vm-cron/jobs/news-ingest.sh` |
| `event-processor` | `5,20,35,50 * * * *` | 10 | `infrastructure/vm-cron/jobs/event-processor.sh` |
| `deep-research` | `12,27,42,57 * * * *` | 20 | `infrastructure/vm-cron/jobs/deep-research.sh` |
| `crawl-frontier` | `0,30 * * * *` | 25 | `infrastructure/vm-cron/jobs/crawl-frontier.sh` |
| `research-topics` | `40 * * * *` | 10 | `infrastructure/vm-cron/jobs/research-topics.sh` |
| `news-digest` | `45 * * * *` | 15 | `infrastructure/vm-cron/jobs/news-digest.sh` |
| `weekly-brief` | `0 6 * * 1` | 20 | `infrastructure/vm-cron/jobs/weekly-brief.sh` |
| `monthly-brief` | `0 6 1 * *` | 20 | `infrastructure/vm-cron/jobs/monthly-brief.sh` |
| `embed-backfill` | `25 * * * *` | 15 | `infrastructure/vm-cron/jobs/embed-backfill.sh` |
| `signal-aggregate` | `30 */4 * * *` | 10 | `infrastructure/vm-cron/jobs/signal-aggregate.sh` |
| `dealbook-brief` | `0 4 * * *` | 15 | `infrastructure/vm-cron/jobs/dealbook-brief.sh` |
| `neighbors-benchmarks` | `0 7 * * 4` | 60 | `infrastructure/vm-cron/jobs/neighbors-benchmarks.sh` |
| `compute-benchmarks` | `0 4 2 * *` | 30 | `infrastructure/vm-cron/jobs/compute-benchmarks.sh` |
| `compute-investor-dna` | `0 5 2 * *` | 30 | `infrastructure/vm-cron/jobs/compute-investor-dna.sh` |
| `digest-qa` | `50 * * * *` | 10 | `infrastructure/vm-cron/jobs/digest-qa.sh` |
| `health-report` | `45 0,4,8,12,16,20 * * *` | 10 | `infrastructure/vm-cron/jobs/health-report.sh` |
| `daily-observability` | `0 9 * * *` | 10 | `infrastructure/vm-cron/jobs/daily-observability.sh` |
| `slack-summary` | `0 14 * * *` | 10 | `infrastructure/vm-cron/jobs/slack-summary.sh` |
| `slack-commit-notify` | `*/2 * * * *` | 5 | `infrastructure/vm-cron/jobs/slack-commit-notify.sh` |
| `release-reconciler` | `*/5 * * * *` | 5 | `infrastructure/vm-cron/jobs/release-reconciler.sh` |
| `sync-data` | `0,30 * * * *` | 45 | `infrastructure/vm-cron/jobs/sync-data.sh` |
| `code-update` | `7,22,37,52 * * * *` | 45 | `infrastructure/vm-cron/deploy.sh` |
| `heartbeat` | `*/5 * * * *` | N/A (direct) | `infrastructure/vm-cron/monitoring/heartbeat.sh` |

### Triggered (not scheduled) jobs

| Job | Trigger |
|---|---|
| `frontend-deploy` | Called from `sync-data.sh`, `deploy.sh`, or manual runner invocation |
| `backend-deploy` | Called from `deploy.sh` or manual runner invocation |

## 8) Pipeline Maps

### A) News pipeline

1. `news-ingest.sh` applies news migrations and runs `python main.py ingest-news --lookback-hours 48`.
2. Ingest writes clusters/editions and memory-gate artifacts to Postgres.
3. `embed-backfill`, `signal-aggregate`, `research-topics`, and brief jobs enrich downstream outputs.
4. `news-digest.sh` sends regional digests (`global`, `turkey`) with per-run delivery metrics + Slack summary.

### B) Event -> deep research pipeline

1. `event-processor.sh` processes `startup_events` and enqueues eligible deep-research items.
2. `deep-research.sh` consumes queue with budget caps (`DEEP_RESEARCH_*` env controls).
3. Observability job tracks latency, linking quality, onboarding funnel, and spend.

### C) Dataset sync pipeline

1. `sync-data.sh` checks blob deltas.
2. Syncs to `apps/web/data/**`.
3. Validates/backfills taxonomy when needed.
4. Applies startup migrations and syncs `startups.csv` + `analysis_data` to Postgres.
5. Commits/pushes data changes.
6. Triggers `frontend-deploy` so web reflects new dataset.

## 9) Change Safety Checklist

Before merging production-impacting changes:

1. Confirm which control plane you are touching: VM cron vs GitHub workflow backup.
2. Keep `infrastructure/vm-cron/crontab` and `runner.sh` invariants intact (timeouts, locks, logs).
3. Do not remove API auth/header enforcement in `apps/api/src/index.ts`.
4. Keep health endpoints public and cheap.
5. For web changes, run:
   - `pnpm --filter web type-check`
   - `pnpm --filter web build`
6. For API changes, run:
   - `pnpm --filter @startup-investments/api build`
7. For pipeline/migration changes, validate migration application path in `infrastructure/vm-cron/jobs/apply-migrations.sh`.
8. If cron schedules change, update both:
   - `infrastructure/vm-cron/crontab`
   - this file (`docs/OPERATING_MODEL.md`)

## 10) Quick Incident Runbooks

### Dealbook/front pages are slow

1. Check API health:
   - `curl -i https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health`
2. If unhealthy, verify AKS power state and start if stopped:
   - `az aks show -g aistartuptr -n aks-aistartuptr --query powerState.code -o tsv`
   - `az aks start -g aistartuptr -n aks-aistartuptr`
3. Verify authenticated API dealbook path from server context.

### VM cron appears stuck

1. Check heartbeat/log freshness in `/var/log/buildatlas`.
2. Verify cron service on VM.
3. Check stale lock files under `/tmp/buildatlas-*.lock`.
4. Use `infrastructure/vm-cron/verify.sh` for sanity checks.

### Frontend or backend deployment drift

1. Check `release-reconciler` logs and Slack notifications.
2. For backend failures inspect `/var/log/buildatlas/backend-deploy.log`.
3. For frontend failures inspect `/var/log/buildatlas/frontend-deploy.log`.

## 11) Source-of-Truth Files

If you need to validate this document, start here:

- `infrastructure/vm-cron/crontab`
- `infrastructure/vm-cron/lib/runner.sh`
- `infrastructure/vm-cron/deploy.sh`
- `infrastructure/vm-cron/jobs/frontend-deploy.sh`
- `infrastructure/vm-cron/jobs/backend-deploy.sh`
- `infrastructure/vm-cron/jobs/sync-data.sh`
- `infrastructure/vm-cron/jobs/news-ingest.sh`
- `infrastructure/vm-cron/jobs/news-digest.sh`
- `.github/workflows/*.yml`
- `AGENTS.md`
