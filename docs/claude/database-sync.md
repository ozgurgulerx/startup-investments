# Database Sync & Schema

## Database Schema

**PostgreSQL Server:** `aistartupstr.postgres.database.azure.com`
**Database:** `startupinvestments`

```
Tables (ALL EXIST - DO NOT DROP OR TRUNCATE):
├── startups              # Core startup data with funding info
├── startup_snapshots     # Monthly point-in-time snapshots
├── funding_rounds        # Individual funding round details
├── investors             # Investor profiles (VCs, angels, corporates)
├── investments           # Junction: investors <-> funding rounds
├── startup_events        # Events triggering re-analysis
├── deep_research_queue   # LLM analysis queue
├── pattern_correlations  # Pattern co-occurrence statistics
├── crawl_logs            # Website crawl history
├── users                 # Authenticated users
├── watchlist_items       # User's saved startups
├── newsletters           # Generated newsletter content
├── startup_briefs        # Versioned brief content
├── news_email_subscriptions  # Email newsletter subscriptions
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

### Method 1: GitHub Actions Workflow (CI/CD)

The workflow `.github/workflows/sync-to-database.yml` automatically syncs when CSVs change:

```yaml
# Triggers on:
- Push to main with changes to apps/web/data/**/input/startups.csv
- Manual workflow_dispatch with period parameter
```

**Manual trigger:**
```bash
gh workflow run sync-to-database.yml --field period=2026-01
```

**Known Issue:** Backend CI/CD may fail due to ACR authentication. If API endpoint isn't deployed, use Method 3.

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
