# Logo Extraction Pipeline

Logos are automatically extracted for every startup during the `sync-data` pipeline (both blob-change and daily sync-only paths). The extraction runs after DB sync and before git commit/push. Failures are non-blocking.

## Pipeline Position

```
sync-data.sh pipeline:
  CSV upsert → analysis population → LOGO EXTRACTION → git commit → push → deploy
```

## How It Works

`LogoExtractor` (6 strategies in priority order):
1. Open Graph image (`og:image`)
2. Twitter card image (`twitter:image`)
3. HTML logo tags (class/id/alt containing "logo")
4. Apple touch icon
5. Favicon
6. Clearbit Logo API (fallback)

## Storage

`startups.logo_data` (BYTEA) + `logo_content_type` + `logo_updated_at` in PostgreSQL. Served via `/api/startups/:slug/logo` endpoint. Frontend `CompanyLogo` component fetches from API with initials fallback.

## CLI

```bash
python main.py extract-logos --concurrent 10
```
Extracts logos for all startups missing them (idempotent, skips existing).

## Key Files

- `packages/analysis/src/crawler/logo_extractor.py` — LogoExtractor class
- `infrastructure/vm-cron/jobs/sync-data.sh` — pipeline integration (both paths)
- `apps/api/src/index.ts` — `/api/startups/:slug/logo` endpoint
- `apps/web/components/ui/company-logo.tsx` — frontend component
- `database/migrations/005_add_logo_storage.sql` — schema
