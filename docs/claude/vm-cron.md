# VM Cron Operations (Current)

Canonical reference: `docs/OPERATING_MODEL.md`

This file is a quick VM operations guide for day-to-day debugging.

## Access

Preferred access path:

```bash
./infrastructure/vm-cron/ssh-update-ip.sh
```

This script updates NSG rules for your current IP and then SSHs to the VM.

## Core Files

- `infrastructure/vm-cron/crontab` (schedule source of truth)
- `infrastructure/vm-cron/lib/runner.sh` (timeouts, locks, env sourcing, logs, Slack)
- `infrastructure/vm-cron/deploy.sh` (git pull + conditional deploys)
- `infrastructure/vm-cron/jobs/*.sh` (job implementations)
- `infrastructure/vm-cron/monitoring/heartbeat.sh` (VM self-health)

## Operational Behavior

- Times are UTC.
- Most jobs run via `runner.sh`.
- Logs go to `/var/log/buildatlas/<job>.log`.
- Per-job lock files prevent overlap: `/tmp/buildatlas-<job>.lock`.
- Git operations are serialized via `/tmp/buildatlas-git.lock`.

## High-impact Jobs

- `keep-alive`: keeps Postgres/AKS/API/frontend reachable.
- `code-update`: pulls latest code and triggers deploys.
- `sync-data`: blob sync -> DB sync -> commit/push -> frontend deploy.
- `news-ingest` and `news-digest`: news publication and subscriber delivery.
- `release-reconciler` + `heartbeat`: drift/staleness detection.

For full schedule and timeouts, see `infrastructure/vm-cron/crontab`.

## Verify Health Quickly

```bash
# VM cron sanity
infrastructure/vm-cron/verify.sh

# Cron/doc inventory consistency
./scripts/verify-operating-model.sh

# Recent logs
tail -n 80 /var/log/buildatlas/keep-alive.log
tail -n 80 /var/log/buildatlas/code-update.log
tail -n 80 /var/log/buildatlas/frontend-deploy.log
tail -n 80 /var/log/buildatlas/backend-deploy.log
```

## Manual Job Runs

```bash
# Generic pattern
/opt/buildatlas/startup-analysis/infrastructure/vm-cron/lib/runner.sh <job-name> <timeout-min> <script-path>

# Example: run keep-alive
/opt/buildatlas/startup-analysis/infrastructure/vm-cron/lib/runner.sh \
  keep-alive 20 \
  /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/keep-alive.sh
```

## Failure Triage

1. Check if cron daemon is active.
2. Check lock files for stale jobs.
3. Check heartbeat log for overdue-job alerts.
4. Check the target job log.
5. If deployment related, check `frontend-deploy.log` / `backend-deploy.log` and rerun via `runner.sh`.
