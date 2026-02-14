# Database Sync & Schema

## Database Schema

**PostgreSQL Server:** `aistartupstr.postgres.database.azure.com`
**Database:** `startupinvestments`

```
Tables (ALL EXIST - DO NOT DROP OR TRUNCATE):
├── startups              # Core startup data with funding info
├── startup_snapshots     # Monthly point-in-time snapshots
├── startup_briefs        # Versioned brief content
├── funding_rounds        # Individual funding round details
├── investors             # Investor profiles (VCs, angels, corporates)
├── investments           # Junction: investors <-> funding rounds
├── investor_startup_links # Investor-startup relationship tracking
├── competitor_links      # Competitive relationships
├── pattern_correlations  # Pattern co-occurrence statistics
├── newsletters           # Generated newsletter content
├── users                 # Authenticated users
├── user_watchlists       # User's saved startups
├── user_preferences      # User settings
├── news_sources          # RSS/API/crawler source registry
├── news_items_raw        # Raw normalized news items
├── news_clusters         # Deduplicated story clusters (with embeddings)
├── news_cluster_items    # Junction: clusters <-> raw items
├── news_daily_editions   # Daily edition snapshots per region
├── news_topic_index      # Topic-cluster lookup by edition/region
├── news_ingestion_runs   # Ingestion telemetry
├── news_entity_facts     # Persistent entity claims (memory gate)
├── news_item_extractions # Per-cluster extraction results
├── news_item_decisions   # Routing decisions (publish/watchlist/drop)
├── news_pattern_library  # Build patterns from news
├── news_gtm_taxonomy     # GTM classification tags
├── news_calibration_labels # Human feedback labels
├── news_periodic_briefs  # Weekly/monthly intelligence briefs
├── news_email_subscriptions  # Email newsletter subscriptions
├── news_digest_deliveries # Per-subscriber delivery tracking
├── crawl_logs            # Website crawl history
├── crawl_frontier_urls   # Crawl frontier URL registry
├── crawl_frontier_queue  # Lease-based crawl queue
├── domain_stats          # Per-domain throttling stats
├── domain_policies       # Per-domain crawl policies
├── startup_events        # Events triggering re-analysis
├── deep_research_queue   # LLM analysis queue
NOTE: See docs/claude/database-and-search.md for full schema details
```

## Correct Database Update Process

The database is updated via Azure Functions or API, NOT directly:

```
CSV File -> Azure Blob Storage (incoming/)
              |
    Azure Function: process_csv_blob
              |
    Delta Processor classifies each startup:
    ├── NEW -> INSERT new record
    ├── CHANGED -> UPDATE existing record (UPSERT)
    └── UNCHANGED -> Skip (update timestamp only)
              |
    All operations use ON CONFLICT for safety
```

## Database Sync Methods (in order of preference)

### Method 1: VM Cron (`sync-data`) (Primary)

```bash
/opt/buildatlas/startup-analysis/infrastructure/vm-cron/lib/runner.sh \
  sync-data 45 \
  /opt/buildatlas/startup-analysis/infrastructure/vm-cron/jobs/sync-data.sh
```

Notes:
- This job is scheduled on the VM every 30 minutes and is the canonical data sync path.
- It also triggers a frontend deploy after pushing updated datasets.

### Method 2: API Admin Endpoint

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
      "leadInvestors": "Sequoia, a16z"
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

### Method 3: Direct Database Sync (Fallback)

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
curl -s ifconfig.me
az postgres flexible-server firewall-rule list \
  --resource-group aistartupstr \
  --name aistartupstr -o table
```

## Known Infrastructure Blockers

**Storage Account (`buildatlasstorage`):**
- `publicNetworkAccess: Disabled` - Cannot upload from external networks
- `allowSharedKeyAccess: false` - Connection strings don't work
- **Workaround:** Use Method 2 (API) or Method 3 (direct DB)

**Backend CI/CD:**
- ACR authentication may fail in GitHub Actions
- Error: "Unable to get AAD authorization tokens"
- **Workaround:** Deploy manually with Docker, or use Method 3
