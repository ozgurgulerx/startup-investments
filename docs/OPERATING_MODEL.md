# BuildAtlas Operating Model

Last updated: 2026-03-07
Document owner: Platform/Operations
Review cadence: Monthly or immediately after architecture/deploy/schedule changes.

## 1) Purpose and Scope

This is the canonical operations reference for:
- architecture and production dependencies,
- deployment surfaces and release flow,
- cron jobs and data/news pipelines,
- change safety and incident response.

If this file conflicts with an older doc, use this file plus the linked source scripts.

## 2) Source-of-Truth Hierarchy

Use this priority order when debugging drift:

1. Runtime code and scripts:
  - `infrastructure/vm-cron/**`
  - `infrastructure/kubernetes/pipelines-*.yaml`
  - `apps/api/**`
  - `apps/web/**`
2. Schedules/workflow definitions:
  - `infrastructure/kubernetes/pipelines-cronjobs.yaml`
  - `infrastructure/azure/aks-uptime.bicep`
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
| Pipeline automation | AKS CronJobs (`buildatlas-pipelines`) | Internal | Primary scheduled jobs (news/events/digests/briefs/benchmarks) |
| Scheduled pipelines + ops | AKS CronJobs (`buildatlas-pipelines`) | Internal | News/events/digests plus crawl-frontier, global-analysis, sync-data, observability, release reconciliation |
| Uptime guard | Azure Automation | Internal | Starts AKS when stopped and verifies API health |
| Deploy orchestration | GitHub Actions | Internal | Frontend/backend/functions/pipelines deploy control plane |
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
  - `global-analysis` AKS CronJob -> Blob-backed period dataset + resumable `analysis_store` checkpoints -> `sync-data` AKS CronJob -> Postgres sync + frontend rebuild dispatch.
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
- Deploys use pinned artifacts:
  - no `:latest` tags in `infrastructure/kubernetes/**` (manifests use `__IMAGE_TAG__` placeholders patched at deploy time).
- Degradation mode is fallback only:
  - file-based dataset reads are a resilience mechanism, not steady-state.
- News subscription model:
  - double opt-in + token-based unsubscribe.

## 5) Control Planes and Deploy Surfaces

### Primary pipeline control plane: AKS CronJobs

Pipelines are deployed into AKS as CronJobs to avoid VM availability issues:

- Manifests:
  - `infrastructure/kubernetes/pipelines-configmap.yaml`
  - `infrastructure/kubernetes/pipelines-cronjobs.yaml`
- Image: `aistartuptr.azurecr.io/buildatlas-pipelines:<git-sha>` (pinned; CronJob manifest uses `__IMAGE_TAG__` patched at deploy time) (`infrastructure/pipelines/Dockerfile`)
- Secrets/config:
  - `Secret/buildatlas-pipelines-secrets` (keys are ENV var names so pods use `envFrom`)
  - `ConfigMap/buildatlas-pipelines-config` (non-secret runtime toggles)
  - Note: `kubectl create secret --from-env-file` does **not** parse shell quoting. Do not include surrounding quotes
    in secret values (e.g. `AZURE_OPENAI_ENDPOINT` must be `https://.../`, not `"https://.../"`), or Azure OpenAI
    calls will fail.
  - Azure OpenAI is AAD-only in production (`disableLocalAuth=true`). Pipelines must run with an identity that has the
    `Cognitive Services OpenAI User` role on the Azure OpenAI account scope (AKS defaults to the kubelet identity).
- Deploy:
  - GitHub Actions `deploy-pipelines.yml`

### Azure-native uptime guard (preferred)

AKS availability is primarily protected via an Azure Automation runbook (independent of GitHub schedules and VM cron):

- IaC: `infrastructure/azure/aks-uptime.bicep` (Automation Account + variables + schedule)
- Runbook: `infrastructure/azure/runbooks/aks-ensure-running.ps1`
- Deploy: apply the Bicep from an operator environment using `az deployment group create ...` (see `infrastructure/azure/aks-uptime.bicep` for params/variables).
- Slack: webhook is stored as an encrypted Automation variable `SLACK_WEBHOOK_URL` (runbook posts only on changes/failures)

### VM decommission status

`vm-buildatlas-cron` is decommissioned. Production ownership is split across:

- AKS CronJobs for recurring data/pipeline/ops execution,
- Azure Automation for AKS uptime,
- GitHub Actions for deploy orchestration and health checks.

The `infrastructure/vm-cron/**` paths remain in-repo because the AKS pipelines image reuses the shared shell jobs and runner.

### GitHub Actions

GitHub Actions is the primary CI/CD control plane for deploys and checks:

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | PR to `main` | Lint, typecheck, tests, build check |
| `deploy-backend.yml` | Push to `main` (`apps/api/**`, `packages/shared/**`) | Build API image, deploy to AKS, health check + rollback |
| `deploy-frontend.yml` | Push to `main` (`apps/web/**`, `packages/shared/**`) + `workflow_dispatch` | Hydrate Blob-backed datasets, build web image, deploy to App Service, smoke check |
| `deploy-pipelines.yml` | Push to `main` (`packages/analysis/**`, `scripts/**`, etc.) | Build pipeline images, apply CronJobs to AKS |
| `deploy-functions.yml` | Push to `main` (`infrastructure/azure-functions/**`) | Package and deploy Azure Functions |
| `migrations.yml` | Push to `main` (`database/migrations/**`) | Apply database migrations |
| `health-check.yml` | Every 15 min + `workflow_dispatch` | API and frontend health monitoring |

Authentication: Azure OIDC (federated credentials from GitHub to Azure AD app registration `github-actions-buildatlas`).

## 6) Configuration and Secrets Model

### Runtime secret sources

| Surface | Secret source | Notes |
|---|---|---|
| API pods | Kubernetes secret `startup-investments-secrets` | Refreshed in `backend-deploy.sh` |
| AKS ops CronJobs | Kubernetes secret `buildatlas-ops-secrets` | Ops-only scheduled tasks (keep isolated from API secrets) |
| AKS pipelines CronJobs | Kubernetes secret `buildatlas-pipelines-secrets` + configmap `buildatlas-pipelines-config` | Pipeline runtime env + toggles |
| App Service web | App settings | Set/updated in `frontend-deploy.sh` |

### Minimum required deploy secrets

- Backend deploy path:
  - `DATABASE_URL`, `API_KEY`, `ADMIN_KEY`, `FRONT_DOOR_ID`.
- Frontend deploy path:
  - `DATABASE_URL`, `API_KEY`, auth/email vars as required by deployed features.

## 7) Shared Runner Operations

Primary schedule source: `infrastructure/kubernetes/pipelines-cronjobs.yaml` (UTC).

### Wrapper guarantees (`infrastructure/vm-cron/lib/runner.sh`)

- env sourcing,
- per-job lock files (`/tmp/buildatlas-<job>.lock`),
- timeout enforcement,
- structured log routing (`/var/log/buildatlas/<job>.log`),
- Azure CLI state isolation per job run (`AZURE_CONFIG_DIR`) to avoid cross-job races,
- Slack lifecycle notifications.

### Logging and telemetry

- AKS job logs: `kubectl logs job/<name>`
- Drift/availability alerts: Azure Automation uptime guard + GitHub `health-check.yml` + AKS `product-canary` + release reconciliation + browser canary.

## 7.1) AKS Ops CronJobs

Some ops tasks run as AKS CronJobs to avoid VM availability issues.

- PostHog usage summary:
  - Resource: `CronJob/posthog-usage-summary` (namespace `default`)
  - Schedule: `0 */3 * * *` (UTC)
  - Manifest: `infrastructure/kubernetes/posthog-usage-cronjob.yaml`
  - Image: `aistartuptr.azurecr.io/buildatlas-ops:<git-sha>` (pinned; manifest uses `__IMAGE_TAG__` patched at deploy time) (from `infrastructure/ops/Dockerfile`)
  - Secret: `Secret/buildatlas-ops-secrets` with:
    - `slack-webhook-url`
    - `posthog-project-id`
    - `posthog-personal-api-key`
    - optional: `posthog-host`
  - Deploy (primary): GitHub Actions `deploy-pipelines.yml` builds `buildatlas-ops` and applies the rendered CronJob manifests.
  - Deploy (manual fallback): apply `infrastructure/kubernetes/posthog-usage-cronjob.yaml` from an operator environment that can reach the AKS control plane, patching `__IMAGE_TAG__` to a concrete image tag.
  - One-off run:
    - `kubectl create job -n default --from=cronjob/posthog-usage-summary posthog-usage-summary-manual-<id>`

- PostHog exceptions alerts:
  - Resource: `CronJob/posthog-exceptions-alerts` (namespace `default`)
  - Schedule: `*/30 * * * *` (UTC)
  - Manifest: `infrastructure/kubernetes/posthog-exceptions-cronjob.yaml`
  - Image: `aistartuptr.azurecr.io/buildatlas-ops:<git-sha>` (pinned; manifest uses `__IMAGE_TAG__` patched at deploy time) (from `infrastructure/ops/Dockerfile`)
  - Secret: `Secret/buildatlas-ops-secrets` (same keys as usage summary)
  - Reliability behavior:
    - Best-effort telemetry: if PostHog times out / is temporarily unavailable, the job logs a warning and exits `0` (to avoid noisy failed Jobs).
    - Query knobs: `POSTHOG_TIMEOUT_SEC`, `POSTHOG_RETRIES` (set in the manifest).
  - Deploy: same as PostHog usage summary (via `deploy-pipelines.yml`, or manual apply)

- Browser canary (Landscapes):
  - Resource: `CronJob/browser-canary-landscapes` (namespace `default`)
  - Schedule: `*/15 * * * *` (UTC)
  - Manifest: `infrastructure/kubernetes/playwright-canary-cronjob.yaml`
  - Image: `aistartuptr.azurecr.io/buildatlas-playwright-canary:<git-sha>` (pinned; manifest uses `__IMAGE_TAG__` patched at deploy time) (from `infrastructure/ops/playwright-canary/Dockerfile`)
  - Secret: `Secret/buildatlas-ops-secrets` with:
    - `slack-webhook-url`
  - Retry knobs (set in the manifest): `UI_MAX_ATTEMPTS`, `GOTO_MAX_ATTEMPTS`
  - Deploy (primary): GitHub Actions `deploy-pipelines.yml` builds `buildatlas-playwright-canary` and applies the rendered CronJob manifest.
  - Deploy (manual fallback): apply `infrastructure/kubernetes/playwright-canary-cronjob.yaml` from an operator environment that can reach the AKS control plane, patching `__IMAGE_TAG__` to a concrete image tag.

## 7.2) AKS Pipelines CronJobs

Pipeline jobs that do not depend on VM state (no Azure CLI, no git working tree, no local cursors)
run in AKS as CronJobs.

- Manifests:
  - `infrastructure/kubernetes/pipelines-configmap.yaml`
  - `infrastructure/kubernetes/pipelines-cronjobs.yaml`
- Image: `aistartuptr.azurecr.io/buildatlas-pipelines:<git-sha>` (pinned; manifest uses `__IMAGE_TAG__` patched at deploy time; VM layout under `/opt/buildatlas/...` to reuse scripts)
- Runner semantics: uses `infrastructure/vm-cron/lib/runner.sh` for locks/timeouts + Slack lifecycle notifications.

## 8) Cron Schedule Inventory (UTC)

This inventory is derived from `infrastructure/kubernetes/pipelines-cronjobs.yaml`.
`keep-alive` is owned separately by Azure Automation, and the legacy VM-only `health-report` / `heartbeat`
checks are retired.

### Scheduled jobs

| Job | Schedule (UTC) | Timeout (min) | Script |
|---|---|---:|---|
| `news-ingest` | `15 * * * *` | 30 | `infrastructure/vm-cron/jobs/news-ingest.sh` |
| `x-trends` | `28 * * * *` | 20 | `infrastructure/vm-cron/jobs/x-trends.sh` |
| `event-processor` | `5,20,35,50 * * * *` | 10 | `infrastructure/vm-cron/jobs/event-processor.sh` |
| `deep-research` | `12,27,42,57 * * * *` | 20 | `infrastructure/vm-cron/jobs/deep-research.sh` |
| `investor-onboarding` | `8,38 * * * *` | 15 | `infrastructure/vm-cron/jobs/investor-onboarding.sh` |
| `onboarding-alerts` | `*/2 * * * *` | 5 | `infrastructure/vm-cron/jobs/onboarding-alerts.sh` |
| `crawl-frontier` | `0,30 * * * *` | 40 | `infrastructure/vm-cron/jobs/crawl-frontier.sh` |
| `research-topics` | `40 * * * *` | 10 | `infrastructure/vm-cron/jobs/research-topics.sh` |
| `investigate-seeds` | `50 */2 * * *` | 15 | `infrastructure/vm-cron/jobs/investigate-seeds.sh` |
| `news-digest` | `45 * * * *` | 15 | `infrastructure/vm-cron/jobs/news-digest.sh` |
| `x-post-generate` | `35 */4 * * *` | 10 | `infrastructure/vm-cron/jobs/x-post-generate.sh` |
| `x-post-publish` | `55 * * * *` | 10 | `infrastructure/vm-cron/jobs/x-post-publish.sh` |
| `x-post-metrics` | `20 */6 * * *` | 10 | `infrastructure/vm-cron/jobs/x-post-metrics.sh` |
| `weekly-brief` | `0 6 * * 1` | 20 | `infrastructure/vm-cron/jobs/weekly-brief.sh` |
| `generate-weekly-digest` | `35 6 * * 1` | 15 | `infrastructure/vm-cron/jobs/generate-weekly-digest.sh` |
| `monthly-brief` | `0 6 1 * *` | 20 | `infrastructure/vm-cron/jobs/monthly-brief.sh` |
| `embed-backfill` | `25 * * * *` | 15 | `infrastructure/vm-cron/jobs/embed-backfill.sh` |
| `signal-aggregate` | `30 */4 * * *` | 10 | `infrastructure/vm-cron/jobs/signal-aggregate.sh` |
| `delta-generate` | `38 */4 * * *` | 15 | `infrastructure/vm-cron/jobs/delta-generate.sh` |
| `generate-alerts` | `48 */4 * * *` | 15 | `infrastructure/vm-cron/jobs/generate-alerts.sh` |
| `deep-dive-generate` | `15 5 * * *` | 45 | `infrastructure/vm-cron/jobs/deep-dive-generate.sh` |
| `deep-dive-catchup` | `58 */4 * * *` | 30 | `infrastructure/vm-cron/jobs/deep-dive-catchup.sh` |
| `dealbook-brief` | `0 4 * * *` | 15 | `infrastructure/vm-cron/jobs/dealbook-brief.sh` |
| `neighbors-benchmarks` | `0 7 * * 4` | 60 | `infrastructure/vm-cron/jobs/neighbors-benchmarks.sh` |
| `compute-benchmarks` | `0 4 2 * *` | 30 | `infrastructure/vm-cron/jobs/compute-benchmarks.sh` |
| `compute-investor-dna` | `0 5 2 * *` | 30 | `infrastructure/vm-cron/jobs/compute-investor-dna.sh` |
| `digest-qa` | `50 */3 * * *` | 10 | `infrastructure/vm-cron/jobs/digest-qa.sh` |
| `product-canary` | `17,47 * * * *` | 5 | `infrastructure/vm-cron/jobs/product-canary.sh` |
| `daily-observability` | `0 9 * * *` | 10 | `infrastructure/vm-cron/jobs/daily-observability.sh` |
| `onboarding-eod-report` | `0 20 * * *` | 10 | `infrastructure/vm-cron/jobs/onboarding-eod-report.sh` |
| `slack-summary` | `0 */3 * * *` | 10 | `infrastructure/vm-cron/jobs/slack-summary.sh` |
| `slack-commit-notify` | `*/2 * * * *` | 5 | `infrastructure/vm-cron/jobs/slack-commit-notify.sh` |
| `release-reconciler` | `*/5 * * * *` | 5 | `infrastructure/vm-cron/jobs/release-reconciler.sh` |
| `global-analysis` | `10,40 * * * *` | 20 | `infrastructure/vm-cron/jobs/global-analysis.sh` |
| `sync-data` | `0,30 * * * *` | 45 | `infrastructure/vm-cron/jobs/sync-data.sh` |

Notes:
- `theinformation-headlines` is intentionally unscheduled while source fetch reliability is being hardened; run manually via `infrastructure/vm-cron/jobs/seed-theinformation-headlines.sh` when needed.
- `onboarding-eod-report` runs as an AKS CronJob and can also email the same report (best-effort) when `RESEND_API_KEY` + `METRICS_REPORT_EMAIL_TO` are configured.

### Triggered (not scheduled) jobs

| Job | Trigger |
|---|---|
| deploy-backend.yml | Push to `main` (`apps/api/**`, `packages/shared/**`) or `workflow_dispatch` |
| deploy-frontend.yml | Push to `main` (`apps/web/**`, `packages/shared/**`), `workflow_dispatch`, or `sync-data.sh` via `gh workflow run` |
| deploy-functions.yml | Push to `main` (`infrastructure/azure-functions/**`) or `workflow_dispatch` |
| deploy-pipelines.yml | Push to `main` (analysis/scripts/infra paths) or `workflow_dispatch` |
| migrations.yml | Push to `main` (`database/migrations/**`) or `workflow_dispatch` |

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
- hourly ingest cadence + GitHub/AKS monitoring.

### B) Event -> deep research pipeline

Entry points:
- `infrastructure/vm-cron/jobs/event-processor.sh`
- `infrastructure/vm-cron/jobs/deep-research.sh`
- `infrastructure/vm-cron/jobs/onboarding-alerts.sh`

Flow:
1. Event processor consumes startup events and enqueues deep-research candidates.
2. Deep-research consumer processes queue with budget/cap controls.
3. Actionable onboarding/deep-research trace events are dispatched to Slack.
4. Operators can add manual context and optionally requeue deep research.
5. Results inform onboarding and downstream insights.

Key risk controls:
- budget guard envs (`DEEP_RESEARCH_*`),
- actionable trace dedupe/ack via `onboarding_trace_events`,
- periodic observability report,
- queue schema migrations applied before processing.

### B2) Crawl frontier pipeline

Entry point:
- `infrastructure/vm-cron/jobs/crawl-frontier.sh`

Flow:
1. Apply crawl migrations.
2. Process refresh jobs (`startup_refresh_jobs`) to boost priority for event-affected startups.
3. Run **chunked frontier seed** only when needed:
   - when forced (`CRAWL_FRONTIER_FORCE_SEED=true`),
   - when resuming cursor state,
   - or when interval elapsed (`CRAWL_FRONTIER_SEED_INTERVAL_HOURS`, default 6h).
4. Persist/advance seed cursor in `pipeline_runtime_state` (file fallback only if DB is unavailable).
5. Run frontier worker (`src.crawl_runtime.worker`) every cycle.

Key risk controls:
- seed is fail-open (worker still runs if seed fails/times out),
- bounded seed chunk budgets (`CRAWL_FRONTIER_SEED_MAX_STARTUPS`, `CRAWL_FRONTIER_SEED_MAX_SECONDS`),
- adaptive frontier lease/requeue behavior in runtime.

### C) Signal deep-dive pipeline

Entry points:
- `infrastructure/vm-cron/jobs/signal-aggregate.sh`
- `infrastructure/vm-cron/jobs/deep-dive-generate.sh`
- `infrastructure/vm-cron/jobs/deep-dive-catchup.sh`

Flow:
1. Aggregate events into signals on the 4-hour cadence.
2. `deep-dive-catchup` backfills **missing** deep dives (coverage-first, trend-only synthesis) so `/signals/[id]` isn't empty.
3. Apply migrations (`apply-migrations.sh news`) before deep-dive generation.
4. Compute per-startup occurrences (deterministic).
5. `deep-dive-generate` upgrades a rotating set of top signals (moves + synthesis) and writes version diffs.

Key risk controls:
- migration preflight in `deep-dive-generate.sh`,
- graceful API degradation when deep-dive tables are unavailable,
- dedicated daily job timeout budget (45 minutes).
- catchup job is bounded (`--limit`) and enqueues a small, capped number of startups; deep research spend is capped by `DEEP_RESEARCH_*` envs in the consumer.

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
2. Confirm the relevant GitHub Actions deploy workflow succeeds.
3. Confirm runtime health and AKS CronJob status:
   - `gh run list --workflow deploy-backend.yml --limit 1`
   - `gh run list --workflow deploy-frontend.yml --limit 1`
   - `kubectl get cronjobs,jobs -n default`
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
  - redeploy a known good commit/image via GitHub Actions or App Service container rollback.
- Data:
  - use Blob-backed period artifacts plus the `sync-data` path carefully.

Always prefer restoring service availability first, then perform root-cause analysis.

## 11) Incident Response Model

### Severity guide

- `SEV1`: User-facing outage or major data integrity risk.
- `SEV2`: Significant degradation with workaround.
- `SEV3`: Partial degradation or internal tooling failure.

### First 10 minutes checklist

1. Confirm symptom with direct checks (`/health`, frontend HTTP status).
2. Identify failing layer (web, edge, AKS, DB, cron, pipeline).
3. Check latest relevant GitHub Actions logs, `kubectl logs`, and admin monitoring endpoints.
4. Mitigate quickly (restart/redeploy/start stopped service).
5. Post incident status in Slack.

### High-frequency incidents and first actions

| Incident | First action |
|---|---|
| Frontend slow due API fallback | Verify API health and AKS power state; restore API path |
| API unreachable | Check AKS state and rollout health; verify secrets/header invariants |
| Cron jobs stale | Check `kubectl get cronjobs,jobs`, CronJob events, and `product-canary` / `release-reconciler` signals |
| Data not refreshing | Inspect `sync-data` / `global-analysis` job logs, Blob period artifacts, and the triggered frontend deploy |
| Digest not sending | Inspect `news-digest` job logs and email env variables |

## 12) Change Management and Safe Delivery

Before merging production-impacting changes:

1. Identify impacted control plane(s): AKS CronJobs, Azure Automation, GitHub Actions, runtime service(s).
2. Validate invariants in Section 4.
3. Run area-specific checks:
   - web: `pnpm --filter web type-check` and `pnpm --filter web build`
   - api: `pnpm --filter @startup-investments/api build`
   - pipeline: relevant `packages/analysis` dry-run/health checks
4. For migration changes:
   - ensure idempotent behavior,
   - ensure inclusion in `apply-migrations.sh` path.
5. For cron changes:
   - update `infrastructure/kubernetes/pipelines-cronjobs.yaml`,
   - update this document,
   - run doc drift check script.
6. Update docs in same PR when behavior/ops expectations change.

Detailed checklist: `docs/CHANGE_CONTROL.md`.

## 13) Documentation Drift Guard

Run this before merging schedule-related changes:

```bash
./scripts/verify-operating-model.sh
```

This checks that CronJob names in `infrastructure/kubernetes/pipelines-cronjobs.yaml` are represented in `docs/OPERATING_MODEL.md`.
Treat this script as the canonical guardrail (also runnable via `pnpm ops:verify-docs`).

## 14) Canonical Files for Validation

- `infrastructure/kubernetes/pipelines-cronjobs.yaml`
- `infrastructure/vm-cron/lib/runner.sh`
- `.github/workflows/deploy-frontend.yml`
- `.github/workflows/deploy-backend.yml`
- `.github/workflows/deploy-pipelines.yml`
- `infrastructure/vm-cron/jobs/sync-data.sh`
- `infrastructure/vm-cron/jobs/news-ingest.sh`
- `infrastructure/vm-cron/jobs/news-digest.sh`
- `AGENTS.md`
