# Build Atlas Agent Notes (Do Not Delete)

This file is the "memory" for humans and coding agents working in this repo.
Keep it current. When you make an architectural change, change a workflow, or
introduce a new invariant/secret, update this file in the same PR/commit.

Goals:
- Prevent context loss between dev runs.
- Make recovery/debug of "site is slow/down" deterministic.
- Avoid accidental changes that break deploys, auth, or data pipelines.

Last verified: 2026-02-07

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
- Health endpoints are intentionally public:
  - `/health`, `/healthz`, `/readyz` are not API-key protected.

## Critical Invariants (Don’t Break These)

- Do not expose `API_KEY` or `ADMIN_KEY` to the browser.
  - Web uses `process.env.API_KEY` only in Server Components / API routes.
- Keep `/health` cheap and reachable (Front Door probe + diagnostics).
- Keep the API deployable when AKS is running:
  - `backend-deploy.yml` must be able to connect to the AKS control plane.
- Avoid making `/dealbook` depend on slow file-based reads in steady state:
  - When API is down, web falls back to file reads; this is a degradation mode.
- News email subscriptions are **double opt-in**:
  - New signups are stored as `pending_confirmation` and must be activated via the emailed confirmation link.
  - Unsubscribe is token-based (`GET /api/news/subscriptions?token=...`); do not add raw email-based unsubscribe endpoints.

## CI/CD Workflows (Source of Truth)

Primary automation is now **VM cron** (cost control) and GitHub Actions workflows are kept as **manual backups**.

VM cron runner:
- Config: `infrastructure/vm-cron/crontab`
- Wrapper (locks, timeouts, logs, Slack alerts): `infrastructure/vm-cron/lib/runner.sh`
- Code updater (git pull + triggers deploys): `infrastructure/vm-cron/deploy.sh`
- One-time setup/bootstrap (packages, venv, logrotate, crontab): `infrastructure/vm-cron/setup.sh`
- VM sanity checks (cron service + crontab contents): `infrastructure/vm-cron/verify.sh`
- Logs: `/var/log/buildatlas/*.log` on the VM (see `scripts/slack_daily_summary.py` for parsing expectations)
- VM access (for manual deploy/debug):
  - Preferred: `./infrastructure/vm-cron/ssh-update-ip.sh`
    - Updates SSH NSG allowlist to your current public IP, then SSHs into the VM.
  - Manual SSH:
    - Get IP: `AZURE_CLI_DISABLE_LOGFILE=1 az vm show -g aistartuptr -n vm-buildatlas-cron --show-details --query publicIps -o tsv`
    - Connect: `ssh buildatlas@<vm_ip>`
  - No-SSH option (run a command remotely):
    - `AZURE_CLI_DISABLE_LOGFILE=1 az vm run-command invoke -g aistartuptr -n vm-buildatlas-cron --command-id RunShellScript --scripts "<cmd>" --query "value[0].message" -o tsv`
- Slack notifications:
  - Set `SLACK_WEBHOOK_URL` (or legacy `SLACK_WEBHOOK`) in `/etc/buildatlas/.env`.
  - Optional success notifications for selected jobs via `SLACK_NOTIFY_SUCCESS_JOBS` (see `infrastructure/vm-cron/.env.example`).
  - GitHub push notifications:
    - Each push to `main` posts a Slack message via `.github/workflows/slack-commit-notify.yml` (uses repo secret `SLACK_WEBHOOK_URL`).
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

### News Regions (Global vs Turkey)

Daily news editions are **partitioned by region**:
- Canonical regions: `global`, `turkey`
- DB schema (see `database/migrations/020_news_editions_by_region.sql`):
  - `news_sources.region` tags sources so Turkey editions can be built from Turkey-focused sources.
  - `news_daily_editions.region` partitions editions (`PRIMARY KEY (edition_date, region)`).
  - `news_topic_index.region` partitions topic browsing (`PRIMARY KEY (topic, cluster_id, edition_date, region)`).
- Ingest behavior (`packages/analysis/src/automation/news_ingest.py`):
  - Writes **both** `global` and `turkey` editions per run.
  - Turkey edition includes clusters that contain at least one member from a Turkey-tagged source (e.g. Webrazzi, Egirisim).

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

Safe test mode:
- Use `dry_run` to validate the pipeline without sending emails or writing deliveries:
  - Manual dispatch: `gh workflow run \"Daily Startup News Digest\" -f region=all -f dry_run=true`
  - CLI: `cd packages/analysis && python main.py send-news-digest --region global --dry-run`

Debug commands:
- Latest runs:
  - `gh run list --workflow \"Daily Startup News Digest\" -L 5`
  - `gh run view <run_id> --log-failed`

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

API limitations and performance implications:
- Backend API serves **global** dataset only.
- When `region != global`, the web app bypasses API calls and reads from files (slower; acceptable as a fallback/region mode).

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

The `/news` page uses a master-detail "radar" layout:

```
[Sticky CommandBar] — search | sort (impact/latest) | time window (6h/24h/7d/all) | topics
[KpiStrip] — stories | cross-source | clusters | entities (collapsible)
┌─────────────────────────────────┬───────────────────┐
│ Feed (lg:col-span-8)            │ Context (lg:4)    │
│  [PinnedStoryCard]              │ Default: SignalRail│
│  [StoryRow] × N                 │ Selected: Detail   │
└─────────────────────────────────┴───────────────────┘
```

- Client component: `components/news/interactive-radar.tsx`
- Story selection: URL param `?story=id` (shareable, supports back/forward)
- Live polling: 5-minute interval, disabled on archive pages (`isArchive` prop)
- Mobile: context panel renders as a fixed overlay sheet

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
