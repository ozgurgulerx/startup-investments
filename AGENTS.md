# Build Atlas Agent Notes (Do Not Delete)

This file is the "memory" for humans and coding agents working in this repo.
Keep it current. When you make an architectural change, change a workflow, or
introduce a new invariant/secret, update this file in the same PR/commit.

Goals:
- Prevent context loss between dev runs.
- Make recovery/debug of "site is slow/down" deterministic.
- Avoid accidental changes that break deploys, auth, or data pipelines.

Last verified: 2026-02-13

## Documentation Source of Truth

Before changing deploy/ops/schedule behavior, read in this order:
- `docs/OPERATING_MODEL.md` (canonical operating model)
- `docs/CHANGE_CONTROL.md` (release/change checklist)
- `infrastructure/vm-cron/crontab` (actual schedule)

When cron schedules change, update docs in the same commit and run:
- `./scripts/verify-operating-model.sh`

## Repo Map

- `apps/web`: Next.js 14 App Router frontend (Azure App Service, Next standalone build).
- `apps/api`: Express + Drizzle backend (AKS).
- `packages/shared`: Shared TS types used by web/api.
- `packages/analysis`: Python analysis/automation tooling used by workflows (news ingest/digest, etc).
- `database/migrations`: SQL migrations for Postgres.
- `infrastructure/kubernetes`: AKS manifests.
- `.github/workflows`: CI/CD and scheduled automation.

## Production Architecture (What Talks To What)

- Public site: `https://buildatlas.net` (App Service running Next.js standalone output).
- Public API entrypoint: Azure Front Door endpoint:
  - `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net`
- Backend compute: AKS (`startup-investments-api` deployment, 1-5 replicas via HPA).
- Data store: Azure Postgres Flexible Server (private access in prod environment).
- Optional cache: Azure Redis (API response caching).

Request path (typical):
- Browser -> App Service (Next.js) -> Server-side fetch -> API via Front Door -> AKS -> Postgres (+ Redis).

Important headers/invariants:
- API in production enforces Front Door routing:
  - `x-azure-fdid` must match `FRONT_DOOR_ID` for most non-health endpoints.
- API in production enforces auth:
  - `x-api-key` must match `API_KEY` for `/api/*` (except health and logo).
  - `x-admin-key` must match `ADMIN_KEY` for `/api/admin/*`.
  - Watchlist intelligence endpoints (`/api/v1/subscriptions`, `/api/v1/alerts*`) also require
    `x-user-id` (UUID) per request to scope results to a single user.
- Health endpoints are intentionally public:
  - `/health`, `/healthz`, `/readyz` are not API-key protected.
  - `/health`, `/healthz`, `/readyz` include `build_sha` for release reconciliation.

## Critical Invariants (Don’t Break These)

- Do not expose `API_KEY` or `ADMIN_KEY` to the browser.
  - Web uses `process.env.API_KEY` only in Server Components / API routes.
- Keep `/health` cheap and reachable (Front Door probe + diagnostics).
- Keep the API deployable when AKS is running:
  - `backend-deploy.yml` must be able to connect to the AKS control plane.
- Avoid making `/dealbook` depend on slow file-based reads in steady state:
  - When API is down, web falls back to file reads; this is a degradation mode.
- Keep `packages/analysis/src/automation/__init__.py` import-light (no eager imports of optional heavy deps like `openai`).
  - Cron jobs import `src.automation.*` submodules; an import-time crash here can take down unrelated jobs (e.g. `event-processor`).
- News email subscriptions are **double opt-in**:
  - New signups are stored as `pending_confirmation` and must be activated via the emailed confirmation link.
  - Unsubscribe is token-based (`GET /api/news/subscriptions?token=...`); do not add raw email-based unsubscribe endpoints.
- Web watchlist-intelligence API proxies must forward identity:
  - `apps/web/app/api/subscriptions/route.ts` and `apps/web/app/api/alerts/**` resolve NextAuth session and pass
    `X-User-Id` to backend; missing this causes 401s and empty watchlist intelligence UI.
- News reaction identity precedence:
  - `apps/web/app/api/news/signals/**` uses `user_id` when signed in; anonymous users use `ba_anon_id` cookie fallback.
- Community feature migration + routing invariants:
  - Migration `database/migrations/062_community_features.sql` introduces:
    - `users.reputation_points`, `users.trust_level`
    - `signal_thread_posts`, `signal_thread_votes`
    - `signal_polls`, `signal_poll_votes`
    - `shared_watchlists`, `shared_watchlist_members`, `shared_watchlist_items`
    - `user_notification_preferences`
  - VM migration runner must include `062_community_features.sql` in both `news` and `startups` sets
    (`infrastructure/vm-cron/jobs/apply-migrations.sh`) so community features are available regardless
    of which periodic pipeline applies migrations first.
  - Community UI surface is the Signal Deep Dive `Community` tab:
    - `apps/web/app/(app)/signals/[id]/community-tab.tsx`
  - Notification hygiene preferences are enforced at web API boundary in:
    - `apps/web/app/api/alerts/route.ts` (filters muted delta types and low-severity alerts).
- Signals recommendation invariants:
  - Backend recommender (`apps/api/src/services/signals.ts`) is now `signals_v2_graph_memory`:
    watchlist overlap + capital graph overlap (`capital_graph_edges`) + memory-gate strength (`news_item_decisions`).
  - Recommendation reason types exposed to web:
    `watchlist_overlap`, `graph_investor_overlap`, `memory_momentum`, `high_impact_fallback`.
  - Degradation rule: if graph/memory tables are unavailable, recommender must still return results (impact-based fallback), not fail the endpoint.

## CI/CD Workflows (Source of Truth)

Primary automation is now **VM cron** (cost control) and GitHub Actions workflows are kept as **manual backups**.

VM cron runner:
- Config: `infrastructure/vm-cron/crontab`
- Wrapper (locks, timeouts, logs, structured Slack lifecycle events): `infrastructure/vm-cron/lib/runner.sh`
- Code updater (git pull + triggers deploys): `infrastructure/vm-cron/deploy.sh`
- Release drift monitor (desired vs live SHA): `infrastructure/vm-cron/jobs/release-reconciler.sh`
- One-time setup/bootstrap (packages, venv, logrotate, crontab): `infrastructure/vm-cron/setup.sh`
- VM sanity checks (cron service + crontab contents): `infrastructure/vm-cron/verify.sh`
- Logs: `/var/log/buildatlas/*.log` on the VM (see `scripts/slack_daily_summary.py` for parsing expectations)
  - `crawl-frontier` runs every 30 minutes with a **40 minute** runner timeout (`runner.sh crawl-frontier 40 ...`) to avoid recurring timeout kills during large frontier seeding windows.
  - `crawl-frontier` now uses **chunked resumable seeding**:
    - full reseed is not attempted on every cycle,
    - seed runs on interval (`CRAWL_FRONTIER_SEED_INTERVAL_HOURS`, default 6h) or resume cursor,
    - state files live under `/var/lib/buildatlas` (`crawl-frontier.seed.cursor`, `crawl-frontier.seed.last`),
    - worker execution still proceeds if seed chunk fails/times out.
  - Frontier telemetry:
    - Each frontier URL crawl attempt is persisted to `crawl_logs` (with `canonical_url`, `fetch_method`, `proxy_tier`, `error_category`, and optional `capture_id`) so `/api/admin/monitoring/frontier` can report 24h success/error rates.
    - If `crawl_logs` is empty (older deployments), monitoring falls back to `crawl_frontier_urls.last_*` fields as an approximation.
  - Raw captures (WARC-lite):
    - `crawl_raw_captures` stores envelope metadata for replay and optionally uploads the compressed body to Blob Storage under `crawl-snapshots/raw-captures/...`.
    - If Blob upload auth is misconfigured (e.g., `AuthorizationFailure`), the worker **fail-opens**: it disables further blob uploads for that run (to avoid log spam) and continues recording DB metadata with `body_blob_path=NULL`.
  - Seed chunk controls are env-driven:
    - `CRAWL_FRONTIER_SEED_LIMIT` (DB batch read, default 5000)
    - `CRAWL_FRONTIER_SEED_MAX_STARTUPS` (per-run processed startups, default 500)
    - `CRAWL_FRONTIER_SEED_MAX_SECONDS` (per-run seed budget, default 600)
    - `CRAWL_FRONTIER_SEED_TIMEOUT_MIN` (wrapper timeout, default 20)
    - optional force run: `CRAWL_FRONTIER_FORCE_SEED=true`
  - Daily `slack-summary` now includes subscription lifecycle metrics (created/confirmed/unsubscribed in 24h),
    segment breakdown (`region` × `digest_frequency`), masked newly-confirmed subscriber emails, and digest
    delivery totals by region.
  - `slack-summary` also includes a backend activity snapshot for the last 3 hours:
    news ingest run outcomes, region-scoped news/edition updates, onboarding attempt activity, and deep-research queue movement.
  - Optional site-usage block comes from PostHog when `POSTHOG_PROJECT_ID` + (`POSTHOG_PERSONAL_API_KEY` or
    `POSTHOG_API_KEY`) are set on the VM (`POSTHOG_HOST` defaults to `NEXT_PUBLIC_POSTHOG_HOST` / `us.i.posthog.com`).
  - PostHog key separation (important):
    - `POSTHOG_PROJECT_API_KEY` (`phc_...`) is the ingestion key used by browser SDK and server `/capture` calls.
    - `POSTHOG_PERSONAL_API_KEY` (`phx_...`) is the admin/query key used for HogQL/API (dashboards, alerts, summaries).
    - Do not expose personal keys in `NEXT_PUBLIC_*` settings.
  - Optional daily metrics email runs from the same job (`scripts/slack_daily_summary.py`) via Resend:
    - `METRICS_REPORT_EMAIL_TO` (comma-separated recipients) enables email send.
    - `METRICS_REPORT_EMAIL_FROM` overrides sender (defaults to `NEWS_DIGEST_FROM_EMAIL`).
    - `METRICS_REPORT_EMAIL_SUBJECT_PREFIX` prepends email subject.
    - Delivery is best-effort: Slack summary still posts if email send fails.
  - Optional daily subscriber list email can also run from `scripts/slack_daily_summary.py` via Resend (PII):
    - `SUBSCRIBER_LIST_EMAIL_TO` (comma-separated recipients) enables send.
    - `SUBSCRIBER_LIST_SEND_AT_UTC_HOUR` / `SUBSCRIBER_LIST_SEND_AT_UTC_MINUTE` set the earliest send time (UTC).
    - `SUBSCRIBER_LIST_STATUS` / `SUBSCRIBER_LIST_REGION` filter the export.
    - Default behavior masks emails; set `SUBSCRIBER_LIST_INCLUDE_FULL_EMAILS=true` only for trusted internal recipients.
  - Schedule: `slack-summary` runs every 3 hours at minute `:00` UTC (`0 */3 * * *`).
  - AKS fallback (VM-independent): `posthog-usage-summary` CronJob posts the same PostHog usage block to Slack:
    - Manifest: `infrastructure/kubernetes/posthog-usage-cronjob.yaml`
    - Image: `aistartuptr.azurecr.io/buildatlas-ops:latest` (built from `infrastructure/ops/Dockerfile`)
    - Secrets: Kubernetes `buildatlas-ops-secrets` (`slack-webhook-url`, `posthog-project-id`, `posthog-personal-api-key`, optional `posthog-host`)
    - Deploy: `.github/workflows/ops-posthog-usage-deploy.yml` (manual `workflow_dispatch`)
- VM time: the VM is configured to `Etc/UTC` and `infrastructure/vm-cron/crontab` times are **UTC** (Istanbul is `UTC+3`).
- Git safety: git operations across cron jobs are serialized via `/tmp/buildatlas-git.lock` to avoid races (e.g. `code-update` vs `slack-commit-notify`).
- DB migration safety: `apply-migrations.sh` serializes DDL via `/tmp/buildatlas-db-migrations.lock` (configurable via `BUILDATLAS_MIGRATIONS_LOCK_FILE` + `BUILDATLAS_MIGRATIONS_LOCK_WAIT_SECONDS`) to avoid cron-induced deadlocks when multiple jobs start together.
- VM access (for manual deploy/debug):
  - Preferred: `./infrastructure/vm-cron/ssh-update-ip.sh`
    - Auto-discovers the VM’s NIC/subnet NSGs and creates/updates an `AllowSSH` rule to your current public IP, then SSHs into the VM.
  - Manual SSH:
    - Get IP: `AZURE_CLI_DISABLE_LOGFILE=1 az vm show -g aistartuptr -n vm-buildatlas-cron --show-details --query publicIps -o tsv`
    - Connect: `ssh buildatlas@<vm_ip>`
  - No-SSH option (run a command remotely):
    - `AZURE_CLI_DISABLE_LOGFILE=1 az vm run-command invoke -g aistartuptr -n vm-buildatlas-cron --command-id RunShellScript --scripts "<cmd>" --query "value[0].message" -o tsv`
    - If it returns `(Conflict) Run command extension execution is in progress`, use SSH instead (RunCommand can get stuck busy).
- Slack notifications:
  - Set `SLACK_WEBHOOK_URL` (or legacy `SLACK_WEBHOOK`) in `/etc/buildatlas/.env`.
  - Optional success notifications for selected jobs via `SLACK_NOTIFY_SUCCESS_JOBS` (see `infrastructure/vm-cron/.env.example`). In production we typically keep this as a high-signal subset (often excluding `keep-alive` / `crawl-frontier`) to avoid spam; add them if you want “continuous” Slack pings.
  - Optional start notifications via `SLACK_NOTIFY_START_JOBS` (default: `frontend-deploy,backend-deploy,functions-deploy,sync-data,code-update,news-digest`).
  - Runner sends structured context (`event_type`, `phase`, `run_id`, `job`, `sha`, `duration_sec`, `exit_code`, `log`) in `SLACK_CONTEXT_JSON`.
  - Commit notifications (primary path):
    - VM cron job `slack-commit-notify` (see `infrastructure/vm-cron/jobs/slack-commit-notify.sh`) polls `origin/main` and posts Slack notifications.
    - Cursor file is stored under `/var/lib/buildatlas/slack-commit-notify.main.last` (or `$REPO_DIR/.tmp` fallback).
  - GitHub Actions backup:
    - `.github/workflows/slack-commit-notify.yml` is manual backup only (`workflow_dispatch`).
    - Opt-out per commit: include `[skip slack]` (or `[no-slack]`) in the commit message.
  - If you **don't** want Slack webhooks on the VM, `scripts/slack_notify.py` can fall back to GitHub `repository_dispatch`:
    - Requires `GITHUB_TOKEN` + `GITHUB_REPOSITORY` on the VM.
    - GitHub workflow handler: `.github/workflows/vm-cron-slack-notify.yml` (uses repo secret `SLACK_WEBHOOK_URL`).
    - Dispatch fallback is only used when `BUILDATLAS_RUNNER=vm-cron` (set by `runner.sh` and `heartbeat.sh`).
    - If GitHub Actions is blocked/disabled (billing/spending limits), dispatch fallback will not deliver; set a VM webhook instead.
  - Quick test (GitHub -> Slack):
    - `gh workflow run vm-cron-slack-notify.yml -f title="Slack test" -f status=info -f body="Hello from GitHub Actions"`
    - Then verify it ran: `gh run list --workflow vm-cron-slack-notify.yml -L 5`
    - If it fails, inspect: `gh run view <run_id> --log-failed`
  - VM debugging:
    - Slack-post failures are appended into the job log (e.g. `/var/log/buildatlas/news-ingest.log`) and `heartbeat.log`.
  - Release reconciliation state:
    - Cursor/state file: `/var/lib/buildatlas/release-reconciler.state` (or `$REPO_DIR/.tmp` fallback).
    - Drift reminders are controlled by `RELEASE_RECONCILE_ALERT_AFTER_MINUTES` and `RELEASE_RECONCILE_REMINDER_MINUTES`.

Frontend:
- `.github/workflows/frontend-deploy.yml`
  - Manual backup only (`workflow_dispatch`).
  - VM job: `infrastructure/vm-cron/jobs/frontend-deploy.sh` (deploys to App Service `buildatlas-web`).

Backend:
- `.github/workflows/backend-deploy.yml`
  - Manual backup only (`workflow_dispatch`).
  - VM job: `infrastructure/vm-cron/jobs/backend-deploy.sh` (ACR remote build + `kubectl apply`).
  - Common failure modes:
    - Missing secrets (`ADMIN_KEY`, etc).
    - AKS control plane unreachable if the cluster is stopped.

Functions:
- `.github/workflows/functions-deploy.yml`
  - Manual backup only (`workflow_dispatch`).
  - VM fallback job: `infrastructure/vm-cron/jobs/functions-deploy.sh` (zip deploy + health check).
  - Auto-triggered by VM `code-update` when `infrastructure/azure-functions/**` or `packages/analysis/**` changes.

Uptime automation:
- `.github/workflows/keep-aks-running.yml`
  - Intent: keep Postgres + AKS running, then verify API health.
  - Note: this workflow historically failed due to Azure RBAC; it should not be treated as a guarantee.
- `.github/workflows/keep-aks-alive.yml`
  - Intent: AKS-first watchdog (runs every 15 min). Starts AKS if stopped and verifies API health.
  - This is the primary "prevent cluster stopped -> API 504" guardrail.

News:
- Manual backups:
  - `.github/workflows/news-ingest.yml`
  - `.github/workflows/news-digest-daily.yml`
- VM jobs:
  - `infrastructure/vm-cron/jobs/news-ingest.sh`
  - `infrastructure/vm-cron/jobs/news-digest.sh`
  - `news-digest.sh` now posts per-run delivery totals to Slack (`sent/skipped/failed` for global+turkey).
- X/Twitter trend + posting automation:
  - Migration: `database/migrations/061_x_social_automation.sql`
  - Trend sources are now first-class in news ingest:
    - `x_recent_search_global`
    - `x_recent_search_turkey`
  - Runtime modules:
    - `packages/analysis/src/automation/x_client.py` (X API search/post/metrics)
    - `packages/analysis/src/automation/x_trends.py` (query-pack based trend fetch)
    - `packages/analysis/src/automation/x_posting.py` (queue + publish + metrics sync)
  - CLI commands:
    - `python main.py ingest-x-trends --lookback-hours 24`
    - `python main.py generate-x-posts --region all --max-items 6`
    - `python main.py publish-x-posts --max-items 5`
    - `python main.py sync-x-post-metrics --days-back 7 --max-posts 100`
  - VM jobs:
    - `infrastructure/vm-cron/jobs/x-trends.sh`
    - `infrastructure/vm-cron/jobs/x-post-generate.sh`
    - `infrastructure/vm-cron/jobs/x-post-publish.sh`
    - `infrastructure/vm-cron/jobs/x-post-metrics.sh`
  - Safety invariants:
    - Set `X_POSTING_ENABLED=true` only after credentials + dry-runs are validated.
    - Posting pipeline enforces daily cap (`X_MAX_POSTS_PER_DAY`) and spacing (`X_MIN_POST_INTERVAL_MINUTES`).
    - Queue dedupe key prevents repeated posting of the same cluster/link.
- Signal deep dives:
  - Migration: `database/migrations/050_signal_deep_dives.sql`
  - VM job: `infrastructure/vm-cron/jobs/deep-dive-generate.sh` (runs daily at `05:15 UTC` via cron).
  - Deployment invariant:
    - `050_signal_deep_dives.sql` must be included in VM migration sets used by news pipelines (`news`, `news-digest`) in `infrastructure/vm-cron/jobs/apply-migrations.sh`.
    - `deep-dive-generate.sh` runs migration preflight (`apply-migrations.sh news`) before computing occurrences/generating deep dives.
  - Runtime degradation behavior:
    - If deep-dive tables are unavailable, backend deep-dive endpoints should return empty payloads (not crash) so `/signals/[id]` can show "No deep dive available yet" instead of failing hard.
  - Coverage behavior (important for "empty deep dive" debugging):
    - Deep-dive generation prefers per-startup samples from `signal_occurrences` (requires startup-linked evidence).
    - If a signal cannot produce a per-startup sample set (e.g., evidence is mostly `startup_id=NULL` or too sparse), the pipeline falls back to a **trend-only deep dive** synthesized from recent `signal_evidence` rows.
      - These deep dives may have `sample_count=0` and should be treated as "trend-level" (no startup case studies/watchlist unless startups are explicitly linked).
    - Backend `GET /api/v1/signals/:id/deep-dive` includes best-effort `meta` diagnostics (`startups_eligible`, `unlinked_evidence_count`, `occurrences_total`, `latest_status`) to help explain why a deep dive is missing.
- Daily brief + LLM enrichment (news):
  - Controlled by `NEWS_LLM_ENRICHMENT=true` (and optional `NEWS_LLM_DAILY_BRIEF=true`) in `/etc/buildatlas/.env`.
  - Intel headline mode is controlled by `INTEL_FIRST_PROMPT=true` (recommended ON in prod VM). When enabled, cards prefer `news_clusters.ba_title`/`ba_bullets`/`why_it_matters`.
  - Intel mode runs with strict source-review validation: enrichment must return `reviewed_source_count` + `reviewed_source_urls` covering all cluster members, otherwise intel fields are rejected and previous DB values are preserved (`COALESCE` upsert behavior).
  - "Why It Matters" under each news story card comes from `news_clusters.builder_takeaway` (server-fetched via backend `/api/v1/news`). If `builder_takeaway` is empty/NULL, the UI will not render that block.
  - Implementation: `packages/analysis/src/automation/news_ingest.py` enriches clusters via Azure OpenAI; for GPT-5 deployments it prefers the Responses API (`responses.create` + strict JSON schema) and falls back to Chat Completions.
  - Production Azure OpenAI may have **key auth disabled**. Prefer AAD via managed identity (requires `azure-identity` in the venv and RBAC on the Azure OpenAI resource).
  - Azure model selection uses **deployment names** (not raw model IDs):
    - Preferred: `AZURE_OPENAI_DEPLOYMENT_NAME` (e.g. `gpt-5-nano`)
    - Back-compat: `AZURE_OPENAI_DEPLOYMENT`
  - Verify in `/var/log/buildatlas/news-ingest.log`:
    - `[news-ingest] daily brief generated via Azure: "..."` and `Daily brief: generated`.
- Memory-Gated Editorial Intelligence (Phase 1: entity linking + fact extraction):
  - Migration: `database/migrations/023_memory_system.sql`
  - Runtime: `packages/analysis/src/automation/memory_gate.py` (zero-LLM; regex + DB lookups)
  - Ingest integration: `packages/analysis/src/automation/news_ingest.py` runs the memory gate after clustering and persists results after cluster IDs are created.
  - Deployment invariant:
    - VM cron `news-ingest` runs `apply-migrations.sh news`; ensure `023_memory_system.sql` is included in the `news` migration set (see `infrastructure/vm-cron/jobs/apply-migrations.sh`).
    - If the migration is not applied, the pipeline will log `[memory_gate] Load failed (tables may not exist yet)` and skip memory persistence (graceful degradation).
  - One-time rollout (prod VM):
    - Apply migrations (after code update): `infrastructure/vm-cron/jobs/apply-migrations.sh news`
    - Trigger an ingest run: `infrastructure/vm-cron/lib/runner.sh news-ingest 30 infrastructure/vm-cron/jobs/news-ingest.sh`
    - Optional backfill (last N days): `cd packages/analysis && python main.py memory-backfill --days 30 --dry-run` then re-run without `--dry-run`.
  - Verification queries (DB):
    - Tables exist:
      - `SELECT to_regclass('public.news_entity_facts'), to_regclass('public.news_item_extractions');`
    - Memory stats on latest ingestion runs:
      - `SELECT started_at, stats_json->'memory' AS memory FROM news_ingestion_runs ORDER BY started_at DESC LIMIT 3;`
    - Extractions / facts are being written:
      - `SELECT COUNT(*) FROM news_item_extractions;`
      - `SELECT COUNT(*) FROM news_entity_facts WHERE is_current = TRUE;`

- News-driven startup onboarding (active):
  - Ingest hook: `packages/analysis/src/automation/news_ingest.py` calls `onboard_unknown_startups(...)` for unlinked startup entities.
  - Ordering invariant: onboarding runs before funding-round + graph upserts inside `_extract_events(...)`, so newly discovered startups can be connected to funding events and investor graph edges in the same ingest run.
  - Stub creation behavior:
    - Inserts startup rows with `onboarding_status='stub'` (not immediately visible in Dealbook/company API).
    - Attempts website inference from cluster evidence URLs and stores inferred website when confidence is sufficient.
    - Writes attempt telemetry to `startup_onboarding_attempts` (migration: `database/migrations/058_onboarding_pipeline_activation.sql`).
  - Event/crawl/research chain:
    - `onboard_unknown_startups` enqueues refresh jobs (`reason='news_onboard'`) → `crawl-frontier` processes them.
    - VM cron `event-processor` runs `main.py process-events` (gated enqueue to `deep_research_queue`).
    - VM cron `deep-research` runs `main.py consume-deep-research` (Azure chat-based worker).
    - VM cron `onboarding-alerts` runs `main.py dispatch-onboarding-alerts` (near-real-time Slack notifications for actionable trace events).
  - Trace + context tables (migration: `database/migrations/063_onboarding_trace_and_context.sql`):
    - `onboarding_trace_events` stores onboarding/deep-research lifecycle events + Slack notification state.
    - `startup_onboarding_context` stores operator-provided context used to enrich deep-research prompts.
  - Slack follow-up path:
    - Helper payload template: `GET /api/v1/onboarding/context-template`
    - Context submit + optional requeue: `POST /api/admin/v1/onboarding/context` (`x-admin-key` required)
  - Deep research budget gates (VM env):
    - `DEEP_RESEARCH_ENABLED`
    - `DEEP_RESEARCH_MAX_DAILY_USD`
    - `DEEP_RESEARCH_MAX_MONTHLY_USD`
    - `DEEP_RESEARCH_MAX_ITEMS_PER_RUN`
    - `DEEP_RESEARCH_MIN_EVENT_CONFIDENCE`
    - `DEEP_RESEARCH_MIN_CRAWL_SUCCESS_RATE`
    - `ONBOARDING_ALERTS_ENABLED`
    - `ONBOARDING_ALERTS_BATCH_SIZE`
  - Visibility invariant:
    - Backend `GET /api/v1/dealbook`, `GET /api/v1/dealbook/filters`, and `GET /api/v1/companies/:slug` are **verified-only** (`onboarding_status='verified'`).
    - `merged`/`stub`/`rejected` startups are excluded from those surfaces.
  - Promotion to verified:
    - On successful deep-research completion, stub startups with website + successful crawl are promoted to `verified`.
    - `sync-startups-to-db.py` and `populate-analysis-data.py` also promote `stub -> verified` for curated/analysis-backed records.
  - Quick checks:
    - Stub/verified counts:
      - `SELECT onboarding_status, COUNT(*) FROM startups GROUP BY onboarding_status ORDER BY onboarding_status;`
    - New onboarding attempts:
      - `SELECT attempted_at, entity_name, region, stage, success, reason FROM startup_onboarding_attempts ORDER BY attempted_at DESC LIMIT 20;`
    - Trace events:
      - `SELECT occurred_at, trace_type, stage, status, severity, reason_code, should_notify, notified_at FROM onboarding_trace_events ORDER BY occurred_at DESC LIMIT 30;`
    - Human context additions:
      - `SELECT created_at, startup_id, source, created_by FROM startup_onboarding_context ORDER BY created_at DESC LIMIT 20;`
    - Deep research spend caps:
      - `SELECT COALESCE(SUM(cost_usd) FILTER (WHERE completed_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')),0) AS daily_usd, COALESCE(SUM(cost_usd) FILTER (WHERE completed_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')),0) AS monthly_usd FROM deep_research_queue WHERE status='completed';`

## Startups: Vertical Taxonomy + Dealbook Filters

We store startup "vertical/subvertical" in two forms:
- Legacy (flat strings): `vertical`, `sub_vertical`, `sub_sub_vertical`
- Versioned taxonomy (preferred): `analysis_data.vertical_taxonomy` (IDs + labels + full path)

Where taxonomy is produced:
- Classifier: `packages/analysis/src/analysis/genai_detector.py`
- Ontology: `packages/analysis/src/ontology/startup_vertical_ontology_v1.json`
- Output: written into each analysis JSON as `vertical_taxonomy` (see `packages/shared/src/types/index.ts` -> `StartupAnalysis.vertical_taxonomy`)

Where taxonomy is stored for queryability:
- Postgres column: `startups.analysis_data` (JSONB)
- Indexes for fast filtering: `database/migrations/019_startup_vertical_taxonomy_indexes.sql`

Backend API support:
- Dealbook list endpoint supports both:
  - `vertical` (legacy exact-match, normalized)
  - `verticalId`, `subVerticalId`, `leafId` (taxonomy IDs; pulled from `analysis_data.vertical_taxonomy.primary.*`)
- Brief snapshot generation (`apps/api/src/services/brief.ts`) now includes taxonomy-derived vertical context:
  - `verticalLandscape.topVerticals` and `verticalLandscape.topSubVerticals` (funding/deal/startup mix)
  - Each landscape item can include `prevPctOfFunding` and `deltaPp` (vs previous period)
  - `topDeals[*].vertical/subVertical` and `spotlight.vertical/subVertical` for brief UI labeling
  - `capitalGraph` pulse block (connected investor/founder/startup counts + top connected investors/founders + period edge additions)
  - Brief UI (`apps/web/components/features/intelligence-brief.tsx`) renders:
    - a vertical section with links into taxonomy filters and representative deals/signals cards
    - a `Capital Graph Pulse` section with links to `/capital?tab=investors` and investor dossiers

Materialization step (required for DB-driven filters):
- The analysis pipeline writes JSON files under `apps/web/data/<period>/output/analysis_store/base_analyses/*.json`.
- To make taxonomy filterable via the backend, we must copy those JSON blobs into Postgres:
  - Command: `python scripts/populate-analysis-data.py --period YYYY-MM`
- Primary automation:
  - VM cron `sync-data` runs `apply-migrations.sh startups` and then `populate-analysis-data.py` after syncing blob data.
  - GitHub fallback: `.github/workflows/sync-to-database.yml` applies required migrations and runs `populate-analysis-data.py`.
  - Guardrail: `scripts/check-vertical-taxonomy.py` validates `vertical_taxonomy.primary.vertical_id/label` is present; VM `sync-data` will attempt `scripts/backfill-vertical-taxonomy.py --only-incomplete` and re-check before pushing.

Quick verification (run on the DB):
- Count rows with taxonomy:
  - `SELECT COUNT(*) FROM startups WHERE analysis_data->'vertical_taxonomy' IS NOT NULL;`
- Spot-check a company:
  - `SELECT slug, analysis_data->'vertical_taxonomy' FROM startups WHERE slug = '<slug>';`

## Capital Graph (Investors + Founders)

New schema (migration set: `startups` + `benchmarks`):
- `database/migrations/059_capital_graph_founders.sql`
  - `founders`, `founder_aliases`, `startup_founders`, `investor_aliases`, `capital_graph_edges`
  - Materialized views:
    - `mv_investor_portfolio_current`
    - `mv_startup_investors_current`
  - Refresh function: `SELECT refresh_capital_graph_views();`
- `database/migrations/060_graph_extension_optional.sql`
  - Attempts `CREATE EXTENSION age`; continues safely if unavailable.

Storage model/invariants:
- Entities are canonical (`investors`, `founders`) with alias tables for identity resolution.
- Graph edges live in `capital_graph_edges` with region partition (`global`/`turkey`), provenance (`source`, `source_ref`, `created_by`), and date validity (`valid_from`, `valid_to`).
- Active edges are represented by `valid_to='9999-12-31'`.
- Graph extension is optional; SQL edge tables are the production fallback.

Backend API (new):
- Public:
  - `GET /api/v1/investors/:id/network`
  - `GET /api/v1/startups/:id/investors`
  - `GET /api/v1/startups/:id/founders`
  - `GET /api/v1/founders/:id`
- Admin (`x-admin-key` required):
  - `POST /api/admin/v1/investors/upsert`
  - `POST /api/admin/v1/founders/upsert`
  - `POST /api/admin/v1/graph-edges/upsert`
  - `POST /api/admin/v1/graph-edges/bulk`

Manual curation workflow:
- CLI sync script: `scripts/sync-capital-graph-to-db.py`
  - Supports CSV ingestion for investors/founders/edges/startup-founder links.
  - Flags: `--investors-csv`, `--founders-csv`, `--edges-csv`, `--startup-founders-csv`, `--region`, `--refresh-views`, `--dry-run`.
  - Uses direct Postgres upserts and alias-based resolution for non-UUID keys.
- XLSX bootstrap helper (startups.watch):
  - `scripts/extract-startups-watch-founders.py --xlsx <path> --region turkey|global|all --out-dir <dir>`
  - Outputs:
    - `founders.csv`
    - `edges.csv` (`founder --FOUNDED--> startup`)
    - `startup_founders.csv`

Automated news-driven updates (active):
- `packages/analysis/src/automation/news_ingest.py` now syncs graph edges during event extraction.
- Funding events with `lead_investor` are mapped into:
  - Investor upsert (stub investor if missing, type=`unknown`).
  - `capital_graph_edges` edge: `investor --LEADS_ROUND--> startup` (region-aware, source=`news_event`).
- Onboarding integration: unknown startups are onboarded first, then that same event batch is used for funding + graph sync.
- Materialized views refresh automatically once per ingest run when new graph edges are upserted.
- Feature flag: set `NEWS_GRAPH_SYNC_ENABLED=false` to disable graph sync without disabling news ingest.

Bulk/CSV onboarding integration (active):
- `scripts/sync-startups-to-db.py` projects CSV lead-investor data into `capital_graph_edges` (`investor --LEADS_ROUND--> startup`, source=`csv_sync`) and refreshes graph views when edges are written.
- Admin fallback API `POST /api/admin/sync-startups` now runs the same graph projection step after funding upserts (used by `.github/workflows/sync-to-database.yml`).

Quick checks:
- Graph tables exist:
  - `SELECT to_regclass('public.capital_graph_edges'), to_regclass('public.founders'), to_regclass('public.startup_founders');`
- Materialized views populated:
  - `SELECT COUNT(*) FROM mv_investor_portfolio_current;`
  - `SELECT COUNT(*) FROM mv_startup_investors_current;`
- Extension status (optional):
  - `SELECT extname FROM pg_extension WHERE extname='age';`

## Investor DNA (Screener)

The `/investors` UI is backed by monthly materialized tables (migration: `database/migrations/054_investor_dna.sql`):
- `investor_pattern_mix` (drives the screener list; latest month per `scope`)
- `investor_co_invest_edges` (drives top co-investors on profile pages when available)

Population model/invariants:
- Canonical source is `capital_graph_edges` (`investor --LEADS_ROUND--> startup`) filtered by month using:
  - `attrs_json.announced_date` when present
  - otherwise `valid_from`
- Legacy fallback (older environments only): `funding_rounds` + `investments` join.

Automation:
- VM cron job: `infrastructure/vm-cron/jobs/compute-investor-dna.sh` (scheduled in `infrastructure/vm-cron/crontab`)
- The job computes both **previous** and **current** month for `global` + `turkey` to avoid “empty month” behavior early in the month.

Quick checks:
- Is the screener table empty?
  - `SELECT scope, COUNT(*) AS rows, MAX(month) AS latest_month FROM investor_pattern_mix GROUP BY scope;`
- If empty, recompute for a period:
  - `cd packages/analysis && python main.py compute-investor-dna --period YYYY-MM --scope global`
  - `cd packages/analysis && python main.py compute-investor-dna --period YYYY-MM --scope turkey`

### News Regions (Global vs Turkey)

Daily news editions are **partitioned by region**:
- Canonical regions: `global`, `turkey`
- DB schema:
  - Editions/topic index: `database/migrations/020_news_editions_by_region.sql`
  - Region-aware clusters: `database/migrations/030_news_clusters_by_region.sql`
  - `news_sources.region` tags sources so Turkey editions can be built from Turkey-focused sources.
  - `news_daily_editions.region` partitions editions (`PRIMARY KEY (edition_date, region)`).
  - `news_topic_index.region` partitions topic browsing (`PRIMARY KEY (topic, cluster_id, edition_date, region)`).
  - `news_clusters.region` partitions cluster *representations* (`UNIQUE (cluster_key, region)`) so Turkey editions
    don't inherit global primary URL/title/source when clusters overlap.
- Ingest behavior (`packages/analysis/src/automation/news_ingest.py`):
  - Writes **both** `global` and `turkey` editions per run.
  - Turkey edition clusters are built from:
    - Turkey-tagged sources (e.g. Webrazzi, Egirisim) + Turkey startup-owned sources
    - Global sources only when the item has explicit Turkey context (to avoid translated/global chatter)
  - Minimal editorial reduction: clusters with gating decision `drop` are excluded from the Turkey edition.

Web/UI surfaces:
- Global feed: `/news` and `/news/[date]`
- Turkey feed: `/news/turkey` and `/news/turkey/[date]`
- Web API routes support `?region=global|turkey` (public, no API key in browser):
  - `/api/news/latest`, `/api/news`, `/api/news/topics`, `/api/news/archive`, `/api/news/sources`
- Backend API routes (server-to-server, cached in Redis when `REDIS_URL` is set):
  - `/api/v1/news/latest-date`
  - `/api/v1/news/latest`
  - `/api/v1/news` (supports `date`, `topic`, `limit`)
  - `/api/v1/news/topics`
  - `/api/v1/news/archive`
  - `/api/v1/news/sources`
- Implementation note:
  - `apps/web/lib/data/news.ts` must not query Postgres directly; it should call the backend (`apps/web/lib/api/client.ts` -> `NEXT_PUBLIC_API_URL` + server-side `API_KEY`).

## News Digest Runbook (Email)

The daily news email is a **separate pipeline** from ingestion:
- Ingest/build editions:
  - VM: `infrastructure/vm-cron/jobs/news-ingest.sh` (primary)
  - GitHub Actions: `.github/workflows/news-ingest.yml` (manual backup)
- Send email:
  - VM: `infrastructure/vm-cron/jobs/news-digest.sh` (primary)
  - GitHub Actions: `.github/workflows/news-digest-daily.yml` (manual backup)

Entry points:
- CLI: `cd packages/analysis && python main.py send-news-digest --region global|turkey|all`
- Code: `packages/analysis/src/automation/news_digest.py`

Required secrets/env (GitHub Actions):
- `DATABASE_URL`
- `RESEND_API_KEY`
- Optional: `NEWS_DIGEST_FROM_EMAIL`, `NEWS_DIGEST_REPLY_TO`, `PUBLIC_BASE_URL`

Common failure mode:
- **asyncpg DATE binding**: you must pass a Python `datetime.date` as the query argument for `edition_date`.
  - Symptom: `('str' object has no attribute 'toordinal')`
  - Fix: ensure `_resolve_edition_date()` returns `date` objects and DB calls use that date.
- **Missing subscriber timezone column** (timezone-aware sending):
  - Symptom: `column "timezone" does not exist`
  - Fix: apply `database/migrations/027_subscriber_timezone.sql` (VM: `infrastructure/vm-cron/jobs/apply-migrations.sh news-digest`)

Safe test mode:
- Use `dry_run` to validate the pipeline without sending emails or writing deliveries:
  - Manual dispatch: `gh workflow run \"Daily Startup News Digest\" -f region=all -f dry_run=true`
  - CLI: `cd packages/analysis && python main.py send-news-digest --region global --dry-run`

Debug commands:
- Latest runs:
  - `gh run list --workflow \"Daily Startup News Digest\" -L 5`
  - `gh run view <run_id> --log-failed`

## Watchlist Intelligence (Alerts + Digests)

Watchlist intelligence is a DB-driven pipeline that turns `delta_events` into a per-user alert feed
(`user_alerts`) and a weekly digest (`user_digest_threads`).

Schema/migrations:
- `database/migrations/051_delta_events.sql` (changefeed/movers feed)
- `database/migrations/055_watchlist_intelligence.sql` (subscriptions + alerts + digests)
- `database/migrations/065_watchlist_intelligence_dedupe.sql` (idempotency guards; unique indexes)

VM cron jobs:
- `infrastructure/vm-cron/jobs/delta-generate.sh` (every 4h, staggered after `signal-aggregate`)
- `infrastructure/vm-cron/jobs/generate-alerts.sh` (every 4h; materializes `user_alerts`)
- `infrastructure/vm-cron/jobs/generate-weekly-digest.sh` (Mondays 06:35 UTC; creates/updates digest threads)

LLM cost guardrail:
- Alert narratives are **disabled by default** in cron (`--no-narratives`) and can be enabled via:
  - `ALERT_NARRATIVES_ENABLED=true` in `/etc/buildatlas/.env`
  - The UI still shows a deterministic explanation block (`explain`) even without narratives.

## Blob Storage Auth (VM Cron)

Storage invariants:
- `buildatlasstorage` has **shared key access disabled** (`allowSharedKeyAccess=false`), so key-based auth
  via `AZURE_STORAGE_CONNECTION_STRING` will fail with `KeyBasedAuthenticationNotPermitted`.
- VM cron must use **managed identity** (AAD) for blob operations (`DefaultAzureCredential` in `BlobStorageClient`).
- The VM managed identity needs RBAC:
  - `Storage Blob Data Reader` (required for `sync-data` reads)
  - `Storage Blob Data Contributor` (required for raw-capture/snapshot writes)

Common failure mode:
- If the storage account has `publicNetworkAccess=Disabled` and there is no private endpoint/VNet routing,
  VM cron will not be able to reach the blob data-plane and jobs will log `AuthorizationFailure`.

## Secrets / Env Vars (What Must Exist)

GitHub Actions secrets (minimum):

Backend deploy (`backend-deploy.yml`):
- `DATABASE_URL`: Postgres connection string.
- `API_KEY`: required for all non-health API calls in production.
- `ADMIN_KEY`: required for `/api/admin/*` and backend deploy validation.
- `FRONT_DOOR_ID`: must match Front Door header `x-azure-fdid` in prod.
- `REDIS_URL`: optional; enables Redis caching.

Frontend deploy (`frontend-deploy.yml`):
- `DATABASE_URL`: used by web app for auth/data (server-side).
- `API_KEY`: used by web server-side requests to backend.
- `RESEND_API_KEY`: used by web to send subscription confirmation emails (double opt-in).
- `NEWS_DIGEST_FROM_EMAIL`, `NEWS_DIGEST_REPLY_TO`: used by web confirmation emails and digest sender.
- `PUBLIC_BASE_URL`: used to build absolute confirm/unsubscribe links in emails.
- `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.

Azure OIDC (Actions variables):
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`

Operational notes:
- `ADMIN_KEY` is not "provided by Azure". It is a strong random secret you set.
- If you rotate `API_KEY`/`ADMIN_KEY`, you must update both:
  - GitHub secrets (for workflows)
  - AKS secret (via backend deploy) and/or App Service settings (web)
- X/Twitter automation secrets/env (VM):
  - Required for trend ingest: `X_API_BEARER_TOKEN`
  - Required for posting: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`
  - Feature gates / guardrails:
    - `X_TRENDS_ENABLED`
    - `X_POSTING_ENABLED`
    - `X_MAX_POSTS_PER_DAY`
    - `X_MIN_POST_INTERVAL_MINUTES`
    - `X_POST_MAX_ATTEMPTS`
    - `X_POST_DEDUPE_DAYS`
  - Optional tuning:
    - `X_TRENDS_QUERY_PACK` (JSON string or file path with `global`/`turkey` queries)
    - `X_TRENDS_MAX_QUERIES_PER_RUN`, `X_TRENDS_MAX_PAGES_PER_QUERY`, `X_TRENDS_PAGE_SIZE`

## Regions & Datasets (Global vs Turkey)

Canonical dataset regions:
- `global`
- `turkey` (legacy alias `tr` is accepted in URLs/localStorage for backward compatibility)

Region selection mechanics:
- UI toggle persists to localStorage key `ba_region` and forces a Server Component re-render by updating `?region=...` in the URL.
- Region-aware pages: `/brief`, `/dealbook`, `/signals`, `/capital`, `/company/[slug]`.

On-disk data layout (file-based datasets):
- Global: `apps/web/data/{YYYY-MM}/...`
- Turkey: `apps/web/data/tr/{YYYY-MM}/...` (folder name stays `tr` for historical reasons)

API behavior and performance implications:
- Backend API is **region-aware** (`global` + `turkey`) via `startups.dataset_region`.
- The web app is **API-first** when configured (for both regions) and **falls back to files** when the API is unavailable or the DB is behind deployed datasets.
- VM cron `sync-data` keeps Postgres in sync with disk datasets (when `DATABASE_URL` is set):
  - Upsert `startups` + `funding_rounds` from `apps/web/data/**/input/startups.csv` via `scripts/sync-startups-to-db.py` (direct Postgres; avoids Front Door timeouts on admin HTTP sync)
  - The same CSV sync pass also upserts lead-investor graph edges into `capital_graph_edges` and refreshes materialized views when needed.
  - Populate `startups.analysis_data` from `analysis_store` via `scripts/populate-analysis-data.py --region ...`

Quick checks:
- `GET /api/periods?region=turkey` should return TR periods when `apps/web/data/tr/**` is deployed.
- `/dealbook?region=turkey` should render non-empty dossiers if TR data exists for the latest period.

## Performance Notes (Why Dossiers Can Be Slow)

Dealbook and signals pages are "API-first, fallback-to-files":
- Web data loader: `apps/web/lib/data/index.ts`
  - `getStartupsPaginated()` tries `api.getDealbook()` first, then falls back to file-based filtering.
  - When the API is unhealthy or returns non-200, pages may load but become much slower.
- API client: `apps/web/lib/api/client.ts`
  - Default timeout is 30s. If the API is failing, this can add latency before fallback.

Dealbook filtering:
- Backend endpoint: `GET /api/v1/dealbook` supports `stage`, `pattern`, `continent`, `vertical`, `minFunding`, `maxFunding`, `usesGenai`, `search` (+ pagination/sort).
- Filter metadata endpoint: `GET /api/v1/dealbook/filters` returns `stages`, `continents`, `patterns`, `verticals`.

File-based fallback cost:
- Reads many JSON files from `apps/web/data/**/output/analysis_store/...`
  - This is acceptable as a fallback, not as the normal path.

## Runbooks (Fast Debugging)

### "Dossiers/Dealbook are slow"
1. Check API health:
   - `curl -i https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health`
2. If health is not `200` or returns `504`:
   - Check AKS power state:
     - `az aks show -g aistartuptr -n aks-aistartuptr --query powerState.code -o tsv`
   - If `Stopped`, start it:
     - `az aks start -g aistartuptr -n aks-aistartuptr`
3. Verify dealbook API (server-side auth required):
   - `curl -H "X-API-Key: $API_KEY" "https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/api/v1/dealbook?period=all&page=1&limit=25"`
4. If API is `200` but slow:
   - Check Redis availability and DB pool stats via `/health`.

### "Backend deploy keeps failing"
1. Inspect the latest run:
   - `gh run list --workflow backend-deploy.yml --limit 5`
   - `gh run view <run_id> --log-failed`
2. Common fixes:
   - Add missing GitHub secrets (especially `ADMIN_KEY`).
   - Ensure AKS is `Running` (deploy cannot reach control plane if stopped).

### "Frontend deploy fails but type-check passes locally"
1. Always run a production build locally:
   - `pnpm --filter web build`
2. Watch for Tailwind `@apply` invalid classes in `apps/web/app/globals.css`
   - Example anti-pattern: `bg-accent/12` (not a valid Tailwind opacity step).
3. If CI fails with `Cannot find module './…'` but local dev works:
   - Ensure new files are actually committed (no untracked `apps/web/**` components).
   - Ensure import path casing matches the filename exactly (CI is Linux case-sensitive; macOS often hides this).
4. If CI fails with a Dealbook filters type error (example seen on 2026-02-07: `DealbookFilters.vertical` missing):
   - Keep `apps/web/lib/api/client.ts` `DealbookFilters` in sync with filter usage in `apps/web/lib/data/index.ts` and UI filter keys.

### "Which commits are live vs pending?"
1. Check release reconciler log:
   - `tail -n 80 /var/log/buildatlas/release-reconciler.log`
2. Compare desired vs live directly:
   - Desired: `git -C /opt/buildatlas/startup-analysis rev-parse --short origin/main`
   - Frontend live: `curl -fsS https://buildatlas.net | rg -o 'ba-build-sha\" content=\"[0-9a-f]+'`
   - Backend live: `curl -fsS https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health | jq -r '.build_sha'`
3. If drift persists:
   - Check recent deploy jobs:
     - `tail -n 120 /var/log/buildatlas/frontend-deploy.log`
     - `tail -n 120 /var/log/buildatlas/backend-deploy.log`

## UI Design Philosophy & Color System

### Visual Identity

BuildAtlas uses an **editorial/financial terminal** aesthetic — minimal, professional, content-dense, dark-first. Think Bloomberg Terminal meets a quality broadsheet, not a consumer SaaS dashboard.

Key principles:
- **Content over chrome**: Every pixel should serve information or navigation. No decorative elements, gratuitous gradients, or filler illustrations.
- **Density over whitespace**: Users are power-readers scanning large datasets. Compact rows beat spacious cards. Collapsible elements beat always-visible ones.
- **Warm-on-dark**: The dark mode uses a warm obsidian base (`220 18% 6%`) with warm cream text (`42 18% 89%`), avoiding the cold blue-black of generic dark themes.
- **Restrained color**: Most of the UI is grayscale. Color is reserved for meaning — accents, signals, status, and data.

### Dual-Accent System (Action vs. Info)

The design system uses **two accent colors** with distinct semantic roles. This is a critical invariant — do not collapse them back into one.

| Role | Token | Dark Mode HSL | Usage |
|------|-------|---------------|-------|
| **Action** (warm) | `--accent` | `40 55% 52%` (antique gold) | CTA buttons, active toggles, form submits, brand marks |
| **Info** (cool) | `--accent-info` | `192 75% 52%` (cyan-teal) | Links, labels, navigation state, signal badges, indicators, focus rings, chart highlights |

**Decision rule**: If clicking it _does something_ (submits, toggles, navigates as primary action) → `accent`. If it _communicates something_ (labels, status, informational links, hover highlights) → `accent-info`.

Examples:
- "Subscribe" button → `bg-accent text-accent-foreground` (action)
- "Signal Feed" nav label → `text-accent-info` (info)
- Active filter pill in filter-builder → `bg-accent` (action — user toggled it)
- "AI Signal 87%" badge → `border-accent-info/35 text-accent-info` (info)
- GenAI adoption badge → `bg-accent-info/10 text-accent-info` (info)

### Semantic Color Tokens

Beyond the two accents, these semantic tokens exist for specific data meanings:

| Token | HSL (dark) | Purpose |
|-------|------------|---------|
| `--success` | `160 62% 45%` | Growth, positive change, healthy status |
| `--destructive` | `0 64% 56%` | Errors, deletions, danger |
| `--warning` | `40 55% 52%` | Matches action accent — caution states |
| `--delta` | `275 60% 60%` (violet) | Changed/delta indicators, diff badges |
| `--synthesized` | `265 30% 55%` (muted purple) | AI-generated/synthesized content markers |

### Chart Palette

Charts use a **cyan/teal/sky/blue family** via `--chart-1` through `--chart-5`. Never hardcode HSL values in chart components — always use the CSS variables or import from `lib/chart-colors.ts`.

```typescript
// Correct: import from shared constants
import { CHART_COLORS, CHART_GRID, CHART_AXIS } from '@/lib/chart-colors';

// Wrong: hardcoded HSL
const color = 'hsl(192, 75%, 52%)';
```

For charts needing more than 5 series, use opacity variants: `hsl(var(--chart-N) / 0.7)`.

### Paper Mode (Reading Theme)

Reading-heavy pages (`/brief`, `/library`, `/company/[slug]`) support an optional **paper mode** — a warm off-white theme (`.paper` CSS class) scoped to the content area only. The sidebar and header remain dark.

- Provider: `lib/reading-mode-context.tsx` → `useReadingMode()` hook
- Wrapper: `components/ui/reading-wrapper.tsx` → applies `.paper` class
- Toggle: `components/ui/reading-mode-toggle.tsx` → Moon/FileText icons
- Persisted to `localStorage` key `ba_reading_mode`

### Typography System

Use the existing typographic classes from `globals.css`. Do not invent new ones.

- Headlines: `headline-xl`, `headline-lg`, `headline-md`, `headline-sm`
- Body: `body-lg`, `body-md`, `body-sm`
- Numbers: `num-lg`, `num-md`, `num-sm` (tabular-nums for alignment)
- Labels: `label-sm`, `label-xs` (uppercase, letter-spaced)

### Component Patterns

| Pattern | Class / Approach |
|---------|-----------------|
| Elevated card surface | `bg-card border border-border/40 rounded-xl` |
| Subtle hover | `hover:bg-muted/20 transition-colors` |
| Info badge | `text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent-info/25 bg-accent-info/10 text-accent-info` |
| Section divider | `border-b border-border/20` |
| Focus ring | `focus:ring-accent-info/70 focus:border-accent-info/55` |
| Collapsible stat | Use `KpiStrip` pattern — single-line with toggle |

### What NOT To Do

- Do not add new color variables or hardcoded hex/hsl colors. Use existing tokens.
- Do not use bright/saturated colors outside the defined palette.
- Do not add decorative elements, shadows, or excessive border-radius.
- Do not mix the two accents (e.g., `accent` border with `accent-info` text in the same element).
- Do not use `accent` (warm gold) for links, labels, or informational indicators — use `accent-info`.
- Do not hardcode chart colors — use `lib/chart-colors.ts` or CSS variables.

### News Page Architecture (Master-Detail Radar)

The `/news` page uses a feed-first "radar" layout with an on-demand detail drawer:

```
[Sticky CommandBar] — search | sort (impact/latest) | time window (6h/24h/7d/all) | topics
[KpiStrip] — stories | cross-source | clusters | entities (collapsible)
[Feed]
  [PinnedStoryCard]
  [StoryCard] × N (lg: 3-col grid)

[Context Drawer] (only when ?story=id)
  [StoryContext]
```

- Client component: `components/news/interactive-radar.tsx`
- Story selection: URL param `?story=id` (shareable, supports back/forward)
- Live polling: 5-minute interval, disabled on archive pages (`isArchive` prop)
- Mobile: context drawer renders as a fixed overlay sheet

## Change Discipline (Avoid Breaking Prod)

- Double-check generated code (AI-generated or script-generated) before committing:
  - Read it end-to-end, verify it matches the intent, and run the relevant build/type-check/tests when feasible.
- Do not touch infrastructure components or database tables unless absolutely required:
  - Infra includes `.github/workflows/**` and `infrastructure/**` (and any deploy/cluster config).
  - Database: do not `ALTER`/`DROP`/`DELETE` tables (or ship destructive migrations) without explicit approval first.
- Prefer small, scoped commits. This repo often has a dirty worktree; do not "clean up" unrelated files.
- Do not change workflow triggers/secrets lightly; document changes here.
- When modifying API auth/proxy rules (`apps/api/src/index.ts`), validate:
  - health endpoints still accessible
  - Front Door ID enforcement still blocks bypass in production
  - web can still call API server-side with `API_KEY`
- Before pushing UI changes:
  - `pnpm --filter web type-check`
  - `pnpm --filter web build`
- Before pushing API changes:
  - `pnpm --filter @startup-investments/api build`
  - Confirm `backend-deploy.yml` required secrets are present.
