# Deployment Guide (Current)

Canonical reference: `docs/OPERATING_MODEL.md`
Change gate reference: `docs/CHANGE_CONTROL.md`

This file is a quick operational cheatsheet. If anything conflicts, use the canonical document and the live workflows/manifests.

## Deployment Ownership

| Surface | Primary Path | Manual Fallback |
|---|---|---|
| Frontend (`apps/web`) | GitHub Actions `deploy-frontend.yml` | `workflow_dispatch` or manual App Service image update |
| Backend (`apps/api`) | GitHub Actions `deploy-backend.yml` | `workflow_dispatch` or manual `kubectl apply` with a pinned image tag |
| Functions (`infrastructure/azure-functions`) | GitHub Actions `deploy-functions.yml` | `workflow_dispatch` or manual Azure Functions deploy |
| Pipelines (`buildatlas-pipelines`) | GitHub Actions `deploy-pipelines.yml` | Build/push image, then apply `infrastructure/kubernetes/pipelines-*.yaml` with a pinned tag |
| Database migrations | GitHub Actions `migrations.yml` | `workflow_dispatch` or run `scripts/apply_migrations.py` from an operator environment |
| Data refresh + publish | AKS CronJob `sync-data` | `kubectl create job --from=cronjob/sync-data ...` |

## AKS CronJobs

- Runtime schedules live in `infrastructure/kubernetes/pipelines-cronjobs.yaml`.
- One-off execution pattern:

```bash
kubectl create job --from=cronjob/product-canary product-canary-manual-$(date +%s)
kubectl logs -f job/product-canary-manual-<timestamp>
```

## Post-deploy Verification

```bash
kubectl get cronjobs
curl -i https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health
curl -I https://buildatlas.net
```

## Do Not Break

- Keep API health endpoints public: `/health`, `/healthz`, `/readyz`.
- Keep Front Door + API key checks in API middleware.
- Do not expose `API_KEY`/`ADMIN_KEY` to browser runtime.
- Do not remove rollback behavior from `backend-deploy.sh`.
