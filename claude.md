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

**CI/CD:** GitHub push → Docker image build → ACR → AKS deployment. GitHub Actions for Functions + DB sync (+ manual backup workflows). No VM in the critical path.

**Scheduled jobs:** Run as AKS `CronJob` resources in the `default` namespace (image `aistartuptr.azurecr.io/buildatlas-pipelines:<sha>`). Inspect via `kubectl get cronjob`, `kubectl get jobs`, `kubectl logs <pod>`. Common knobs:

- `activeDeadlineSeconds` on the jobTemplate spec (bump if jobs hit it mid-run — default is stingy after source expansion)
- `concurrencyPolicy: Forbid` prevents overlapping jobs when a run is slow
- Env/secrets injected via `buildatlas-pipelines-config` ConfigMap + `buildatlas-pipelines-secrets` Secret

**Key CronJobs** (most relevant to news/memory):

- `news-ingest` — hourly `15 * * * *` — builds daily editions for both regions
- `news-digest` — hourly `45 * * * *` — sends emails to subs in the target local hour window
- `weekly-brief`, `monthly-brief`, `dealbook-brief` — self-describing schedules
- `digest-qa` — every 3h; useful for manual QA sends

**Triggering a manual run:** `kubectl create job my-name --from=cronjob/news-ingest`. Then `kubectl logs job/my-name -f`.

**Historic note:** Earlier iteration used `vm-buildatlas-cron` on an Azure VM; that path is **deprecated and removed**. Shell scripts under `infrastructure/vm-cron/jobs/` are still the entrypoints the CronJobs invoke inside the container, but there is no VM to SSH into and no `ssh buildatlas@...` flow. Anything that used to live on the VM now runs as an AKS pod.

**LLM Model Policy:** All LLM calls MUST use `gpt-5-nano` via `AZURE_OPENAI_DEPLOYMENT_NAME` env var. Never hardcode model names.

**Root package.json:** NEVER add `dependencies` or `devDependencies` to the root `package.json`. All deps belong in workspace packages (`apps/web`, `apps/api`, `packages/shared`). Root deps cause Docker build failures from lockfile mismatches.

### Key URLs

| Service          | URL                                                          |
| ---------------- | ------------------------------------------------------------ |
| Frontend         | `https://buildatlas.net`                                     |
| API (Front Door) | `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net`        |
| API Health       | `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health` |

### Key Resource Names

| Resource    | Name                       | Resource Group        |
| ----------- | -------------------------- | --------------------- |
| App Service | `buildatlas-web`           | `rg-startup-analysis` |
| AKS         | `aks-aistartuptr`          | `aistartuptr`         |
| PostgreSQL  | `aistartupstr`             | `aistartupstr`        |
| Redis       | `aistartupstr-redis-cache` | `aistartupstr`        |
| ACR         | `aistartuptr`              | `aistartuptr`         |
| Storage     | `buildatlasstorage`        | `aistartuptr`         |

### kubectl Context

**ALWAYS verify `kubectl config current-context` is `aks-aistartuptr` before running ANY kubectl command.** This machine has multiple AKS clusters; the wrong context silently returns "not found" for our resources.

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
infrastructure/    — K8s manifests, Azure Functions, pipeline job scripts
  vm-cron/jobs/    — Shell entrypoints invoked by AKS CronJobs (legacy dir name; no VM involved)
  kubernetes/      — AKS CronJob + Job manifests, configmap, secrets
database/migrations/ — SQL migration files
```

## Git Workflow

Push after every change. Commit messages: concise and descriptive. A GitHub push to `main` triggers the `buildatlas-pipelines` image build (tagged with the short SHA) and pushes to ACR. AKS CronJobs reference the image by tag and pick up new code on their next scheduled run — no VM pull loop.

## Reference Documentation

Read these files on-demand when the task requires it:

| File                                   | When to read                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/claude/news-pipeline.md`         | News ingest, memory gate, Turkey sources, periodic briefs                                                                                       |
| `docs/claude/logo-extraction.md`       | Logo extraction pipeline                                                                                                                        |
| `docs/claude/deployment.md`            | Deploying API (AKS) or frontend (App Service)                                                                                                   |
| `docs/claude/config-management.md`     | Changing env vars, secrets, or configuration sync                                                                                               |
| `docs/claude/azure-services.md`        | Working with Azure resources, Functions, or checking resource inventory                                                                         |
| `docs/claude/data-regeneration.md`     | Regenerating stats, briefs, enriched CSVs, or data consistency questions                                                                        |
| `docs/claude/monthly-update.md`        | Processing new monthly CSV data                                                                                                                 |
| `docs/claude/database-sync.md`         | Syncing data to PostgreSQL, schema questions                                                                                                    |
| `docs/claude/database-and-search.md`   | Full database schema, vector search (pgvector), news tables, memory system                                                                      |
| `docs/claude/infrastructure-health.md` | Debugging production issues (504s, CrashLoopBackOff, Redis down)                                                                                |
| `docs/claude/email-infrastructure.md`  | Working on email/newsletter features (Resend API)                                                                                               |
| `docs/claude/frontend-patterns.md`     | Working on frontend copy, UI, dual-audience messaging                                                                                           |
| `docs/claude/card-schema.md`           | Brief card format and components                                                                                                                |
| `docs/SYSTEMS_AUDIT.md`                | Full 40-question due-diligence audit: data ingestion, entity resolution, signals model, LLM pipeline, storage, UI/UX, operations, business/moat |
