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

## CI/CD Workflows (Source of Truth)

Frontend:
- `.github/workflows/frontend-deploy.yml`
  - Trigger: pushes touching `apps/web/**` (and a few others).
  - Deploy: Azure App Service `buildatlas-web`.

Backend:
- `.github/workflows/backend-deploy.yml`
  - Trigger: pushes touching `apps/api/**`, `packages/shared/**`, `infrastructure/kubernetes/**`.
  - Builds/pushes Docker to ACR, then deploys to AKS via `kubectl apply`.
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
- `.github/workflows/news-ingest.yml`: builds daily news editions into Postgres.
- `.github/workflows/news-digest-daily.yml`: sends daily digest emails.

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
- `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.

Azure OIDC (Actions variables):
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`

Operational notes:
- `ADMIN_KEY` is not "provided by Azure". It is a strong random secret you set.
- If you rotate `API_KEY`/`ADMIN_KEY`, you must update both:
  - GitHub secrets (for workflows)
  - AKS secret (via backend deploy) and/or App Service settings (web)

## Performance Notes (Why Dossiers Can Be Slow)

Dealbook and signals pages are "API-first, fallback-to-files":
- Web data loader: `apps/web/lib/data/index.ts`
  - `getStartupsPaginated()` tries `api.getDealbook()` first, then falls back to file-based filtering.
  - When the API is unhealthy or returns non-200, pages may load but become much slower.
- API client: `apps/web/lib/api/client.ts`
  - Default timeout is 30s. If the API is failing, this can add latency before fallback.

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

## Change Discipline (Avoid Breaking Prod)

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

