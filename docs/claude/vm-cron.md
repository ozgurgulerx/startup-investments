# VM Cron Infrastructure

All scheduled jobs and deployments run on `vm-buildatlas-cron` (B2s, UK South, `aistartuptr` RG).

## SSH Access

```bash
ssh buildatlas@20.90.104.162
```

**SSH unreachable? Fix NSG rules immediately — do NOT waste time troubleshooting.**
Azure periodically clears the NSG SSH rules (JIT expiry). Run these two commands to restore access:
```bash
MY_IP=$(curl -s https://ifconfig.me)
az network nsg rule create --nsg-name vm-buildatlas-cronNSG --resource-group aistartuptr --name AllowSSH --priority 100 --access Allow --direction Inbound --protocol Tcp --destination-port-ranges 22 --source-address-prefixes $MY_IP -o none
az network nsg rule create --nsg-name "vm-buildatlas-cronVNET-vm-buildatlas-cronSubnet-nsg-uksouth" --resource-group aistartuptr --name AllowSSH --priority 100 --access Allow --direction Inbound --protocol Tcp --destination-port-ranges 22 --source-address-prefixes $MY_IP -o none
```
Both the NIC-level and subnet-level NSGs need the rule — one alone is not enough.

## How It Works

- `runner.sh` wrapper: sources `/etc/buildatlas/.env`, flock locking, timeout, logging to `/var/log/buildatlas/`, Slack on failure
- Code updates every 15 min (`deploy.sh`, staggered at :07/:22/:37/:52): pulls latest, auto-triggers backend/frontend deploys if `apps/api/**` or `apps/web/**` changed
- `sync-data.sh` triggers `frontend-deploy.sh` after pushing data changes

## Scheduled Cron Jobs (all UTC)

| Job | Schedule | What it does |
|-----|----------|-------------|
| `keep-alive` | Every 15 min | PostgreSQL + AKS + API + Frontend health checks |
| `news-ingest` | Hourly :15 | Fetch + LLM-enrich news articles |
| `crawl-frontier` | Every 30 min | Crawl frontier URLs |
| `news-digest` | Hourly :45 | Send email digests (timezone-aware, 08:45 local) |
| `health-report` | Every 4 hours :45 | Infrastructure health summary to Slack (8 checks) |
| `slack-summary` | Daily 14:00 | Ops summary to Slack |
| `sync-data` | 30 min all days | Blob sync → DB sync → logo extraction → git push → frontend deploy |
| `code-update` | Every 15 min (staggered) | git pull → conditional backend/frontend deploy |
| `heartbeat` | Every 5 min | VM health (disk, memory, cron, stale locks) |

## Deploy Jobs (triggered, not scheduled)

| Job | Trigger | What it does |
|-----|---------|-------------|
| `frontend-deploy` | sync-data or code-update (web changes) or manual | Next.js Docker build via ACR, `az webapp deploy` |
| `backend-deploy` | code-update (api changes) or manual | `az acr build` (remote), K8s secret update, `kubectl apply` |

## Manual Deploy Commands

```bash
# Frontend (local — no SSH needed, just `az login`)
./scripts/deploy-frontend.sh              # Build + deploy + smoke check (~7 min)
./scripts/deploy-frontend.sh --no-smoke   # Skip smoke check
./scripts/deploy-frontend.sh --restart    # Just restart App Service (no build)
./scripts/deploy-frontend.sh --via-vm     # Trigger on VM via az run-command (no SSH)

# Frontend (on VM via SSH)
runner.sh frontend-deploy 20 /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/frontend-deploy.sh

# Backend (on VM via SSH)
runner.sh backend-deploy 15 /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/backend-deploy.sh
```

## Key Files

`infrastructure/vm-cron/` — `setup.sh`, `deploy.sh`, `lib/runner.sh`, `jobs/*.sh`, `monitoring/heartbeat.sh`, `.env.example`
