# BuildAtlas Operating Model

Last updated: 2026-02-13
Document owner: Platform/Operations
Review cadence: Monthly or immediately after architecture/deploy/schedule changes.

## 1) Purpose and Scope

This is the canonical operations reference for:
- architecture and production dependencies,
- deployment surfaces and release flow,
- cron jobs and data/news pipelines,
- change safety and incident response.

If this file conflicts with an older doc, use this file plus the linked source scripts/workflows.

## 2) Source-of-Truth Hierarchy

Use this priority order when debugging drift:

1. Runtime code and scripts:
   - `infrastructure/vm-cron/**`
   - `apps/api/**`
   - `apps/web/**`
2. Schedules/workflow definitions:
   - `infrastructure/vm-cron/crontab`
   - `.github/workflows/*.yml`
3. Operational memory and invariants:
   - `AGENTS.md`
4. Human-friendly summaries:
   - `docs/README.md`
   - `docs/claude/*.md`

## 3) Production Architecture

### Service catalog

| Service | Runtime | Public entrypoint | Primary responsibility |
|---|---|---|---|
| Web frontend | Azure App Service | `https://buildatlas.net` | Next.js 14 SSR/CSR application |
| API edge | Azure Front Door | `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net` | Public API edge, health routing path |
| API backend | AKS (`startup-investments-api`) | Front Door-routed | Core API, admin routes, data access |
| Primary data store | Azure Postgres Flexible Server | Private | Application and pipeline state |
| Cache (optional) | Azure Redis | Internal | API response caching |
| Automation control plane | Azure VM cron (`vm-buildatlas-cron`) | Internal | Primary scheduled jobs and deploy automation |
| Image build/registry | Azure Container Registry | Internal | Remote image builds for web/api |
| Dataset ingress | Azure Blob Storage | Internal | Source of `apps/web/data/**` sync jobs |

### Primary request path

1. Browser -> `buildatlas.net` (App Service).
2. Server-side web layer -> API via Front Door.
3. Front Door -> AKS API.
4. API -> Postgres (+ Redis if configured).
5. If API is unhealthy, web can degrade to file-based reads from `apps/web/data/**`.

### Critical dependency chains

- Product experience chain:
  - App Service -> Front Door -> AKS API -> Postgres.
- Data freshness chain:
  - Blob data -> `sync-data` cron -> Postgres + `apps/web/data/**` commit -> `frontend-deploy`.
- News delivery chain:
  - `news-ingest` -> enrich/cluster -> `news-digest` -> subscriber delivery.

## 4) Security and Reliability Invariants

Do not break these:

- API routing/auth:
  - production routes enforce Front Door ID header (`x-azure-fdid`) where configured,
  - `/api/*` requires `x-api-key`,
  - `/api/admin/*` requires `x-admin-key`.
- Health endpoints remain public and lightweight:
  - `/health`, `/healthz`, `/readyz`.
- Secrets are server-side only:
  - never expose `API_KEY` or `ADMIN_KEY` in browser-executed code.
- Degradation mode is fallback only:
  - file-based dataset reads are a resilience mechanism, not steady-state.
- News subscription model:
  - double opt-in + token-based unsubscribe.

## 5) Control Planes and Deploy Surfaces

### Primary control plane: VM cron

`infrastructure/vm-cron/deploy.sh` (`code-update` job) is the default release orchestrator.

- Pulls latest `main` every 15 minutes.
- Reinstalls cron if drift is detected.
- Triggers:
  - `backend-deploy.sh` for API/shared/k8s changes.
  - `frontend-deploy.sh` for web/shared changes.
  - `functions-deploy.sh` for `infrastructure/azure-functions/**` and `packages/analysis/**` changes.
- Applies migrations when migration files changed.

### Backup/manual control plane: GitHub Actions

| Workflow | Role |
|---|---|
| `frontend-deploy.yml` | Manual backup deploy |
| `backend-deploy.yml` | Manual backup deploy |
| `news-ingest.yml` | Manual backup run |
| `news-digest-daily.yml` | Manual backup run |
| `keep-aks-alive.yml` | Manual backup keep-alive |
| `keep-aks-running.yml` | Manual backup keep-alive |
| `sync-data.yml` | Manual/repository_dispatch backup |
| `slack-daily-summary.yml` | Manual backup summary |
| `crawl-frontier.yml` | Manual run (schedule disabled) |
| `functions-deploy.yml` | Manual backup deploy (VM `functions-deploy.sh` is primary) |
| `sync-to-database.yml` | Manual backup only (VM `sync-data.sh` is primary) |
| `slack-commit-notify.yml` | Manual backup only (VM `slack-commit-notify.sh` is primary) |
| `vm-watchdog.yml` | Active scheduled VM safety net |
| `vm-cron-slack-notify.yml` | Active dispatch receiver |

## 6) Configuration and Secrets Model

### Runtime secret sources

| Surface | Secret source | Notes |
|---|---|---|
| VM cron jobs | `/etc/buildatlas/.env` | Loaded by `runner.sh` |
| API pods | Kubernetes secret `startup-investments-secrets` | Refreshed in `backend-deploy.sh` |
| App Service web | App settings | Set/updated in `frontend-deploy.sh` |
| GitHub workflows | Repository secrets/variables | Backup and selected active automations |

### Minimum required deploy secrets

- Backend deploy path:
  - `DATABASE_URL`, `API_KEY`, `ADMIN_KEY`, `FRONT_DOOR_ID`.
- Frontend deploy path:
  - `DATABASE_URL`, `API_KEY`, auth/email vars as required by deployed features.

## 7) VM Cron Operations

Source schedule: `infrastructure/vm-cron/crontab` (all UTC).

### Wrapper guarantees (`infrastructure/vm-cron/lib/runner.sh`)

- env sourcing,
- per-job lock files (`/tmp/buildatlas-<job>.lock`),
- timeout enforcement,
- structured log routing (`/var/log/buildatlas/<job>.log`),
- Slack lifecycle notifications.

### Git race prevention

Git operations across cron jobs are serialized via `/tmp/buildatlas-git.lock`.

### Logging and telemetry

- Job logs: `/var/log/buildatlas/*.log`
- VM health telemetry: `/var/log/buildatlas/heartbeat.log`
- Drift/availability alerts: heartbeat + release reconciler + health report + Slack dispatch.

## 8) Cron Schedule Inventory (UTC)

### Scheduled jobs

| Job | Schedule (UTC) | Timeout (min) | Script |
|---|---|---:|---|
| `keep-alive` | `*/15 * * * *` | 20 | `infrastructure/vm-cron/jobs/keep-alive.sh` |
| `news-ingest` | `15 * * * *` | 30 | `infrastructure/vm-cron/jobs/news-ingest.sh` |
| `x-trends` | `28 * * * *` | 20 | `infrastructure/vm-cron/jobs/x-trends.sh` |
| `event-processor` | `5,20,35,50 * * * *` | 10 | `infrastructure/vm-cron/jobs/event-processor.sh` |
| `deep-research` | `12,27,42,57 * * * *` | 20 | `infrastructure/vm-cron/jobs/deep-research.sh` |
| `crawl-frontier` | `0,30 * * * *` | 25 | `infrastructure/vm-cron/jobs/crawl-frontier.sh` |
| `research-topics` | `40 * * * *` | 10 | `infrastructure/vm-cron/jobs/research-topics.sh` |
| `news-digest` | `45 * * * *` | 15 | `infrastructure/vm-cron/jobs/news-digest.sh` |
| `x-post-generate` | `35 */4 * * *` | 10 | `infrastructure/vm-cron/jobs/x-post-generate.sh` |
| `x-post-publish` | `55 * * * *` | 10 | `infrastructure/vm-cron/jobs/x-post-publish.sh` |
| `x-post-metrics` | `20 */6 * * *` | 10 | `infrastructure/vm-cron/jobs/x-post-metrics.sh` |
| `weekly-brief` | `0 6 * * 1` | 20 | `infrastructure/vm-cron/jobs/weekly-brief.sh` |
| `monthly-brief` | `0 6 1 * *` | 20 | `infrastructure/vm-cron/jobs/monthly-brief.sh` |
| `embed-backfill` | `25 * * * *` | 15 | `infrastructure/vm-cron/jobs/embed-backfill.sh` |
| `signal-aggregate` | `30 */4 * * *` | 10 | `infrastructure/vm-cron/jobs/signal-aggregate.sh` |
| `deep-dive-generate` | `15 5 * * *` | 45 | `infrastructure/vm-cron/jobs/deep-dive-generate.sh` |
| `dealbook-brief` | `0 4 * * *` | 15 | `infrastructure/vm-cron/jobs/dealbook-brief.sh` |
| `neighbors-benchmarks` | `0 7 * * 4` | 60 | `infrastructure/vm-cron/jobs/neighbors-benchmarks.sh` |
| `compute-benchmarks` | `0 4 2 * *` | 30 | `infrastructure/vm-cron/jobs/compute-benchmarks.sh` |
| `compute-investor-dna` | `0 5 2 * *` | 30 | `infrastructure/vm-cron/jobs/compute-investor-dna.sh` |
| `digest-qa` | `50 * * * *` | 10 | `infrastructure/vm-cron/jobs/digest-qa.sh` |
| `health-report` | `45 0,4,8,12,16,20 * * *` | 10 | `infrastructure/vm-cron/jobs/health-report.sh` |
| `daily-observability` | `0 9 * * *` | 10 | `infrastructure/vm-cron/jobs/daily-observability.sh` |
| `slack-summary` | `0 */3 * * *` | 10 | `infrastructure/vm-cron/jobs/slack-summary.sh` |
| `slack-commit-notify` | `*/2 * * * *` | 5 | `infrastructure/vm-cron/jobs/slack-commit-notify.sh` |
| `release-reconciler` | `*/5 * * * *` | 5 | `infrastructure/vm-cron/jobs/release-reconciler.sh` |
| `sync-data` | `0,30 * * * *` | 45 | `infrastructure/vm-cron/jobs/sync-data.sh` |
| `code-update` | `7,22,37,52 * * * *` | 45 | `infrastructure/vm-cron/deploy.sh` |
| `heartbeat` | `*/5 * * * *` | N/A (direct) | `infrastructure/vm-cron/monitoring/heartbeat.sh` |

### Triggered (not scheduled) jobs

| Job | Trigger |
|---|---|
| `frontend-deploy` | Called by `sync-data.sh`, `deploy.sh`, or manual runner invocation |
| `backend-deploy` | Called by `deploy.sh` or manual runner invocation |
| `functions-deploy` | Called by `deploy.sh` or manual runner invocation |

## 9) Pipeline Maps

### A) News pipeline

Entry points:
- `infrastructure/vm-cron/jobs/news-ingest.sh`
- `infrastructure/vm-cron/jobs/news-digest.sh`

Flow:
1. Apply relevant migrations.
2. Ingest/fetch/cluster/enrich editions.
3. Persist clusters, facts, and editions to Postgres.
4. Send digest per region with per-run metrics and Slack summary.

Key risk controls:
- migration idempotency in `apply-migrations.sh`,
- digest metrics reporting for sent/skipped/failed,
- hourly ingest cadence + keep-alive/health-report monitoring.

### B) Event -> deep research pipeline

Entry points:
- `infrastructure/vm-cron/jobs/event-processor.sh`
- `infrastructure/vm-cron/jobs/deep-research.sh`

Flow:
1. Event processor consumes startup events and enqueues deep-research candidates.
2. Deep-research consumer processes queue with budget/cap controls.
3. Results inform onboarding and downstream insights.

Key risk controls:
- budget guard envs (`DEEP_RESEARCH_*`),
- periodic observability report,
- queue schema migrations applied before processing.

### C) Signal deep-dive pipeline

Entry points:
- `infrastructure/vm-cron/jobs/signal-aggregate.sh`
- `infrastructure/vm-cron/jobs/deep-dive-generate.sh`

Flow:
1. Aggregate events into signals on the 4-hour cadence.
2. Apply migrations (`apply-migrations.sh news`) before deep-dive generation.
3. Compute per-startup occurrences.
4. Generate/update deep-dive documents and diffs.

Key risk controls:
- migration preflight in `deep-dive-generate.sh`,
- graceful API degradation when deep-dive tables are unavailable,
- dedicated daily job timeout budget (45 minutes).

### D) Dataset sync pipeline

Entry point:
- `infrastructure/vm-cron/jobs/sync-data.sh`

Flow:
1. Check blob diffs.
2. Sync to `apps/web/data/**`.
3. Validate/backfill taxonomy if incomplete.
4. Sync startups + analysis JSON to Postgres.
5. Commit/push dataset updates.
6. Trigger `frontend-deploy`.

Key risk controls:
- git lock serialization,
- DB sync even in no-change windows (sentinel logic),
- migration application before DB writes.

### E) X/Twitter trend + posting pipeline

Entry points:
- `infrastructure/vm-cron/jobs/x-trends.sh`
- `infrastructure/vm-cron/jobs/x-post-generate.sh`
- `infrastructure/vm-cron/jobs/x-post-publish.sh`
- `infrastructure/vm-cron/jobs/x-post-metrics.sh`

Flow:
1. Fetch recent X search results (global + turkey query packs) into `news_items_raw`.
2. Reuse news clustering/ranking pipeline so X signals affect edition composition.
3. Generate queue entries in `x_post_queue` from top clusters.
4. Publish queued items via X API with cap/cooldown controls.
5. Sync post metrics into `x_post_metrics_daily`.

Key risk controls:
- posting feature gate (`X_POSTING_ENABLED`),
- daily cap + spacing (`X_MAX_POSTS_PER_DAY`, `X_MIN_POST_INTERVAL_MINUTES`),
- dedupe key + retry ceiling (`X_POST_DEDUPE_DAYS`, `X_POST_MAX_ATTEMPTS`).

## 10) Release Process, Verification, and Rollback

### Standard release path

1. Merge to `main`.
2. Wait for `code-update` cron (or run manual job).
3. Confirm deploy logs:
   - `/var/log/buildatlas/frontend-deploy.log`
   - `/var/log/buildatlas/backend-deploy.log`
4. Verify health:
   - `curl -i https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health`
   - `curl -I https://buildatlas.net`

### Fast verification checklist

- API health returns `200`.
- Frontend returns `200`.
- Release reconciler reports no sustained drift.
- No repeated failure loops in relevant job logs.

### Rollback guidelines

- Backend:
  - automatic rollback is attempted by `backend-deploy.sh` when health checks fail.
  - if needed manually: set previous image on deployment and monitor rollout.
- Frontend:
  - redeploy a known good commit/image via VM deploy path.
- Data:
  - use git history for `apps/web/data/**` and rerun `sync-data` path carefully.

Always prefer restoring service availability first, then perform root-cause analysis.

## 11) Incident Response Model

### Severity guide

- `SEV1`: User-facing outage or major data integrity risk.
- `SEV2`: Significant degradation with workaround.
- `SEV3`: Partial degradation or internal tooling failure.

### First 10 minutes checklist

1. Confirm symptom with direct checks (`/health`, frontend HTTP status).
2. Identify failing layer (web, edge, AKS, DB, cron, pipeline).
3. Check latest relevant logs under `/var/log/buildatlas/`.
4. Mitigate quickly (restart/redeploy/start stopped service).
5. Post incident status in Slack.

### High-frequency incidents and first actions

| Incident | First action |
|---|---|
| Frontend slow due API fallback | Verify API health and AKS power state; restore API path |
| API unreachable | Check AKS state and rollout health; verify secrets/header invariants |
| Cron jobs stale | Check cron service, heartbeat alerts, and lock files |
| Data not refreshing | Inspect `sync-data.log`, git push status, and triggered frontend deploy |
| Digest not sending | Inspect `news-digest.log` metrics and email env variables |

## 12) Change Management and Safe Delivery

Before merging production-impacting changes:

1. Identify impacted control plane(s): VM cron, workflows, runtime service(s).
2. Validate invariants in Section 4.
3. Run area-specific checks:
   - web: `pnpm --filter web type-check` and `pnpm --filter web build`
   - api: `pnpm --filter @startup-investments/api build`
   - pipeline: relevant `packages/analysis` dry-run/health checks
4. For migration changes:
   - ensure idempotent behavior,
   - ensure inclusion in `apply-migrations.sh` path.
5. For cron changes:
   - update `infrastructure/vm-cron/crontab`,
   - update this document,
   - run doc drift check script.
6. Update docs in same PR when behavior/ops expectations change.

Detailed checklist: `docs/CHANGE_CONTROL.md`.

## 13) Documentation Drift Guard

Run this before merging schedule-related changes:

```bash
./scripts/verify-operating-model.sh
```

This checks that cron job names in `infrastructure/vm-cron/crontab` are represented in `docs/OPERATING_MODEL.md`.
It is also enforced in CI by `.github/workflows/ops-doc-consistency.yml`.

## 14) Canonical Files for Validation

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
