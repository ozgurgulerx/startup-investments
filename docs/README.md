# BuildAtlas Docs Index

Use this index to find the right source of truth quickly.

## Primary Docs

| File | Purpose | Use When |
|---|---|---|
| `docs/OPERATING_MODEL.md` | Canonical architecture, deploy model, cron inventory, pipelines, incident model | You are changing infra, deployment, scheduling, or operations |
| `docs/CHANGE_CONTROL.md` | Best-practice delivery checklist and release gates | You are preparing or reviewing production-impacting changes |
| `AGENTS.md` | Operational memory, invariants, and runbook details | You need complete context before high-risk changes |
| `infrastructure/vm-cron/crontab` | Exact production cron schedules (UTC) | You need authoritative timing/job cadence |

## Quick References

| File | Scope |
|---|---|
| `docs/claude/deployment.md` | Fast deployment and rollback reference |
| `docs/claude/vm-cron.md` | VM cron operation/troubleshooting quick reference |
| `docs/claude/news-pipeline.md` | News ingest and digest pipeline details |
| `docs/claude/database-sync.md` | Startup/data sync pipeline details |

## Validation Tools

| Tool | Purpose |
|---|---|
| `scripts/verify-operating-model.sh` | Checks cron job inventory consistency between `crontab` and `docs/OPERATING_MODEL.md` |
| `.github/workflows/ops-doc-consistency.yml` | CI guard that runs the same consistency check on relevant PR/push changes |

## Legacy/Deprecated

| File | Status |
|---|---|
| `docs/PLATFORM_DESIGN.md` | Deprecated historical design notes; not valid for current production decisions |
