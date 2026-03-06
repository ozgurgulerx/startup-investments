# Build Atlas Agent Notes (Do Not Delete)

This file is the "memory" for humans and coding agents working in this repo.
Keep it current. When you make an architectural change, change a workflow, or
introduce a new invariant/secret, update this file in the same PR/commit.

Goals:
- Prevent context loss between dev runs.
- Make recovery/debug of "site is slow/down" deterministic.
- Avoid accidental changes that break deploys, auth, or data pipelines.

Last verified: 2026-02-14

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
- `.github/workflows`: (intentionally removed) GitHub Actions is not part of the production control plane for this repo.

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
  - `ADMIN_KEY` is required in production (no fallback to `API_KEY`).
  - Watchlist intelligence endpoints (`/api/v1/subscriptions`, `/api/v1/alerts*`) also require
    `x-user-id` (UUID) per request to scope results to a single user.
- Health endpoints are intentionally public:
  - `/health`, `/healthz`, `/readyz` are not API-key protected.
  - `/health`, `/healthz`, `/readyz` include `build_sha` for release reconciliation.

## Critical Invariants (Don’t Break These)

- Do not expose `API_KEY` or `ADMIN_KEY` to the browser.
  - Web uses `process.env.API_KEY` only in Server Components / API routes.
- Client components must not call backend `/api/v1/*` endpoints directly (they require `X-API-Key`).
  - Use same-origin Next route handlers under `apps/web/app/api/**` as proxies (e.g. `/api/movers`, `/api/startups/:slug/*`, `/api/brief/snapshot`).
- Web admin proxy routes must send distinct auth headers:
  - `apps/web/app/api/monitoring/route.ts` and `apps/web/app/api/editorial/route.ts` call backend admin endpoints and must forward `X-API-Key: API_KEY` and `X-Admin-Key: ADMIN_KEY` (these may differ).
  - `apps/web/app/api/editorial/route.ts` must allowlist `path` (`review`, `actions`, `rules`, `stats`, `rules/:id`) and reject all other upstream path values.
- Web admin surfaces/proxies must be **admin-only** (defense-in-depth):
  - `apps/web/middleware.ts` enforces JWT auth + `role=admin` for `/monitoring`, `/api/monitoring`, `/api/editorial`.
  - The route handlers above also check `session.user.role === 'admin'` before proxying keys upstream.
- Keep `/health` cheap and reachable (Front Door probe + diagnostics).
- Keep the API deployable when AKS is running:
  - `infrastructure/vm-cron/jobs/backend-deploy.sh` must be able to connect to the AKS control plane.
- Deploy artifacts must be pinned (no floating `:latest` tags in `infrastructure/kubernetes/**`):
  - Manifests use `__IMAGE_TAG__` placeholders; deploy scripts/workflows must patch them to a concrete tag/digest.
  - Guardrail: `scripts/check-k8s-no-latest.sh` (run in deploy automation).
- Release reconciliation invariants:
  - API `/health*` `build_sha` comes from `API_BUILD_SHA` baked into the API image (`apps/api/Dockerfile` build arg).
  - Avoid reintroducing secret-sourced `api-build-sha` env injection (it breaks deterministic rollbacks).
- Avoid making `/dealbook` depend on slow file-based reads in steady state:
  - When API is down, web falls back to file reads; this is a degradation mode.
- Keep `packages/analysis/src/automation/__init__.py` import-light (no eager imports of optional heavy deps like `openai`).
  - Cron jobs import `src.automation.*` submodules; an import-time crash here can take down unrelated jobs (e.g. `event-processor`).
- When reading DB `*_json` columns in `packages/analysis` automation, tolerate both dict and JSON-string values:
  - Use `packages/analysis/src/automation/json_utils.py` `ensure_json_object(...)` (prevents cron crashes like `onboarding-alerts`).
- Shell scripts must be LF-only (no CRLF / `\r` bytes):
  - Enforced by `.gitattributes` (`*.sh text eol=lf`).
  - Pipelines image hardens this at build time: `infrastructure/pipelines/Dockerfile` strips CR bytes and fails the build if any remain.
  - Guardrail test: `packages/analysis/tests/test_no_crlf_shell_scripts.py`.
  - Local: `./venv/bin/python -m pytest -q packages/analysis/tests` (uses repo venv; includes this guardrail).
- `embed-backfill` supports safe verification without embedding spend:
  - Set `EMBED_BACKFILL_DRY_RUN=true` to only count unembedded clusters (DB read only; no Azure OpenAI calls).
  - Optional tuning: `EMBED_BACKFILL_LIMIT`, `EMBED_BACKFILL_ORDER`, `EMBED_BACKFILL_SLEEP_MS`, `EMBED_BACKFILL_RELATED_*`.
- News email subscriptions are **double opt-in**:
  - New signups are stored as `pending_confirmation` and must be activated via the emailed confirmation link.
  - Unsubscribe is token-based (`GET /api/news/subscriptions?token=...`); do not add raw email-based unsubscribe endpoints.
- Web watchlist-intelligence API proxies must forward identity:
  - `apps/web/app/api/subscriptions/route.ts` and `apps/web/app/api/alerts/**` resolve NextAuth session and pass
    `X-User-Id` to backend; missing this causes 401s and empty watchlist intelligence UI.
  - Backend watchlist-intelligence handlers treat malformed `X-User-Id` as client error (`400`) and must not allow invalid UUID values to reach DB UUID casts.
- News reaction identity precedence:
  - `apps/web/app/api/news/signals/**` uses `user_id` when signed in; anonymous users use `ba_anon_id` cookie fallback.
- Community feature migration + routing invariants:
  - Migration `database/migrations/062_community_features.sql` introduces:
    - `users.reputation_points`, `users.trust_level`
    - `signal_thread_posts`, `signal_thread_votes`
    - `signal_polls`, `signal_poll_votes`
    - `shared_watchlists`, `shared_watchlist_members`, `shared_watchlist_items`
    - `user_notification_preferences`
  - Migration runner must include `062_community_features.sql` in both `news` and `startups` sets
    (`scripts/apply_migrations.py`, invoked by `infrastructure/vm-cron/jobs/apply-migrations.sh`) so community features are available regardless
    of which periodic pipeline applies migrations first.
  - Community UI surface is the Signal Deep Dive `Community` tab:
    - `apps/web/app/(app)/signals/[id]/community-tab.tsx`
  - Notification hygiene preferences are enforced in backend alerts:
    - `apps/api/src/services/subscriptions.ts` `getAlerts(...)` applies `user_notification_preferences` (`mute_low_severity`, `muted_delta_types`)
      and fails open (no filtering) if the table isn't migrated yet.
    - `apps/web/app/api/alerts/route.ts` is a thin proxy and must not rewrite pagination totals.
- Signals recommendation invariants:
  - Backend recommender (`apps/api/src/services/signals.ts`) is now `signals_v2_graph_memory`:
    watchlist overlap + capital graph overlap (`capital_graph_edges`) + memory-gate strength (`news_item_decisions`).
  - Recommendation reason types exposed to web:
    `watchlist_overlap`, `graph_investor_overlap`, `memory_momentum`, `high_impact_fallback`.
  - Degradation rule: if graph/memory tables are unavailable, recommender must still return results (impact-based fallback), not fail the endpoint.
  - Feedback persistence (lightweight personalization):
    - Migration: `database/migrations/066_signals_reco_feedback.sql`
    - Tables:
      - `user_signal_reco_dismissals` hides signals from future recommendations (per-user, per-signal).
      - `user_signal_domain_prefs` stores per-user per-region domain weights used as a ranking nudge.
    - Backend endpoint: `POST /api/v1/signals/recommendations/feedback` is used by the web UI.
  - Signals relevance bundle + relevance sort (information relevance MVP):
    - Backend endpoint: `GET /api/v1/signals/:id/relevance`
      returns `{ relevant_rounds, related_patterns, related_signals }` scoped to the signal's region (default window: 90d).
    - Backend list sort: `GET /api/v1/signals?sort=relevance` blends impact+conviction+momentum and (when provided)
      applies `user_signal_domain_prefs` + excludes `user_signal_reco_dismissals`.
    - Web proxies:
      - `apps/web/app/api/signals/[id]/relevance/route.ts`
      - `apps/web/app/api/signals/route.ts` (attaches `user_id` from session only for `sort=relevance`)
    - UI surfaces:
      - Signal inspector shows a compact "Relevance" section (rounds + patterns).
      - Signal deep dive adds a `Relevance` tab with the full bundle.
  - Focused Signals UX + rollout flags:
    - `/signals` is the primary decision surface (Detect -> Explain -> Act), with focused controls enabled by default.
    - Signed-in default sort is `relevance`; anonymous default sort is `impact`.
    - Default visible filters are `domain` and `status`; `sort`, `window`, and `sector` are in Advanced.
    - Feature flags (web env / local override):
      - `NEXT_PUBLIC_SIGNALS_UI_FOCUSED_MODE`
      - `NEXT_PUBLIC_SIGNALS_DISABLE_STATIC_FALLBACK`
      - `NEXT_PUBLIC_RECO_UX_SIMPLIFIED`
  - Static fallback policy:
    - Default `/signals` does not silently fall back to static monthly analysis.
    - When stale/empty, the UI shows explicit stale metadata from `GET /api/v1/signals/summary` (`last_pipeline_run_at`, `stale`, `stale_reason`).
    - Legacy static analysis is retained at `/signals/legacy`; if `NEXT_PUBLIC_SIGNALS_DISABLE_STATIC_FALLBACK=false`, `/signals` redirects to legacy when dynamic data is unavailable.
  - Additive API fields (backward compatible):
    - `GET /api/v1/signals` now includes optional:
      `confidence_score`, `freshness_score`, `evidence_diversity_score`, `reason_short`, `linked_story_count`, `top_story_ids`, `claim_structured`.
    - `GET /api/v1/signals/:id` may include:
      `upstream_stories[]`, `signal_window_days`.
  - Smoke-test guardrail:
    - Playwright coverage is enforced via the ops canary jobs (AKS/VM) and should also be runnable locally before deploys.

## Automation (Source of Truth)

Primary scheduled automation is split:
- **AKS CronJobs** for pipeline jobs (news/events/digests/briefs/benchmarks) to avoid VM availability issues.
- **VM cron** for deploy orchestration + VM-only tasks (keep-alive, blob sync, crawl-frontier, release reconciliation, Slack summary, etc).
GitHub Actions workflows are intentionally removed from this repo; do not treat GitHub as an automation control plane (use AKS CronJobs + VM cron).

AKS pipelines CronJobs:
- Manifests:
  - `infrastructure/kubernetes/pipelines-configmap.yaml`
  - `infrastructure/kubernetes/pipelines-cronjobs.yaml`
- Image: `aistartuptr.azurecr.io/buildatlas-pipelines:<git-sha>` (pinned; manifest uses `__IMAGE_TAG__` patched at deploy time) (from `infrastructure/pipelines/Dockerfile`)
- Secret: `Secret/buildatlas-pipelines-secrets` (keys are ENV var names so pods can use `envFrom`)
  - Important: `kubectl create secret --from-env-file` does **not** parse shell quoting. If you feed lines like
    `AZURE_OPENAI_ENDPOINT="https://.../"`, the pods will literally see quotes and Azure OpenAI calls will fail.
    Ensure values are unquoted in the secret (especially `AZURE_OPENAI_ENDPOINT`).
  - Azure OpenAI auth: production OpenAI account has `disableLocalAuth=true` (AAD only). By default, pods use the
    AKS **kubelet identity**. It must have the `Cognitive Services OpenAI User` role on the OpenAI account scope, or
    GPT-5 `responses.*` calls will fail with `PermissionDenied` (missing `.../responses/write`).
    - Kubelet object id: `AZURE_CLI_DISABLE_LOGFILE=1 az aks show -g aistartuptr -n aks-aistartuptr --query identityProfile.kubeletidentity.objectId -o tsv`
    - Account scope: `/subscriptions/.../resourceGroups/rg-openai/providers/Microsoft.CognitiveServices/accounts/aoai-ep-swedencentral02`
- Deploy: VM job `infrastructure/vm-cron/jobs/pipelines-deploy.sh` (runner: `pipelines-deploy`) (typically auto-triggered by `infrastructure/vm-cron/deploy.sh`).
  - Post-deploy guardrail: `pipelines-deploy.sh` triggers a `news-ingest` smoke Job (`kubectl create job --from=cronjob/news-ingest ...`)
    and fails deploy on smoke failure/timeout. Override with `PIPELINES_DEPLOY_SMOKE_NEWS_INGEST=false` (timeout default `35m`, override via `PIPELINES_DEPLOY_SMOKE_TIMEOUT`).
- VM cutover guardrail: set `BUILDATLAS_VM_CRON_DISABLED_JOBS` in `/etc/buildatlas/.env` (enforced by `infrastructure/vm-cron/lib/runner.sh`)
  - Additional safety net: `infrastructure/vm-cron/vm-cron-disabled-jobs` can disable jobs on the VM even if `/etc/buildatlas/.env` is misconfigured (prevents accidental double-runs).

VM cron runner:
- Config: `infrastructure/vm-cron/crontab`
- Wrapper (locks, timeouts, logs, structured Slack lifecycle events): `infrastructure/vm-cron/lib/runner.sh`
- Code updater (git pull + triggers deploys): `infrastructure/vm-cron/deploy.sh`
- Release drift monitor (desired vs live SHA): `infrastructure/vm-cron/jobs/release-reconciler.sh`
- One-time setup/bootstrap (packages, venv, logrotate, crontab): `infrastructure/vm-cron/setup.sh`
- VM sanity checks (cron service + crontab contents): `infrastructure/vm-cron/verify.sh`
- Logs: `/var/log/buildatlas/*.log` on the VM (see `scripts/slack_daily_summary.py` for parsing expectations)
  - `runner.sh` strips NUL bytes (`\000`) from job stdout/stderr before appending to logs so log-scanners don't treat them as binary.
  - If you see intermittent `exit 141` in VM cron job logs: this is `SIGPIPE` (often from `tee` writing to a closed/unwritable stdout under cron). `runner.sh` streams to stdout only for operator sessions (TTY/SSH) on the VM; for AKS CronJobs (`BUILDATLAS_RUNNER=aks-cronjob`), it also streams to stdout so `kubectl logs` works. `runner.sh` logs `PIPESTATUS` on failures for faster root-cause.
  - `runner.sh` sets `AZURE_CONFIG_DIR` per job run to isolate Azure CLI auth state (prevents cross-job `az login` races).
  - `heartbeat.sh` scans logs in text mode (`grep -a`) so occasional NUL bytes won't break freshness detection.
  - Product surface canary:
    - `product-canary` runs every 30 minutes (`17,47 * * * *`) and validates:
      - brief snapshot schema (includes `verticalLandscape` + `capitalGraph`),
      - landscapes surfaces (`/api/v1/landscapes` + `/api/v1/landscapes/cluster`) (global must return data; Turkey warn-only),
      - Investor DNA screener (`/api/v1/investors/screener`) (warn if empty),
      - deep dives have at least one `ready` item (`/api/v1/deep-dives`).
    - State file: `/var/lib/buildatlas/product-canary.state` (fallback: `$REPO_DIR/.tmp/product-canary.state`).
  - `crawl-frontier` runs every 30 minutes with a **40 minute** runner timeout (`runner.sh crawl-frontier 40 ...`) to avoid recurring timeout kills during large frontier seeding windows.
  - `crawl-frontier` now uses **chunked resumable seeding**:
    - full reseed is not attempted on every cycle,
    - seed runs on interval (`CRAWL_FRONTIER_SEED_INTERVAL_HOURS`, default 6h) or resume cursor,
    - state files live under `/var/lib/buildatlas` (`crawl-frontier.seed.cursor`, `crawl-frontier.seed.last`),
    - worker execution still proceeds if seed chunk fails/times out.
  - Frontier telemetry:
    - Each frontier URL crawl attempt is persisted to `crawl_logs` (with `canonical_url`, `fetch_method`, `proxy_tier`, `error_category`, and optional `capture_id`) so `/api/admin/monitoring/frontier` can report 24h success/error rates.
    - `/api/admin/monitoring/frontier` computes `runs24h` from frontier-related `crawl_logs` (canonical URLs present in `crawl_frontier_urls`) and excludes synthetic `fetch_method=runtime_missing_output` rows.
    - `/api/admin/monitoring/frontier` also reports `coverageByPageType`, `discoveryYield24h`, `unblockConversion24h`, and `domainStarvation` for depth-focused tuning.
    - If `crawl_logs` is empty (older deployments), monitoring falls back to `crawl_frontier_urls.last_*` fields as an approximation.
  - API runtime telemetry (admin-only):
    - Middleware: `apps/api/src/monitoring/runtime_metrics.ts` records rolling per-minute request counts/status/latency buckets.
    - Admin endpoint: `/api/admin/monitoring/runtime?window_min=10` returns a snapshot plus DB pool stats (`getPoolStats()`).
  - VM `infrastructure/vm-cron/monitoring/heartbeat.sh` and `infrastructure/vm-cron/jobs/health-report.sh` consume this endpoint for SLO-style alerting.
  - AKS Cron health diagnostics in `health-report.sh` track latest and previous Job outcomes per CronJob and explicitly flag consecutive failures.
  - Raw captures (WARC-lite):
    - `crawl_raw_captures` stores envelope metadata for replay and optionally uploads the compressed body to Blob Storage under `crawl-snapshots/raw-captures/...`.
    - If Blob upload auth is misconfigured (e.g., `AuthorizationFailure`), the worker **fail-opens**: it disables further blob uploads for that run (to avoid log spam) and continues recording DB metadata with `body_blob_path=NULL`.
  - Seed chunk controls are env-driven:
    - `CRAWL_FRONTIER_SEED_LIMIT` (DB batch read, default 5000)
    - `CRAWL_FRONTIER_SEED_MAX_STARTUPS` (per-run processed startups, default 500)
    - `CRAWL_FRONTIER_SEED_MAX_SECONDS` (per-run seed budget, default 600)
    - `CRAWL_FRONTIER_SEED_TIMEOUT_MIN` (wrapper timeout, default 20)
    - optional force run: `CRAWL_FRONTIER_FORCE_SEED=true`
  - Crawl throughput tuning (speed up without degrading crawl policy):
    - `CRAWLER_FRONTIER_BATCH_SIZE` (URLs leased per worker loop; default 50)
    - `CRAWLER_FRONTIER_DOMAIN_CAP` (max leases per domain per batch; default 5)
    - `CRAWL_FRONTIER_MAX_LOOPS` (number of worker loops per cron run; default 4)
    - `CRAWLER_FEED_DISCOVERY_MAX_URLS` (seed discovery cap per startup; default 40)
    - Prefer raising `CRAWL_FRONTIER_MAX_LOOPS` first to use the existing 40m cron window before increasing batch size.
    - Roll back if `crawl-frontier` hits the 40m timeout or `/api/admin/monitoring/frontier` shows rising `staleLeases`, worsening `runSuccessRate24h`, or worsening `domainStarvation`.
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
  - Daily EOD onboarding report: `onboarding-eod-report` runs at `20:00 UTC` (`0 20 * * *`) and posts a Slack report of:
    stub startups created, investors added, capital graph edges upserted, and news<>startup linking activity (startup_events + refresh jobs + memory linking).
  - Optional EOD onboarding report email (best-effort) uses Resend:
    - Requires `RESEND_API_KEY` + `METRICS_REPORT_EMAIL_TO`.
    - Sender: `METRICS_REPORT_EMAIL_FROM` (falls back to `NEWS_DIGEST_FROM_EMAIL`).
    - Subject prefix: `ONBOARDING_EOD_REPORT_EMAIL_SUBJECT_PREFIX` (falls back to `METRICS_REPORT_EMAIL_SUBJECT_PREFIX`).
  - AKS fallback (VM-independent): `posthog-usage-summary` CronJob posts the same PostHog usage block to Slack:
    - Manifest: `infrastructure/kubernetes/posthog-usage-cronjob.yaml`
    - Image: `aistartuptr.azurecr.io/buildatlas-ops:<git-sha>` (pinned; manifest uses `__IMAGE_TAG__` patched at deploy time) (built from `infrastructure/ops/Dockerfile`)
    - Secrets: Kubernetes `buildatlas-ops-secrets` (`slack-webhook-url`, `posthog-project-id`, `posthog-personal-api-key`, optional `posthog-host`)
    - Deploy (primary): VM job `pipelines-deploy` (best effort) builds `buildatlas-ops` + `buildatlas-playwright-canary` and applies ops CronJobs.
    - Deploy (manual fallback): apply the manifest from an operator environment that can reach the AKS control plane (typically the VM).
- VM time: the VM is configured to `Etc/UTC` and `infrastructure/vm-cron/crontab` times are **UTC** (Istanbul is `UTC+3`).
- Git safety: git operations across cron jobs are serialized via `/tmp/buildatlas-git.lock` to avoid races (e.g. `code-update` vs `slack-commit-notify`).
- Cron safety: the BuildAtlas schedule must be installed only for the `buildatlas` user. Root crontab must not contain the BuildAtlas block (detect via `sudo crontab -l`; clear via `sudo crontab -r` only if it contains only BuildAtlas entries).
- VM repo safety: run git operations as `buildatlas` (avoid `sudo git ...`). If `deploy.sh` fails to stash/pull with `Cannot save the current status`, it is often due to root-owned `.git/refs/stash` or other `.git/**` paths; fix with `sudo chown -R buildatlas:buildatlas /opt/buildatlas/startup-analysis/.git`. Consider `git config core.filemode false` on the VM to avoid local `chmod +x` making the repo perpetually dirty.
- DB migration safety:
  - `infrastructure/vm-cron/jobs/apply-migrations.sh` provides a VM-local `flock` lock (defaults to `$REPO_DIR/.tmp/db-migrations.lock`, configurable via `BUILDATLAS_MIGRATIONS_LOCK_FILE` + `BUILDATLAS_MIGRATIONS_LOCK_WAIT_SECONDS`).
  - `scripts/apply_migrations.py` is the single source of truth for migration sets and enforces a Postgres advisory lock + transient DDL retry (works across VM + AKS CronJobs).
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
    - Opt-out per commit: include `[skip slack]` (or `[no-slack]`) in the commit message.
  - GitHub dispatch fallback has been removed; ensure a VM Slack webhook is configured.
  - Quick test (VM -> Slack):
    - `SLACK_TITLE="Slack test" SLACK_STATUS=info SLACK_BODY="Hello from VM" python3 scripts/slack_notify.py`
  - VM debugging:
    - Slack-post failures are appended into the job log (e.g. `/var/log/buildatlas/news-ingest.log`) and `heartbeat.log`.
  - Release reconciliation state:
    - Cursor/state file: `/var/lib/buildatlas/release-reconciler.state` (or `$REPO_DIR/.tmp` fallback).
    - Drift reminders are controlled by `RELEASE_RECONCILE_ALERT_AFTER_MINUTES` and `RELEASE_RECONCILE_REMINDER_MINUTES`.

Frontend:
- VM job: `infrastructure/vm-cron/jobs/frontend-deploy.sh` (deploys to App Service `buildatlas-web`).
- Library datasets:
  - `/library` reads file-based newsletters from `DATA_PATH` (default `./data`, see `apps/web/lib/data/index.ts`).
  - `/library` only offers months that have newsletter markdown on disk (`output/comprehensive_newsletter.md` or `output/viral_newsletter.md`) to avoid API/data mismatches.
  - Docker-based App Service deploy must include datasets at `/app/data` (see `apps/web/Dockerfile`).

Backend:
- VM job: `infrastructure/vm-cron/jobs/backend-deploy.sh` (ACR remote build + `kubectl apply`).
  - Common failure modes:
    - Missing secrets (`ADMIN_KEY`, etc).
    - AKS control plane unreachable if the cluster is stopped.

Functions:
- VM fallback job: `infrastructure/vm-cron/jobs/functions-deploy.sh` (zip deploy + health check).
  - Auto-triggered by VM `code-update` when `infrastructure/azure-functions/**` or `packages/analysis/**` changes.

Uptime automation:
- Azure-native (primary): Azure Automation runbook `buildatlas-aks-ensure-running` (scheduled) starts AKS if stopped and checks API health.
  - IaC: `infrastructure/azure/aks-uptime.bicep` (Automation Account + variables + schedule) + `infrastructure/azure/runbooks/aks-ensure-running.ps1` (runbook content).
  - Deploy: apply the Bicep from an operator environment (typically the VM) via `az deployment group create ...`.
  - Automation account: `aa-buildatlas-aks-uptime` (RG `aistartuptr`).
  - Note: `SLACK_WEBHOOK_URL` is stored as an encrypted Automation variable; the runbook only posts to Slack on changes/failures.
- VM cron fallback: `infrastructure/vm-cron/jobs/keep-alive.sh` (every 15 min) starts AKS if stopped and verifies API health.

News:
- VM jobs:
  - `infrastructure/vm-cron/jobs/news-ingest.sh`
  - `infrastructure/vm-cron/jobs/news-digest.sh`
  - `news-digest.sh` now posts per-run delivery totals to Slack (`sent/skipped/failed` for global+turkey).
- Default sources are defined in `packages/analysis/src/automation/news_ingest.py` (`DEFAULT_SOURCES`).
  - Ingest source validation is fail-open: invalid `SourceDefinition` entries are logged and skipped (not fatal),
    but ingestion hard-fails if zero valid sources remain after validation.
  - SemiAnalysis is ingested via RSS as `source_key=semianalysis` (`https://semianalysis.com/feed/`).
- Canonical Evidence Objects + hardened Event Objects (contract of truth):
  - Migrations:
    - `071_evidence_objects.sql` (canonical `evidence_objects` + `evidence_object_members`)
    - `072_entity_nodes.sql` (unified `entity_nodes` namespace)
    - `073_event_contract_hardening.sql` + `076_startup_events_evidence_ids_gin.sql` (harden `startup_events` contract)
    - `074_evidence_links_news.sql` (news pointers)
    - `075_signal_evidence_object_bridge.sql` (signal bridge)
  - Canonical pointers:
    - `news_items_raw.evidence_object_id` (`evidence_type='news_item'`)
    - `news_clusters.evidence_object_id` (`evidence_type='news_cluster'`)
    - `startup_events.evidence_ids` (UUID[] of canonical evidence ids)
    - `signal_evidence.evidence_object_id` and `signal_moves.evidence_object_ids` (canonical traceability)
  - News -> Signal linkage surface:
    - News cards/context can expose optional linkage fields:
      `signal_impact`, `linked_signal_count`, `top_linked_signal{id,claim,reason,freshness_score,last_evidence_at}`.
    - `Open signal` CTAs preserve return context using `originStory`/`originRegion`/`originPath` query params.
    - Signal inspector/deep dive can show `Back to originating story` when opened through this flow.
  - Backfill (idempotent): `cd packages/analysis && python main.py backfill-evidence-objects --days 30 --region all`
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
  - VM jobs:
    - `infrastructure/vm-cron/jobs/deep-dive-generate.sh` (daily at `05:15 UTC`): full pipeline for a rotating set of top signals (occurrences → moves → synthesis).
    - `infrastructure/vm-cron/jobs/deep-dive-catchup.sh` (every 4 hours at `:58 UTC`): backfills **missing** deep dives (coverage-first, trend-only synthesis) so the UI doesn't stay empty.
  - Deployment invariant:
    - `050_signal_deep_dives.sql` must be included in migration sets used by news pipelines (`news`, `news-digest`) in `scripts/apply_migrations.py`.
    - `deep-dive-generate.sh` runs migration preflight (`apply-migrations.sh news`) before computing occurrences/generating deep dives.
    - `deep-dive-catchup.sh` also runs the same migration preflight before backfill.
  - Runtime degradation behavior:
    - If deep-dive tables are unavailable, backend deep-dive endpoints should return empty payloads (not crash) so `/signals/[id]` can show "No deep dive available yet" instead of failing hard.
  - Deep-dive IA (focused):
    - Primary tabs are `Delta`, `Evidence`, and `Actions`.
    - `Explorer`, `Relevance`, `Counterevidence`, `Community`, and `How It Works` are reachable via `More`.
    - Legacy tab deep links are preserved via query remap (`tab=cases -> tab=evidence`, `tab=mechanism -> tab=actions`).
  - Coverage behavior (important for "empty deep dive" debugging):
    - Deep-dive generation prefers per-startup samples from `signal_occurrences` (requires startup-linked evidence).
    - If a signal cannot produce a per-startup sample set (e.g., evidence is mostly `startup_id=NULL` or too sparse), the pipeline falls back to a **trend-only deep dive** synthesized from recent `signal_evidence` rows.
      - These deep dives may have `sample_count=0` and should be treated as "trend-level" (no startup case studies/watchlist unless startups are explicitly linked).
    - Backend `GET /api/v1/signals/:id/deep-dive` includes best-effort `meta` diagnostics (`startups_eligible`, `unlinked_evidence_count`, `occurrences_total`, `latest_status`) to help explain why a deep dive is missing.
  - Deep research integration (best-effort):
    - Deep-dive synthesis prompts may include the latest completed `deep_research_queue.research_output.analysis` for a small subset of linked startups.
    - Catchup job can enqueue deep research (`reason='signal_deep_dive'`) for top linked startups; spend is still capped by the deep research consumer env gates (`DEEP_RESEARCH_*`).
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
- Paid headline leads (The Information):
  - Goal: ingest **headline-only** URLs from paywalled sources as *leads*, then expand to accessible corroborating coverage (do not paywall-bypass).
  - DB table: `paid_headline_seeds` (migration: `database/migrations/067_paid_headline_seeds.sql`; included in `news` + `news-digest` sets in `scripts/apply_migrations.py`).
  - Admin API:
    - `POST /api/admin/v1/headline-seeds` (create seed) (`x-admin-key` required)
    - `GET /api/admin/v1/headline-seeds` (list seeds) (`x-admin-key` required)
  - Ingest integration: `packages/analysis/src/automation/news_ingest.py` adds source `theinformation` with `fetch_mode=paid_headlines`.
- Env gates:
    - `PAID_HEADLINE_SEEDS_ENABLED=true` enables processing.
    - `PAID_HEADLINE_METADATA_FETCH=true` enables metadata-only HTML fetch (title/description/og:image/article:published_time).
    - `PAID_HEADLINE_EXPAND_SOURCES=gnews,newsapi`, `PAID_HEADLINE_EXPAND_LOOKBACK_HOURS=168`, `PAID_HEADLINE_EXPAND_MAX_PER_SEED=8`, `PAID_HEADLINE_MAX_SEEDS_PER_RUN=10`, `PAID_HEADLINE_MAX_ATTEMPTS=3`.
  - Seeders:
    - Scheduled `theinformation-headlines` is currently **disabled** in VM and AKS cron while source reliability is being hardened.
    - Manual runner: `infrastructure/vm-cron/lib/runner.sh theinformation-headlines 15 infrastructure/vm-cron/jobs/seed-theinformation-headlines.sh`.
    - CLI: `python main.py seed-theinformation-headlines --section-url https://www.theinformation.com/technology --max-items 40`.
    - Fetch behavior: the seeder now uses browser-like request headers and retries transient/Cloudflare challenge responses before failing.
    - Optional envs:
      - `THEINFORMATION_SECTION_URL` (defaults to `https://www.theinformation.com/technology`)
      - `THEINFORMATION_SEED_MAX_ITEMS` (defaults to `40`, passed to `main.py` wrapper).
      - `THEINFORMATION_FETCH_MAX_ATTEMPTS` (defaults to `4`).
      - `THEINFORMATION_FETCH_BACKOFF_SECONDS` (defaults to `1.0`).
  - Guardrail: lead-only clusters are excluded from editions/events/research/LLM; a seed only influences published news via corroborating non-paywalled sources.
- Memory-Gated Editorial Intelligence (Phase 1: entity linking + fact extraction):
  - Migration: `database/migrations/023_memory_system.sql`
  - Runtime: `packages/analysis/src/automation/memory_gate.py` (zero-LLM; regex + DB lookups)
  - Ingest integration: `packages/analysis/src/automation/news_ingest.py` runs the memory gate after clustering and persists results after cluster IDs are created.
  - Deployment invariant:
    - VM cron `news-ingest` runs `apply-migrations.sh news`; ensure `023_memory_system.sql` is included in the `news` migration set (see `scripts/apply_migrations.py`).
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
  - Event persistence invariant: `_extract_events(...)` persists only **actionable** events (those with a resolved `startup_id`) to avoid noisy `missing_startup_id` blocks in `event-processor` and to keep the `(cluster_id, startup_id, event_type, event_key)` dedupe index effective.
  - Funding timeline dedupe invariant (migration: `database/migrations/077_funding_timeline_dedupe.sql`):
    - Canonical exact fingerprint for `startup_events.event_type='cap_funding_raised'` is:
      `startup_id + coalesce(region,'global') + normalized round_type + effective_date + normalized amount token + normalized lead_investor token`.
    - DB guardrail: unique partial index `uq_startup_events_funding_fingerprint` enforces this fingerprint regardless of cluster/source.
    - Writer behavior: `event_extractor.persist_events(...)` uses `ON CONFLICT DO NOTHING` for funding events so both cluster dedupe and fingerprint dedupe indexes can be honored.
    - Read-side defense: dossier timeline service (`apps/api/src/services/news.ts`) dedupes funding events by the same fingerprint before returning timeline rows.
    - Migration rollout requirement: include `077_funding_timeline_dedupe.sql` in `scripts/apply_migrations.py` sets for `news`, `news-digest`, `startups`, and `crawl`.
  - Stub creation behavior:
    - Inserts startup rows with `onboarding_status='stub'` (not immediately visible in Dealbook/company API).
    - Attempts website inference from cluster evidence URLs and stores inferred website when confidence is sufficient.
    - Writes attempt telemetry to `startup_onboarding_attempts` (migration: `database/migrations/058_onboarding_pipeline_activation.sql`).
  - Event/crawl/research chain:
    - `onboard_unknown_startups` enqueues refresh jobs (`reason='news_onboard'`) → `crawl-frontier` processes them.
    - Pipeline scheduler (AKS CronJob `event-processor` via `buildatlas-pipelines`; VM cron fallback) runs `main.py process-events`
      (gated enqueue to `deep_research_queue`).
    - Pipeline scheduler (AKS CronJob `deep-research`; VM cron fallback) runs `main.py consume-deep-research` (Azure chat-based worker).
    - Pipeline scheduler (AKS CronJob `onboarding-alerts`; VM cron fallback) runs `main.py dispatch-onboarding-alerts`
      (near-real-time Slack notifications for actionable trace events).
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
    - Enqueue gating note: deep-research enqueues require `last_crawl_at` only for `onboarding_status='stub'`; verified startups can be queued without a prior crawl.
    - Crawl-gate retry (Option 2): `event-processor` auto-requeues research for startups previously blocked with `reason_code='startup_not_crawled_yet'` once a crawl lands (uses `onboarding_trace_events` as the durable "defer" record; no extra table).
      - Env: `DEEP_RESEARCH_REQUEUE_CRAWL_GATED=true` (default), `DEEP_RESEARCH_REQUEUE_LOOKBACK_DAYS=14`, `DEEP_RESEARCH_REQUEUE_LIMIT=25`
    - `ONBOARDING_ALERTS_ENABLED`
    - `ONBOARDING_ALERTS_BATCH_SIZE`
    - `ONBOARD_SINGLE_SOURCE_TRUST_MIN` (allow trusted single-source funding clusters to create stub startups when entity type is unknown)
    - `ONBOARD_SINGLE_SOURCE_ALLOWLIST` (comma-separated publisher domain allowlist for single-source funding onboarding)
  - Visibility invariant:
    - Backend `GET /api/v1/dealbook`, `GET /api/v1/dealbook/filters`, and `GET /api/v1/companies/:slug` are **verified-only** (`onboarding_status='verified'`).
    - `merged`/`stub`/`rejected` startups are excluded from those surfaces.
  - Promotion to verified:
    - On successful deep-research completion, stub startups with website + successful crawl are promoted to `verified`.
    - `sync-startups-to-db.py` and `populate-analysis-data.py` also promote `stub -> verified` for curated/analysis-backed records.
  - Quick checks:
    - If onboarding/deep research stalls but news looks healthy:
      - Check latest `news_ingestion_runs.stats_json->'events'`:
        - symptom: `extracted > 0` but `persisted == 0`
        - look for `persist_errors > 0` + `first_error`
      - In this failure mode, a Slack alert is emitted: `News ingest: event persistence failure`.
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
  - One-shot global onboarding Step 1 now also writes `apps/web/data/<period>/output/analysis_store/progress.json`
    with durable counters (`already_processed`, `delta_total`, `completed`, `successful`, `error_count`,
    `remaining`, `base_analysis_files`, `latest_startup`, `latest_status`, `elapsed_sec`, `eta_sec`).
  - Restart safety: `packages/analysis/src/data/store.py` reconciles existing `base_analyses/*.json`
    back into `analysis_store/index.json` before computing delta, so relaunches can skip already-analyzed startups
    even if the baked index is stale.
    - Reconciled base-analysis artifacts now persist `input_hash`; `reconcile_startups(...)` only trusts base artifacts
      with a saved hash for skip decisions. Legacy base files without `input_hash` reprocess once to avoid silently
      keeping stale analyses after CSV edits.
  - AKS one-shot jobs set `BUILDATLAS_RUNNER=aks-job`; `infrastructure/vm-cron/lib/runner.sh` must stream stdout
    for both `aks-job` and `aks-cronjob` so `kubectl logs` shows live job output without `kubectl exec`.
- To make taxonomy filterable via the backend, we must copy those JSON blobs into Postgres:
  - Command: `python scripts/populate-analysis-data.py --period YYYY-MM`
- Primary automation:
  - VM cron `sync-data` runs `apply-migrations.sh startups` and then `populate-analysis-data.py` after syncing blob data.
  - No GitHub Actions fallback: prefer the VM cron job (or run the command manually on the VM).
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
- Admin fallback API `POST /api/admin/sync-startups` runs the same graph projection step after funding upserts.

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
- Co-invest edges are also synced into the canonical graph table:
  - `capital_graph_edges`: `investor --CO_INVESTS_WITH--> investor` (region-aware, current-only)
  - Migration/indexes: `database/migrations/069_capital_graph_coinvest_edges.sql`

Population model/invariants:
- Canonical source is `capital_graph_edges` (`investor --LEADS_ROUND--> startup`) filtered by month using:
  - `attrs_json.announced_date` when present
  - otherwise `valid_from`
- Legacy fallback (older environments only): `funding_rounds` + `investments` join.

Automation:
- VM cron job: `infrastructure/vm-cron/jobs/compute-investor-dna.sh` (scheduled in `infrastructure/vm-cron/crontab`)
- The job computes both **previous** and **current** month for `global` + `turkey` to avoid “empty month” behavior early in the month.

Investor news + onboarding (all-time, no aging):
- Migration: `database/migrations/070_investor_news_links.sql`
  - Table: `investor_news_links` (investor_id × cluster_id × link_type)
  - Triggers:
    - `news_item_extractions` → `investor_news_links` (`link_type='mention'`) from memory gate `linked_entities_json`
    - `capital_graph_edges` (news_event) → `investor_news_links` (`funding_lead`/`funding_participant`) from `source_ref=cluster_id`
- Backend endpoint: `/api/v1/investors/:id/news` returns **all-time** clusters for the investor (mentions + funding-linked).
  - Optional filter: `?days=N` (when omitted, returns all-time).
- Screener augmentation: `/api/v1/investors/screener` includes `news_count` + `last_news_at` (best-effort, all-time).
- Onboarding/enrichment pipeline (VC/investor):
  - Migration: `database/migrations/068_investor_onboarding.sql`
  - Queue table: `investor_onboarding_queue`
  - Profile table: `investor_profiles`
  - Operator context: `investor_onboarding_context`
  - Enqueue gate (news ingest): `INVESTOR_ONBOARDING_ENQUEUE_ENABLED=true`
  - Consumer gate: `INVESTOR_ONBOARDING_ENABLED=true` (AKS CronJob `investor-onboarding`, VM fallback script exists)
  - Admin context endpoint now accepts either `startupId` or `investorId`:
    `POST /api/admin/v1/onboarding/context` (requires `X-API-Key` + `X-Admin-Key`)
  - Admin monitoring: `GET /api/admin/monitoring/investor-onboarding` (`X-Admin-Key` required)

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
- Send email:
  - VM: `infrastructure/vm-cron/jobs/news-digest.sh` (primary)

Entry points:
- CLI: `cd packages/analysis && python main.py send-news-digest --region global|turkey|all`
- Code: `packages/analysis/src/automation/news_digest.py`

Required secrets/env (VM/AKS):
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
  - CLI: `cd packages/analysis && python main.py send-news-digest --region global --dry-run`

Debug commands:
- Latest runs (VM):
  - `tail -200 /var/log/buildatlas/news-digest.log`

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

Operational behavior (debugging tips):
- VM `sync-data` starts with a blob change-detection check (`python -m src.sync.blob_sync --check`).
  - Exit code `2` means auth/connectivity issues (managed identity RBAC, storage firewall, token propagation).
  - `infrastructure/vm-cron/jobs/sync-data.sh` retries the check once after re-auth + token warmup to reduce flakiness.
- `infrastructure/vm-cron/jobs/health-report.sh` only flags "blob sync degraded" if the **latest** `sync-data` run block
  contains `WARN: Blob storage auth failed (exit code 2)` (prevents old transient failures from paging forever).

## Secrets / Env Vars (What Must Exist)

Production secrets/env (minimum):

Backend (AKS / API):
- `DATABASE_URL`: Postgres connection string.
- `API_KEY`: required for all non-health API calls in production.
- `ADMIN_KEY`: required for `/api/admin/*` and backend deploy validation.
- `FRONT_DOOR_ID`: must match Front Door header `x-azure-fdid` in prod.
- `REDIS_URL`: optional; enables Redis caching.

Frontend (App Service / Next server-side):
- `DATABASE_URL`: used by web app for auth/data (server-side).
- `API_KEY`: used by web server-side requests to backend.
- `ADMIN_KEY`: used by web server-only proxies to backend admin endpoints (e.g. `/api/monitoring`, `/api/editorial`).
- `RESEND_API_KEY`: used by web to send subscription confirmation emails (double opt-in).
- `NEWS_DIGEST_FROM_EMAIL`, `NEWS_DIGEST_REPLY_TO`: used by web confirmation emails and digest sender.
- `PUBLIC_BASE_URL`: used to build absolute confirm/unsubscribe links in emails.
- PostHog (browser ingestion):
  - Preferred: `POSTHOG_PROJECT_API_KEY` (`phc_...`) (this is what gets embedded into the frontend bundle).
  - Back-compat: `POSTHOG_KEY` (if you use this, it must also be `phc_...`; never put a `phx_...` personal key in the browser).
- Microsoft Clarity (public project id): `CLARITY_PROJECT_ID` (repo variable recommended; or a secret if you prefer).
- `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.

VM cron (`/etc/buildatlas/.env`):
- `SLACK_WEBHOOK_URL` (required for job notifications)
- Job-specific creds (PostHog query keys, X/Twitter tokens, etc.)

Operational notes:
- `ADMIN_KEY` is not "provided by Azure". It is a strong random secret you set.
- If you rotate `API_KEY`/`ADMIN_KEY`, you must update both:
  - AKS secret (via backend deploy) and/or App Service settings (web)
- GitHub Secrets/Variables may still exist, but primary secrets live in VM/K8s/App Service.
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
  - Infra includes `infrastructure/**` (and any deploy/cluster config).
  - Database: do not `ALTER`/`DROP`/`DELETE` tables (or ship destructive migrations) without explicit approval first.
- Prefer small, scoped commits. This repo often has a dirty worktree; do not "clean up" unrelated files.
- Do not change deploy/schedule behavior or production secrets lightly; document changes here.
- When modifying API auth/proxy rules (`apps/api/src/index.ts`), validate:
  - health endpoints still accessible
  - Front Door ID enforcement still blocks bypass in production
  - web can still call API server-side with `API_KEY`
- Before pushing UI changes:
  - `pnpm --filter web type-check`
  - `pnpm --filter web build`
- Before pushing API changes:
  - `pnpm --filter @startup-investments/api build`
  - Confirm production deploy secrets are present (AKS/App Service/VM env).
