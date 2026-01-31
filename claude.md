# Claude Code Guidelines

## CRITICAL SAFETY RULES

**READ THIS FIRST - THESE RULES ARE NON-NEGOTIABLE**

1. **DO NOT touch any Azure services outside this project** - Other services in the Azure subscription are production systems for other projects
2. **DO NOT modify, delete, or alter any database records** unless explicitly instructed - Always ask for confirmation before any database changes
3. **DO NOT tamper with running services** - AKS, App Service, PostgreSQL, Front Door are live production systems
4. **DO NOT run destructive commands** - No `DROP`, `DELETE`, `TRUNCATE`, `kubectl delete`, `az delete`, etc. without explicit user confirmation
5. **DO NOT modify Azure resource configurations** - Network rules, secrets, scaling settings, etc. are carefully configured
6. **ONLY work with local files and git** - The safe operations are: reading files, editing code, generating reports, git commits/push
7. **When in doubt, ASK** - If unsure whether an operation is safe, stop and ask the user

### Database Safety Rules (ABSOLUTE - NO EXCEPTIONS)

**NEVER execute these SQL commands without explicit user confirmation:**
- `DROP TABLE` / `DROP DATABASE` / `DROP SCHEMA`
- `TRUNCATE TABLE`
- `DELETE FROM` (especially without WHERE clause or with broad WHERE)
- `ALTER TABLE DROP COLUMN`
- Any schema migration that removes tables or columns

**This applies to ALL databases:**
- The BuildAtlas PostgreSQL (`aistartupstr`)
- Any other database in the Azure subscription
- Any database you might connect to for any reason

**The correct way to update data is via UPSERT patterns:**
```sql
-- CORRECT: Use INSERT ... ON CONFLICT for safe updates
INSERT INTO startups (name, website, funding_amount, ...)
VALUES ($1, $2, $3, ...)
ON CONFLICT (id) DO UPDATE SET
    funding_amount = EXCLUDED.funding_amount,
    updated_at = NOW();

-- NEVER: Do not delete and re-insert
DELETE FROM startups WHERE period = '2026-01';  -- FORBIDDEN
INSERT INTO startups ...;
```

### Azure Resource Rules (ABSOLUTE - NO EXCEPTIONS)

**All Azure resources ALREADY EXIST. Never recreate them:**
- Never run `az group create` for existing resource groups
- Never run `az webapp create`, `az aks create`, `az postgres flexible-server create`
- Never delete and recreate resources to "fix" issues
- Never modify network rules, firewall settings, or private endpoints

**If something seems broken:**
1. Check logs first (`az webapp log`, `kubectl logs`)
2. Ask the user before taking any action
3. Prefer restarting over recreating

### Safe Operations
- Reading/writing local files in this repository
- Running Python scripts for data processing (local only)
- Git operations (add, commit, push)
- Generating reports and statistics from CSV data
- Viewing Azure resources (read-only `az` commands)
- `SELECT` queries on databases (read-only)

### Dangerous Operations (REQUIRE EXPLICIT CONFIRMATION)
- Any `az` command that modifies resources
- Any `kubectl` command that modifies deployments
- Any database INSERT/UPDATE/DELETE operations
- Uploading to blob storage
- Modifying GitHub secrets or workflows
- Any `DROP`, `TRUNCATE`, `ALTER TABLE DROP` commands
- Schema migrations

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BUILD ATLAS                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐         ┌──────────────────────────────────────────────┐  │
│  │   Users     │         │              AZURE FRONT DOOR                │  │
│  │  (Browser)  │────────▶│  startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net │  │
│  └─────────────┘         └──────────────────┬───────────────────────────┘  │
│                                             │                               │
│                                             ▼                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         AZURE APP SERVICE                             │  │
│  │                         (buildatlas-web)                              │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │                    NEXT.JS APP (Standalone)                     │  │  │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │  │  │
│  │  │  │  Marketing   │  │     App      │  │        Auth          │  │  │  │
│  │  │  │   Pages      │  │    Pages     │  │    (NextAuth.js)     │  │  │  │
│  │  │  │  /, /login   │  │ /brief       │  │  Google OAuth        │  │  │  │
│  │  │  │  /terms      │  │ /dealbook    │  │                      │  │  │  │
│  │  │  │  /privacy    │  │ /signals     │  └──────────────────────┘  │  │  │
│  │  │  │  /methodology│  │ /capital     │                            │  │  │
│  │  │  └──────────────┘  │ /library     │                            │  │  │
│  │  │                    │ /watchlist   │                            │  │  │
│  │  │                    │ /company/[x] │                            │  │  │
│  │  │                    └──────────────┘                            │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  │  URL: https://buildatlas.net | https://buildatlas-web.azurewebsites.net│ │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                             │                               │
│                                             ▼                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    AZURE KUBERNETES SERVICE (AKS)                     │  │
│  │                         (aks-aistartuptr)                             │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │                     EXPRESS.JS API                              │  │  │
│  │  │              startup-investments-api:latest                     │  │  │
│  │  │  ┌────────────────┐  ┌─────────────────────────────────────┐   │  │  │
│  │  │  │  /health       │  │  /api/v1/*                          │   │  │  │
│  │  │  │  (public)      │  │  (requires X-API-Key header)        │   │  │  │
│  │  │  └────────────────┘  │  - /startups, /investors, /stats    │   │  │  │
│  │  │                      │  - /patterns, /monthly-summary      │   │  │  │
│  │  │                      └─────────────────────────────────────┘   │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  │  ACR: aistartuptr.azurecr.io                                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                             │                               │
│                                             ▼                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                  AZURE POSTGRESQL FLEXIBLE SERVER                     │  │
│  │                        (aistartupstr)                                 │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │  Tables: startups, investors, funding_rounds, patterns, etc.   │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

CI/CD: GitHub Actions
- Frontend: Push to main (apps/web/**) → Build → Deploy to App Service
- Backend:  Push to main (apps/api/**) → Build → Push to ACR → Deploy to AKS
- Functions: Push to main (infrastructure/azure-functions/**) → Deploy to Azure Functions
```

## Azure Functions Automation

Azure Functions handle automated data processing and monitoring:

### Timer-Triggered Functions

| Function | Schedule | Purpose |
|----------|----------|---------|
| `check_pending_blobs` | Every 30 min | Safety net for CSV processing |
| `monitor_websites` | Every 6 hours | Detect website content changes |
| `consume_rss_feeds` | Every hour | TechCrunch, VentureBeat RSS monitoring |
| `process_startup_events` | Every 15 min | Route events to handlers |
| `process_research_queue` | Every 30 min | LLM-based deep analysis |
| `compute_pattern_correlations` | Daily 2 AM | Pattern co-occurrence stats |

### Event-Triggered Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `process_csv_blob` | Blob upload to `startup-csvs/incoming/` | Process new startup data |

### Manual HTTP Triggers

All automation can be manually triggered via HTTP endpoints:

```bash
# Website monitoring
POST /api/trigger/websites
Body: {"limit": 50}

# RSS feed consumption
POST /api/trigger/rss
Body: {"lookback_hours": 24}

# Event processing
POST /api/trigger/events
Body: {"batch_size": 50}

# Deep research queue
POST /api/trigger/research
Body: {"batch_size": 5, "max_concurrent": 2}

# Pattern correlations
POST /api/trigger/correlations
Body: {"period": "2026-01"}
```

### Automation Components

Location: `packages/analysis/src/automation/`

- **DeepResearchConsumer**: Processes LLM-based deep analysis queue
- **StartupEventProcessor**: Routes events to appropriate handlers
- **WebsiteContentMonitor**: Detects website content changes via hash comparison
- **RSSFeedConsumer**: Monitors TechCrunch, VentureBeat, HN for mentions
- **PatternCorrelator**: Computes pattern co-occurrence statistics

### Data Flow

```
CSV Upload → Blob Storage → process_csv_blob → Delta Processing → Database
                                                      ↓
                                              startup_events created
                                                      ↓
RSS Feeds → consume_rss_feeds → startup_events ←─────┘
                                       ↓
Website Changes → monitor_websites ────┘
                                       ↓
                            process_startup_events
                                       ↓
                    deep_research_queue (if reanalysis needed)
                                       ↓
                            process_research_queue
                                       ↓
                              LLM Analysis Output
```

### Required GitHub Secrets for Functions

- `AZURE_CREDENTIALS` - Azure service principal
- `AZURE_STORAGE_CONNECTION_STRING` - Blob storage connection
- `AZURE_OPENAI_API_KEY` - OpenAI API key
- `AZURE_OPENAI_ENDPOINT` - OpenAI endpoint URL
- `DATABASE_URL` - PostgreSQL connection string

## Project Structure

```
startup-analysis/
├── apps/
│   ├── web/                    # Next.js frontend (App Service)
│   │   ├── app/
│   │   │   ├── (marketing)/    # Public pages: /, /methodology, /terms, /privacy
│   │   │   ├── (auth)/         # Auth pages: /login
│   │   │   └── (app)/          # Protected pages: /brief, /dealbook, /signals, etc.
│   │   ├── components/
│   │   ├── lib/
│   │   │   ├── copy.ts         # Central copy config (dual-audience messaging)
│   │   │   ├── audience-context.tsx  # Audience state (builders/investors)
│   │   │   └── ...
│   │   └── data/               # Static JSON data for briefs
│   └── api/                    # Express.js backend (AKS)
├── infrastructure/
│   ├── kubernetes/             # K8s manifests for AKS
│   └── azure-functions/        # Azure Functions (automation)
│       ├── function_app.py     # All function definitions
│       ├── host.json           # Runtime configuration
│       └── requirements.txt    # Python dependencies
├── database/
│   └── migrations/             # SQL migrations
└── packages/
    ├── shared/                 # Shared types/utilities
    └── analysis/               # Python analysis package
        └── src/
            ├── automation/     # Automation components
            │   ├── db.py                    # Database helper
            │   ├── deep_research_consumer.py
            │   ├── event_processor.py
            │   ├── website_monitor.py
            │   ├── rss_consumer.py
            │   └── pattern_correlator.py
            ├── pipeline/       # CSV processing pipeline
            └── crawler/        # Web crawling & enrichment
```

## Git Workflow

**Push code after every change.** Do not accumulate changes locally.

```bash
git add -A && git commit -m "Description of change" && git push
```

- Commit messages should be concise and descriptive
- Push immediately after completing each task or fix
- CI/CD will auto-deploy based on changed paths

## Database Safety

- **Never delete any data from the database unless explicitly asked**
- Even when explicitly asked to delete data, always ask for confirmation before executing the deletion
- Prefer soft deletes (marking records as inactive/deleted) over hard deletes when possible

### Database Schema (DO NOT MODIFY WITHOUT EXPLICIT APPROVAL)

**PostgreSQL Server:** `aistartupstr.postgres.database.azure.com`
**Database:** `startupinvestments`

```
Tables (ALL EXIST - DO NOT DROP OR TRUNCATE):
├── startups              # Core startup data with funding info
├── startup_snapshots     # Monthly point-in-time snapshots
├── funding_rounds        # Individual funding round details
├── investors             # Investor profiles (VCs, angels, corporates)
├── investments           # Junction: investors ↔ funding rounds
├── startup_events        # Events triggering re-analysis
├── deep_research_queue   # LLM analysis queue
├── pattern_correlations  # Pattern co-occurrence statistics
├── crawl_logs            # Website crawl history
├── users                 # Authenticated users
├── watchlist_items       # User's saved startups
├── newsletters           # Generated newsletter content
└── startup_briefs        # Versioned brief content
```

**Forbidden SQL Operations:**
- `DROP TABLE` any of the above tables
- `TRUNCATE TABLE` any table
- `DELETE FROM table` without specific WHERE clause
- `ALTER TABLE DROP COLUMN` on any table
- Schema changes that remove data

### Correct Database Update Process

The database is updated via Azure Functions, NOT directly:

```
CSV File → Azure Blob Storage (incoming/)
              ↓
    Azure Function: process_csv_blob
              ↓
    Delta Processor classifies each startup:
    ├── NEW → INSERT new record
    ├── CHANGED → UPDATE existing record (UPSERT)
    └── UNCHANGED → Skip (update timestamp only)
              ↓
    All operations use ON CONFLICT for safety
```

**To trigger a database update:**
1. Upload CSV to `startup-csvs/incoming/` in Azure Blob Storage
2. Azure Function automatically processes and updates database
3. Never run direct INSERT/UPDATE/DELETE on production database

### Database Sync Methods (Multiple Options)

There are three methods to sync startup data to the database, in order of preference:

#### Method 1: GitHub Actions Workflow (CI/CD)

The workflow `.github/workflows/sync-to-database.yml` automatically syncs data when CSVs change:

```yaml
# Triggers on:
- Push to main with changes to apps/web/data/**/input/startups.csv
- Manual workflow_dispatch with period parameter
```

The workflow:
1. Reads the CSV file
2. Converts to JSON
3. Calls the API admin endpoint to sync

**To manually trigger:**
```bash
gh workflow run sync-to-database.yml --field period=2026-01
```

**Required GitHub Secret:** `API_KEY`

**Known Issue:** The backend CI/CD may fail due to ACR authentication. If the API endpoint isn't deployed, use Method 3.

#### Method 2: API Admin Endpoint

The Express.js API has an admin endpoint for bulk syncing startups:

```bash
# Endpoint: POST /api/admin/sync-startups
# Auth: X-Admin-Key header (same as API_KEY)

curl -X POST https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/api/admin/sync-startups \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $API_KEY" \
  -H "X-API-Key: $API_KEY" \
  -d '{"startups": [{"name": "...", "website": "...", ...}]}'
```

**Request body format:**
```json
{
  "startups": [
    {
      "name": "Startup Name",
      "description": "Description text",
      "website": "https://example.com",
      "location": "City, State, Country, Continent",
      "industries": "AI, SaaS, Developer Tools",
      "roundType": "Series A",
      "amountUsd": "10000000",
      "announcedDate": "2026-01-15",
      "fundingStage": "Early Stage Venture",
      "leadInvestors": "Sequoia, a]i6z"
    }
  ]
}
```

**Response:**
```json
{
  "message": "Sync completed",
  "results": {
    "total": 282,
    "inserted": 109,
    "updated": 173,
    "failed": []
  }
}
```

#### Method 3: Direct Database Sync (Fallback)

When CI/CD is broken or API is unavailable, sync directly to PostgreSQL:

```bash
# Requires: DATABASE_URL in .env file, psycopg2-binary installed
/opt/homebrew/bin/python3 << 'EOF'
import csv
import re
import psycopg2

# Read DATABASE_URL from .env
with open('.env', 'r') as f:
    for line in f:
        if line.startswith('DATABASE_URL='):
            database_url = line.split('=', 1)[1].strip().strip('"')
            break

conn = psycopg2.connect(database_url)
cur = conn.cursor()

def slugify(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

csv_path = "apps/web/data/2026-01/input/startups.csv"
inserted, updated = 0, 0

with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        name = row.get('Transaction Name', '')
        if ' - ' in name:
            name = name.split(' - ', 1)[1]

        slug = slugify(name)
        location = row.get('Organization Location', '').split(', ')

        cur.execute("SELECT id FROM startups WHERE slug = %s", (slug,))
        existing = cur.fetchone()

        if existing:
            cur.execute("""
                UPDATE startups SET
                    description = COALESCE(%s, description),
                    website = COALESCE(%s, website),
                    updated_at = NOW()
                WHERE id = %s
            """, (row.get('Organization Description'), row.get('Organization Website'), existing[0]))
            updated += 1
        else:
            cur.execute("""
                INSERT INTO startups (name, slug, description, website)
                VALUES (%s, %s, %s, %s) RETURNING id
            """, (name, slug, row.get('Organization Description'), row.get('Organization Website')))
            inserted += 1

        conn.commit()

print(f"Inserted: {inserted}, Updated: {updated}")
cur.close()
conn.close()
EOF
```

**Prerequisites for direct sync:**
- Your IP must be in the PostgreSQL firewall rules
- `DATABASE_URL` must be in `.env` file
- `psycopg2-binary` must be installed

**Check your IP is allowed:**
```bash
# Get your current IP
curl -s ifconfig.me

# List firewall rules
az postgres flexible-server firewall-rule list \
  --resource-group aistartupstr \
  --name aistartupstr -o table
```

### Known Infrastructure Blockers

**Storage Account (`buildatlasstorage`):**
- `publicNetworkAccess: Disabled` - Cannot upload from external networks
- `allowSharedKeyAccess: false` - Connection strings don't work
- Only Azure services and private endpoints can access
- **Workaround:** Use Method 2 (API) or Method 3 (direct DB) instead

**Backend CI/CD:**
- ACR authentication may fail in GitHub Actions
- Error: "Unable to get AAD authorization tokens"
- **Workaround:** Deploy manually with Docker, or use Method 3

## API Security Architecture

**Direct access to the API is blocked.** All requests must go through Azure Front Door.

- **Production URL**: `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net`
- **API Key required**: Include `X-API-Key` header on all `/api/*` requests
- **Health endpoint**: `/health` is public (no auth) for K8s probes
- **AKS IP (172.211.176.100)**: Direct access returns 403 Forbidden

When making API calls from frontend code, always use the Front Door URL and include the API key header.

## Backend (API) Deployment to AKS

### Prerequisites
- Azure CLI logged in: `az login`
- AKS credentials: `az aks get-credentials --resource-group aistartuptr --name aks-aistartuptr`
- ACR login: `az acr login --name aistartuptr`

### Quick Deploy (after code changes)
```bash
# 1. Build and push (MUST use linux/amd64 for AKS)
docker buildx build --platform linux/amd64 -t aistartuptr.azurecr.io/startup-investments-api:latest --push apps/api

# 2. Restart deployment to pull new image
kubectl rollout restart deployment/startup-investments-api

# 3. Watch rollout status
kubectl rollout status deployment/startup-investments-api --timeout=180s
```

### Troubleshooting
```bash
# Check pod status
kubectl get pods -l app=startup-investments-api

# View logs
kubectl logs deployment/startup-investments-api --tail=50

# Check if AKS is running
az aks show --resource-group aistartuptr --name aks-aistartuptr --query 'powerState.code' -o tsv

# Start AKS if stopped
az aks start --resource-group aistartuptr --name aks-aistartuptr

# Check if PostgreSQL is running
az postgres flexible-server show --resource-group aistartupstr --name aistartupstr --query 'state' -o tsv

# Start PostgreSQL if stopped
az postgres flexible-server start --resource-group aistartupstr --name aistartupstr
```

### API Endpoints
- **Front Door (production)**: `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net`
- **Direct (blocked except health)**: `http://172.211.176.100`
- **Health**: `/health` (no auth required, for K8s probes)
- **API**: `/api/v1/*` (requires `X-API-Key` header)
- **Admin**: `/api/admin/*` (requires `X-Admin-Key` header, same as API_KEY)

### Admin Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/sync-startups` | POST | Bulk sync startups from JSON (UPSERT) |
| `/api/admin/extract-logos` | POST | Extract logos for all startups |
| `/api/admin/logo-status` | GET | Get logo extraction statistics |

**Admin endpoints are also accessible from localhost without auth** (for internal pod access).

### Security Layers
1. **Front Door ID validation** - Direct access to AKS is blocked; must go through Front Door
2. **API Key authentication** - All API requests require `X-API-Key` header
3. **CORS** - Browser requests restricted to allowed origins

### Secrets (in K8s)
```bash
# Update secrets (includes Front Door ID)
kubectl create secret generic startup-investments-secrets \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=api-key="$API_KEY" \
  --from-literal=front-door-id="$FRONT_DOOR_ID" \
  --dry-run=client -o yaml | kubectl apply -f -
```

### CI/CD
Backend auto-deploys on push to `main` when `apps/api/**` or `infrastructure/kubernetes/**` changes.
Required GitHub secrets: `AZURE_CREDENTIALS`, `DATABASE_URL`, `API_KEY`, `FRONT_DOOR_ID`

## Azure App Service Deployment

Frontend auto-deploys on push to `main` when `apps/web/**` changes.

### Deployment Mode
- Uses Next.js standalone mode (supports auth)
- Deployed via OIDC authentication to Azure App Service
- App Service Plan: `asp-startup-analysis` (B1 tier)

### Required GitHub Secrets
- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_SECRET` - NextAuth.js secret
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret

### Required GitHub Variables
- `AZURE_CLIENT_ID` - Service principal client ID
- `AZURE_TENANT_ID` - Azure AD tenant ID
- `AZURE_SUBSCRIPTION_ID` - Azure subscription ID
- `NEXTAUTH_URL` - Production URL (https://buildatlas.net)

### Live URLs
- **Production**: https://buildatlas.net
- **Azure Default**: https://buildatlas-web.azurewebsites.net

### Authentication
- Google OAuth enabled
- Protected routes: `/startups`, `/patterns`, `/trends`, `/newsletter`, `/brief`
- Login page: `/login`

## Frontend Styling Guidelines

**All frontend changes must follow the existing design system.** Do not introduce new colors, fonts, or styling patterns.

### Design Philosophy
- **Editorial/financial aesthetic** - minimal, professional, content-focused
- **Dark mode primary** (obsidian base with warm text)
- **Accent used sparingly** - warm amber (`--accent`) only for highlights, not decoration

### Color Palette (use CSS variables only)
- `background` / `foreground` - base colors
- `card` - elevated surfaces
- `muted` / `muted-foreground` - secondary text and backgrounds
- `accent` - sparingly for emphasis (amber)
- `border` - subtle dividers

### Typography Classes (defined in globals.css)
- Headlines: `headline-xl`, `headline-lg`, `headline-md`, `headline-sm`
- Body: `body-lg`, `body-md`, `body-sm`
- Numbers: `num-lg`, `num-md`, `num-sm` (tabular figures)
- Labels: `label-sm`, `label-xs` (uppercase, tracked)

### Component Patterns
- Use existing classes: `section`, `section-title`, `card-section`, `editorial-list`, `startup-row`, `signal-item`
- Borders: subtle (`border-border/40` or `border-border/50`)
- Hover states: `bg-muted/20` or `bg-muted/30`
- Transitions: `transition-colors duration-150`

### Do NOT
- Add new color variables or hardcoded colors
- Use bright/saturated colors
- Add decorative elements or excessive styling
- Override the existing design tokens

## Dual-Audience Messaging System

The site supports two audience modes: **Builders** (default) and **Investors**.

### Copy Configuration (`lib/copy.ts`)
All user-facing copy is centralized in `COPY` object:
```typescript
import { COPY, METRICS, FAQ_ITEMS, SIGN_IN_COPY, SUPPORTING_LINE } from '@/lib/copy';

const copy = COPY[audience]; // 'builders' | 'investors'
copy.heroHeadline;
copy.heroSubhead;
copy.heroBullets;
copy.primaryCTA;
copy.secondaryCTA;
```

### Audience Context (`lib/audience-context.tsx`)
```typescript
import { useAudience } from '@/lib/audience-context';

const { audience, setAudience } = useAudience();
// Persists to localStorage key: "ba_audience"
```

### Audience Toggle Component
```tsx
import { AudienceToggle } from '@/components/ui/audience-toggle';

<AudienceToggle /> // Renders "Builders | Investors" pill toggle
```

### Key Principles
- **No pricing/gating language** - All content is free to browse
- **Sign-in is for personalization only** - Watchlists, saved filters
- **Consistent terminology**: Brief, Dossiers, Signals, Capital, Library, Watchlist
- **Metrics labels are standardized**: "Funded companies tracked", "Capital mapped", "GenAI adoption", "Build patterns detected"

## Data Regeneration Workflow

When startup data changes (CSV updates, new analyses added), multiple data artifacts need to be regenerated to keep the frontend in sync.

### Data Artifacts That Need Regeneration

| Artifact | Path | Purpose | Triggers |
|----------|------|---------|----------|
| `monthly_stats.json` | `apps/web/data/{period}/output/` | Aggregate statistics, GenAI adoption rates | CSV change, analysis store change |
| `monthly_brief.json` | `apps/web/data/{period}/output/` | Intelligence brief for /brief page | Stats change |
| `comprehensive_newsletter.md` | `apps/web/data/{period}/output/` | Newsletter content for /library | Analysis store change |
| `startups_enriched_with_analysis.csv` | `apps/web/data/{period}/output/` | CSV with analysis columns added | CSV or analysis change |
| `briefs/*.md` | `apps/web/data/{period}/output/briefs/` | Individual company briefs | Per-startup analysis |
| Database tables | PostgreSQL | Startup records, funding rounds | CSV change |

### Automatic Regeneration (CI/CD)

The workflow `.github/workflows/sync-to-database.yml` automatically regenerates data when:
- `apps/web/data/**/input/startups.csv` changes
- `apps/web/data/**/output/analysis_store/**` changes

**What it does:**
1. Regenerates `monthly_stats.json` (updates genai_analysis from analysis store)
2. Regenerates `monthly_brief.json` (generates from stats + startups)
3. Regenerates `startups_enriched_with_analysis.csv`
4. Commits the changes back to the repo
5. Syncs to database via API

**Manual trigger:**
```bash
# Full regeneration + database sync
gh workflow run sync-to-database.yml --field period=2026-01

# Regenerate data only (skip database sync)
gh workflow run sync-to-database.yml --field period=2026-01 --field regenerate_only=true
```

### Local Regeneration Script

Use `scripts/regenerate-data.sh` for local regeneration:

```bash
# Regenerate all data for a period
./scripts/regenerate-data.sh 2026-01

# What it does:
# 1. Updates monthly_stats.json with genai_analysis from analysis store
# 2. Regenerates monthly_brief.json via TypeScript generator
# 3. Regenerates newsletter content (if Python dependencies available)
# 4. Regenerates enriched CSV
# 5. Syncs to database (if DATABASE_URL in .env)
```

### Manual Regeneration Commands

**Regenerate monthly brief only:**
```bash
cd apps/web
npx tsx -e "
const { generateMonthlyBrief } = require('./lib/data/generate-monthly-brief');
const fs = require('fs');

generateMonthlyBrief('2026-01').then(brief => {
  fs.writeFileSync('data/2026-01/output/monthly_brief.json', JSON.stringify(brief, null, 2));
  console.log('Generated at:', brief.generatedAt);
});
"
```

**Regenerate monthly stats from analysis store:**
```python
# Run from packages/analysis directory
python3 << 'EOF'
from pathlib import Path
import json

period = '2026-01'
stats_path = Path(f'../../apps/web/data/{period}/output/monthly_stats.json')
analysis_path = Path(f'../../apps/web/data/{period}/output/analysis_store/base_analyses')

with open(stats_path, 'r') as f:
    stats = json.load(f)

analyses = [json.load(open(f)) for f in analysis_path.glob('*.json')]

# Recalculate genai_analysis section
uses_genai = sum(1 for a in analyses if a.get('uses_genai'))
stats['genai_analysis'] = {
    'total_analyzed': len(analyses),
    'uses_genai_count': uses_genai,
    'genai_adoption_rate': uses_genai / len(analyses),
    # ... other fields
}

with open(stats_path, 'w') as f:
    json.dump(stats, f, indent=2)
EOF
```

### Frontend Pages and Their Data Dependencies

| Page | Data Source | Key Data |
|------|-------------|----------|
| `/brief` | `monthly_brief.json` | Metrics, patterns, top deals, spotlight |
| `/dealbook` | `analysis_store/base_analyses/*` + `monthly_stats.json` | Individual startup data, aggregate stats |
| `/signals` | `monthly_stats.json` | Pattern distribution, GenAI adoption |
| `/capital` | `monthly_stats.json` | Funding by stage, geography, investors |
| `/library` | `comprehensive_newsletter.md` | Newsletter markdown content |
| `/company/[slug]` | `analysis_store/base_analyses/{slug}.json` | Individual startup analysis |

### When to Regenerate

**Always regenerate when:**
- New CSV data is added or updated
- Analysis store files are added/modified
- You notice stale data on the frontend

**Regeneration order matters:**
1. First: `monthly_stats.json` (depends on analysis store)
2. Then: `monthly_brief.json` (depends on stats)
3. Then: Enriched CSV (depends on analysis store)

## Monthly Startup Data Update Process

This section documents the step-by-step process for updating monthly startup data. Follow these steps when you receive a new CSV with the latest funding data.

### Prerequisites

- New CSV file with startup funding data (e.g., `monthly-ai-startup-funding-DD-MM-YYYY.csv`)
- Azure CLI logged in: `az login`
- Python 3.12+ with virtual environment

### Step 1: Locate and Identify the New CSV

The new CSV is typically placed in the project root. Identify it and compare with existing data:

```bash
# Find CSV files
ls *.csv

# Count lines to see total rows
wc -l new-csv.csv existing-data/input/startups.csv

# Compute the delta (new startups)
python3 -c "
import csv

existing = set()
with open('apps/web/data/YYYY-MM/input/startups.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        existing.add(row['Transaction Name'].lower())

new_count = 0
with open('new-csv.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row['Transaction Name'].lower() not in existing:
            new_count += 1
            print(f'NEW: {row[\"Transaction Name\"]}')

print(f'Total new startups: {new_count}')
"
```

### Step 2: Copy CSV to Data Directories

```bash
# Copy to main data directory (used by analysis pipeline)
cp new-csv.csv data/YYYY-MM/input/startups.csv

# Copy to web data directory (used by frontend)
cp new-csv.csv apps/web/data/YYYY-MM/input/startups.csv
```

### Step 3: Generate Monthly Statistics

```bash
# Use the analysis package Python environment
/Users/ozgurguler/Developer/Projects/startup-analysis/packages/analysis/venv/bin/python -c "
import sys
sys.path.insert(0, '/Users/ozgurguler/Developer/Projects/startup-analysis/packages/analysis')

from src.data.monthly_stats import MonthlyStatistics
from src.data.ingestion import load_startups_from_csv
from pathlib import Path

# Load startups from the new CSV
csv_path = Path('/Users/ozgurguler/Developer/Projects/startup-analysis/data/YYYY-MM/input/startups.csv')
startups = load_startups_from_csv(csv_path)
print(f'Loaded {len(startups)} startups')

# Generate monthly stats
monthly = MonthlyStatistics('YYYY-MM')
monthly.generate_full_stats(startups)

# Save to output directory
output_dir = Path('/Users/ozgurguler/Developer/Projects/startup-analysis/data/YYYY-MM/output')
output_dir.mkdir(parents=True, exist_ok=True)
stats_path = monthly.save(output_dir)
print(f'Stats saved to: {stats_path}')

# Generate summary report
period_dir = Path('/Users/ozgurguler/Developer/Projects/startup-analysis/data/YYYY-MM')
report_path = monthly.generate_summary_report(period_dir)
print(f'Summary saved to: {report_path}')
"
```

### Step 4: Update Web Data Files

```bash
# Copy monthly summary to web data
cp data/YYYY-MM/monthly_summary.md apps/web/data/YYYY-MM/monthly_summary.md

# Copy monthly stats JSON
cp data/YYYY-MM/output/monthly_stats.json apps/web/data/YYYY-MM/output/monthly_stats.json

# Copy enriched CSV (if exists)
cp data/YYYY-MM/output/startups_enriched_with_analysis.csv apps/web/data/YYYY-MM/output/
```

### Step 5: Commit and Push Changes

```bash
git add -A && git commit -m "Update YYYY-MM startup data: X new startups" && git push
```

CI/CD will automatically deploy the frontend with updated data.

### Full Automation Path (Future State)

When Azure Functions are fully deployed, the process becomes automated:

1. **Upload CSV to Blob Storage**:
   ```bash
   az storage blob upload \
     --account-name buildatlasstorage \
     --container-name startup-csvs \
     --name "incoming/monthly-startup-data.csv" \
     --file new-csv.csv \
     --auth-mode login
   ```

2. **Azure Function Triggers**: The `process_csv_blob` function automatically:
   - Classifies startups as NEW/CHANGED/UNCHANGED
   - Crawls websites for new startups
   - Runs GenAI analysis
   - Generates briefs
   - Saves to PostgreSQL database

3. **Deploy Trigger**: The `check_deploy_trigger` function batches changes and triggers GitHub Actions to redeploy.

### Troubleshooting

**If blob upload fails with network rules error:**
- Storage account has network restrictions
- Use the manual process above until network rules are updated
- Or use GitHub Actions to upload via CI/CD

**If monthly stats fail:**
- Ensure Python virtual environment has dependencies: `pip install pydantic pandas`
- Use full paths to Python interpreter and files

## Azure Services Architecture

**WARNING: These are LIVE PRODUCTION services. Do not modify without explicit user confirmation.**

### ABSOLUTE PROHIBITIONS

**NEVER run these commands:**
```bash
# Resource deletion - FORBIDDEN
az group delete ...
az webapp delete ...
az aks delete ...
az postgres flexible-server delete ...
az storage account delete ...

# Resource recreation - FORBIDDEN (they already exist)
az group create --name aistartuptr ...
az webapp create ...
az aks create ...
az postgres flexible-server create ...

# Configuration changes - FORBIDDEN without approval
az postgres flexible-server firewall-rule ...
az network private-endpoint ...
az storage account network-rule ...
```

### Resource Groups (BOTH EXIST - DO NOT RECREATE)

| Resource Group | Purpose | Contains |
|----------------|---------|----------|
| `aistartuptr` | Application resources | App Service, AKS, Storage, Front Door, ACR |
| `aistartupstr` | Database resources | PostgreSQL Flexible Server |

### Compute Resources (ALL RUNNING - DO NOT RECREATE)

| Service | Name | Resource Group | Status | Purpose |
|---------|------|----------------|--------|---------|
| App Service | `buildatlas-web` | `aistartuptr` | **RUNNING** | Next.js frontend hosting |
| AKS | `aks-aistartuptr` | `aistartuptr` | **RUNNING** | Express.js API hosting |
| Function App | `buildatlas-functions` | `aistartuptr` | **RUNNING** | Automation (CSV processing, monitoring) |

### Data Resources (ALL RUNNING - DO NOT RECREATE)

| Service | Name | Resource Group | Status | Purpose |
|---------|------|----------------|--------|---------|
| PostgreSQL | `aistartupstr` | `aistartupstr` | **RUNNING** | Primary database |
| Storage Account | `buildatlasstorage` | `aistartuptr` | **RUNNING** | CSV uploads, blob storage |
| Container Registry | `aistartuptr` | `aistartuptr` | **RUNNING** | Docker images for API |

### Networking Resources (ALL CONFIGURED - DO NOT MODIFY)

| Resource | Name | Resource Group | Purpose |
|----------|------|----------------|---------|
| Front Door | `afd-aistartuptr-prod` | `aistartuptr` | CDN, WAF, API routing |
| Private Endpoint | `pe-aistartupstr-postgres` | `aistartuptr` | Secure DB connection |
| Virtual Network | `vnet-aistartuptr` | `aistartuptr` | Network isolation |
| DNS Zone | Private DNS for PostgreSQL | `aistartuptr` | Internal name resolution |

### Live URLs

| Service | URL |
|---------|-----|
| Frontend (Production) | https://buildatlas.net |
| Frontend (Azure) | https://buildatlas-web.azurewebsites.net |
| API (via Front Door) | https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net |
| API Health | https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health |

### Storage Account: `buildatlasstorage`

**Container: `startup-csvs`**
- `incoming/` - Upload new CSVs here to trigger processing
- `processed/` - Successfully processed CSVs moved here
- `failed/` - Failed processing CSVs moved here

**Note:** Storage account has network restrictions. Local uploads may be blocked. Use GitHub Actions or Azure Portal for uploads.

### Database: `aistartupstr` (PostgreSQL Flexible Server)

**Connection:** Via private endpoint only (not publicly accessible)

| Table | Purpose |
|-------|---------|
| `startups` | Main startup records with funding info |
| `funding_rounds` | Individual funding round details |
| `investors` | Investor information |
| `investments` | Junction table: investors to funding rounds |
| `startup_events` | Event tracking (funding news, website changes) |
| `deep_research_queue` | LLM analysis queue |
| `pattern_correlations` | Pattern co-occurrence statistics |
| `crawl_logs` | Website crawling history |
| `users` | Authenticated users |
| `watchlist_items` | User's saved startups |

### GitHub Secrets (ALREADY CONFIGURED)

These secrets exist in the GitHub repository - do not recreate:

| Secret | Purpose |
|--------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `API_KEY` | API authentication key |
| `FRONT_DOOR_ID` | Front Door instance ID |
| `NEXTAUTH_SECRET` | NextAuth.js session secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `AZURE_CREDENTIALS` | Service principal for deployments |

### GitHub Variables (ALREADY CONFIGURED)

| Variable | Purpose |
|----------|---------|
| `AZURE_CLIENT_ID` | Service principal client ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `NEXTAUTH_URL` | Production URL (https://buildatlas.net) |

### Azure Functions Status

The Azure Functions for automation are defined in `infrastructure/azure-functions/` but deployment status should be verified before use. The workflow `functions-deploy.yml` handles deployment.

**To check function app status:**
```bash
az functionapp list --query "[?contains(name, 'buildatlas')]" -o table
```

**Required environment variables for Functions (set via GitHub Actions):**
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `DATABASE_URL`
- `AzureWebJobsStorage`
