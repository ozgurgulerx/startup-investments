# Deployment Guide (Current)

Canonical reference: `docs/OPERATING_MODEL.md`
Change gate reference: `docs/CHANGE_CONTROL.md`

This file is a quick operational cheatsheet. If anything conflicts, use the canonical document and the scripts themselves.

## Deployment Ownership

| Surface | Primary Path | Backup Path |
|---|---|---|
| Frontend (`apps/web`) | VM cron `infrastructure/vm-cron/jobs/frontend-deploy.sh` | Manual VM run (same job via `runner.sh`) |
| Backend (`apps/api`) | VM cron `infrastructure/vm-cron/jobs/backend-deploy.sh` | Manual VM run (same job via `runner.sh`) |
| Functions (`infrastructure/azure-functions`) | VM cron `infrastructure/vm-cron/jobs/functions-deploy.sh` | Manual VM run (same job via `runner.sh`) |
| Pipelines (`buildatlas-pipelines`) | VM job `infrastructure/vm-cron/jobs/pipelines-deploy.sh` (build+apply) | Manual `kubectl apply` from the VM (patch `__IMAGE_TAG__`) |
| Data refresh + web publish | VM cron `infrastructure/vm-cron/jobs/sync-data.sh` | Manual VM run (same job via `runner.sh`) |
| News ingest | AKS CronJob `news-ingest` | `kubectl create job --from=cronjob/news-ingest ...` (or re-enable VM fallback job) |
| News digest | AKS CronJob `news-digest` | `kubectl create job --from=cronjob/news-digest ...` (or re-enable VM fallback job) |

## VM-triggered Deploy Flow

- `infrastructure/vm-cron/deploy.sh` runs every 15 minutes.
- It pulls latest `main`, ensures crontab drift is corrected, and conditionally triggers:
  - backend deploy for `apps/api`, `packages/shared`, `infrastructure/kubernetes` changes
  - frontend deploy for `apps/web`, `packages/shared` changes

## Manual Commands (VM)

```bash
# Backend
/opt/buildatlas/startup-analysis/infrastructure/vm-cron/lib/runner.sh \
  backend-deploy 20 \
  /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/backend-deploy.sh

# Frontend
/opt/buildatlas/startup-analysis/infrastructure/vm-cron/lib/runner.sh \
  frontend-deploy 25 \
  /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/frontend-deploy.sh

# Pipelines (AKS CronJobs)
/opt/buildatlas/startup-analysis/infrastructure/vm-cron/lib/runner.sh \
  pipelines-deploy 30 \
  /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/pipelines-deploy.sh
```

## Required Backend Deploy Env

- `DATABASE_URL`
- `API_KEY`
- `ADMIN_KEY`
- `FRONT_DOOR_ID`

Optional but recommended:
- `REDIS_URL`
- `APPLICATIONINSIGHTS_CONNECTION_STRING`
- Azure/OpenAI settings used by API features

## Post-deploy Verification

```bash
# API health
curl -i https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health

# Frontend live
curl -I https://buildatlas.net
```

Logs:
- `/var/log/buildatlas/backend-deploy.log`
- `/var/log/buildatlas/frontend-deploy.log`
- `/var/log/buildatlas/functions-deploy.log`

## Do Not Break

- Keep API health endpoints public: `/health`, `/healthz`, `/readyz`.
- Keep Front Door + API key checks in API middleware.
- Do not expose `API_KEY`/`ADMIN_KEY` to browser runtime.
- Do not remove rollback behavior from `backend-deploy.sh`.
