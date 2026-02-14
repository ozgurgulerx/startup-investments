# Change Control Checklist

Use this checklist for any production-impacting change.

Canonical context:
- `docs/OPERATING_MODEL.md`
- `AGENTS.md`

## 1) Classify the Change

Mark all that apply:

- Frontend runtime (`apps/web/**`)
- API runtime (`apps/api/**`)
- Shared contract/types (`packages/shared/**`)
- Analysis/pipeline logic (`packages/analysis/**`)
- Cron schedule/runner/deploy (`infrastructure/vm-cron/**`)
- Kubernetes/deploy config (`infrastructure/kubernetes/**`)
- GitHub workflows (deprecated; removed from this repo) (`.github/workflows/**`)
- Database migration (`database/migrations/**`)
- Data sync behavior (`scripts/sync-startups-to-db.py`, `scripts/populate-analysis-data.py`, `infrastructure/vm-cron/jobs/sync-data.sh`)

## 2) Pre-Merge Safety Checks

### Always required

- Ensure no secrets are exposed in code or logs.
- Confirm API auth/header invariants still hold.
- Confirm health endpoints remain cheap and public.
- Confirm Kubernetes manifests do not use floating `:latest` image tags:
  - `bash scripts/check-k8s-no-latest.sh`
- Update docs when operational behavior changes.

### Frontend changes

```bash
pnpm --filter web type-check
pnpm --filter web build
```

### API changes

```bash
pnpm --filter @startup-investments/api build
```

### Cron/schedule changes

- Update `infrastructure/vm-cron/crontab` and `docs/OPERATING_MODEL.md` together.
- Run:

```bash
./scripts/verify-operating-model.sh
# or
pnpm ops:verify-docs
```

### Migration changes

- Ensure migration is idempotent/safe for repeated execution.
- Ensure migration path is covered by `infrastructure/vm-cron/jobs/apply-migrations.sh`.
- Document rollback impact if migration is not trivially reversible.

## 3) Deployment Readiness Gate

Confirm before release:

- Affected control plane is known (VM cron vs AKS CronJobs).
- Required env vars/secrets are present for affected surface.
- Rollback path is prepared (known-good image/commit or automated rollback script).

## 4) Post-Deploy Verification

Minimum checks:

```bash
curl -i https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health
curl -I https://buildatlas.net
```

Then verify relevant job logs:

- `/var/log/buildatlas/code-update.log`
- `/var/log/buildatlas/backend-deploy.log`
- `/var/log/buildatlas/frontend-deploy.log`
- pipeline-specific logs (`news-ingest`, `news-digest`, `sync-data`, etc.)

## 5) Incident-Ready Rollback Trigger

Rollback immediately when:

- health checks fail repeatedly after deploy,
- user-facing latency/error rate sharply degrades,
- data integrity risk is detected.

Preferred rollback strategy:

- backend: rely on `backend-deploy.sh` automatic rollback first,
- frontend: redeploy a known-good commit/image,
- data sync/pipeline: stop failing loop, restore known-good data path, then replay safely.

## 6) PR Checklist Template

Copy into PR description:

- [ ] Change type(s) identified
- [ ] Invariants reviewed (auth/health/secrets)
- [ ] Required build/type checks passed
- [ ] Cron/doc drift check passed (if applicable)
- [ ] Required docs updated in same PR
- [ ] Rollback plan stated
- [ ] Post-deploy verification plan stated
