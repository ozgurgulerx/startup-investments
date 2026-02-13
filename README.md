# Build Atlas

BuildAtlas is a full-stack intelligence platform for tracking AI startup activity, funding, and news signals.

Live production:
- Web: `https://buildatlas.net`
- API edge: `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net`

## Read This First

For operationally accurate details (architecture, deploy model, cron jobs, pipelines):
- `docs/OPERATING_MODEL.md` (canonical)
- `docs/CHANGE_CONTROL.md` (release checklist)
- `docs/README.md` (docs index)
- `AGENTS.md` (deep operational memory and invariants)

## Architecture At A Glance

Production path:
- Browser -> App Service (Next.js)
- App Service (server-side fetch) -> Front Door API endpoint
- Front Door -> AKS (Express API)
- API -> Postgres (+ Redis when configured)

Operational model:
- VM cron (`infrastructure/vm-cron`) is the primary scheduler/deploy control plane.
- GitHub Actions are mostly backup/manual for deploy/scheduled tasks, with a small set still active.

## Monorepo Layout

- `apps/web`: Next.js frontend
- `apps/api`: Express API
- `packages/shared`: shared TypeScript contracts
- `packages/analysis`: Python automation and data/news pipelines
- `database/migrations`: SQL migrations
- `infrastructure/kubernetes`: AKS manifests
- `infrastructure/vm-cron`: production scheduler/deploy scripts/monitoring
- `.github/workflows`: backup/manual and selected active automations

## Local Development

Prerequisites:
- Node.js 20+ (18+ minimum)
- pnpm 8+
- Python 3.11+ (for analysis tooling)
- Docker (optional, for local Postgres)

Install:

```bash
pnpm install
```

Run web and API:

```bash
# Web (Next.js)
pnpm dev

# API (separate shell)
pnpm dev:api
```

Run both with helper script:

```bash
pnpm dev:all
```

Build checks:

```bash
pnpm --filter web type-check
pnpm --filter web build
pnpm --filter @startup-investments/api build
```

## Data and Pipeline Commands (Local)

Database helpers:

```bash
pnpm db:start
pnpm db:logs
pnpm db:seed
pnpm db:stop
```

Analysis package entrypoint examples:

```bash
cd packages/analysis
python main.py --help
```

## Deployment and Operations

Do not use this README as the deploy runbook.

Use:
- `docs/OPERATING_MODEL.md` for production deploy flow and cron inventory.
- `docs/claude/deployment.md` for fast deploy commands.
- `docs/claude/vm-cron.md` for VM operations.

For schedule/doc consistency validation:

```bash
./scripts/verify-operating-model.sh
```

## License

Private repository. All rights reserved unless explicitly stated otherwise.
