# Azure Services Architecture

**WARNING: These are LIVE PRODUCTION services. Do not modify without explicit user confirmation.**

## Resource Groups

| Resource Group | Purpose | Contains |
|----------------|---------|----------|
| `aistartuptr` | Application resources | App Service, AKS, Storage, Front Door, ACR |
| `aistartupstr` | Database resources | PostgreSQL Flexible Server, Redis Cache |
| `rg-startup-analysis` | App Service Plan | `asp-startup-analysis` |

## Compute Resources (ALL RUNNING)

| Service | Name | Resource Group | Purpose |
|---------|------|----------------|---------|
| App Service | `buildatlas-web` | `rg-startup-analysis` | Next.js frontend hosting |
| AKS | `aks-aistartuptr` | `aistartuptr` | Express.js API hosting |
| Function App | `buildatlas-functions` | `aistartuptr` | Automation (CSV processing, monitoring) |

## Data Resources (ALL RUNNING)

| Service | Name | Resource Group | Purpose |
|---------|------|----------------|---------|
| PostgreSQL | `aistartupstr` | `aistartupstr` | Primary database |
| Redis Cache | `aistartupstr-redis-cache` | `aistartupstr` | API response caching (Standard, SSL port 6380) |
| Storage Account | `buildatlasstorage` | `aistartuptr` | CSV uploads, blob storage |
| Container Registry | `aistartuptr` | `aistartuptr` | Docker images for API |

## Networking Resources (DO NOT MODIFY)

| Resource | Name | Resource Group | Purpose |
|----------|------|----------------|---------|
| Front Door | `afd-aistartuptr-prod` | `aistartuptr` | CDN, WAF, API routing |
| Private Endpoint | `pe-aistartupstr-postgres` | `aistartuptr` | Secure DB connection |
| Virtual Network | `vnet-aistartuptr` | `aistartuptr` | Network isolation |
| DNS Zone | Private DNS for PostgreSQL | `aistartuptr` | Internal name resolution |

## Live URLs

| Service | URL |
|---------|-----|
| Frontend (Production) | https://buildatlas.net |
| Frontend (Azure) | https://buildatlas-web.azurewebsites.net |
| API (via Front Door) | https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net |
| API Health | https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health |

## Storage Account: `buildatlasstorage`

**Container: `startup-csvs`**
- `incoming/` - Upload new CSVs here to trigger processing
- `processed/` - Successfully processed CSVs moved here
- `failed/` - Failed processing CSVs moved here

**Note:** Storage account has `publicNetworkAccess: Disabled` and `allowSharedKeyAccess: false`. Only Azure services and private endpoints can access. Use API or direct DB sync instead.

## GitHub Secrets (ALREADY CONFIGURED)

| Secret | Purpose |
|--------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `API_KEY` | API authentication key |
| `FRONT_DOOR_ID` | Front Door instance ID |
| `NEXTAUTH_SECRET` | NextAuth.js session secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `AZURE_CREDENTIALS` | Service principal for deployments |
| `REDIS_URL` | Azure Redis Cache connection string |
| `RESEND_API_KEY` | Resend email API key |

## GitHub Variables (ALREADY CONFIGURED)

| Variable | Purpose |
|----------|---------|
| `AZURE_CLIENT_ID` | Service principal client ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `NEXTAUTH_URL` | Production URL (https://buildatlas.net) |

## Azure Functions

Azure Functions handle automated data processing and monitoring. Defined in `infrastructure/azure-functions/`.

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

```bash
POST /api/trigger/websites     Body: {"limit": 50}
POST /api/trigger/rss          Body: {"lookback_hours": 24}
POST /api/trigger/events       Body: {"batch_size": 50}
POST /api/trigger/research     Body: {"batch_size": 5, "max_concurrent": 2}
POST /api/trigger/correlations Body: {"period": "2026-01"}
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

### Required Secrets for Functions
- `AZURE_CREDENTIALS`, `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`
- `DATABASE_URL`

### Check Function App Status
```bash
az functionapp list --query "[?contains(name, 'buildatlas')]" -o table
```
