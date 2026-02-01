# Build Atlas

A full-stack platform for tracking and analyzing AI startup investments, featuring automated data processing, market insights, and intelligence briefs.

**Live Site:** [buildatlas.net](https://buildatlas.net)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    BUILD ATLAS - AZURE ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│   INTERNET                                                                                  │
│       │                                                                                     │
│       │  HTTPS                                                                              │
│       ▼                                                                                     │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐    │
│   │                           AZURE FRONT DOOR (Global)                                │    │
│   │                        afd-aistartuptr-prod                                        │    │
│   │  ┌─────────────────────────────────────────────────────────────────────────────┐  │    │
│   │  │  Endpoint: startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net                       │  │    │
│   │  │  • SSL/TLS termination    • Health probes (/health)                          │  │    │
│   │  │  • X-Azure-FDID header    • HTTPS redirect                                   │  │    │
│   │  └─────────────────────────────────────────────────────────────────────────────┘  │    │
│   └───────────────────────────────────┬───────────────────────────────────────────────┘    │
│                                       │                                                     │
│       ┌───────────────────────────────┼───────────────────────────────────────────┐        │
│       │                               │                                           │        │
│       ▼                               ▼                                           │        │
│   ┌──────────────────────┐    ┌──────────────────────────────────────────────┐    │        │
│   │  AZURE APP SERVICE   │    │        AZURE KUBERNETES SERVICE              │    │        │
│   │  (aistartuptr)       │    │        (aistartuptr)                         │    │        │
│   │                      │    │                                              │    │        │
│   │  buildatlas-web      │    │  ┌────────────────────────────────────────┐  │    │        │
│   │  Plan: B1            │    │  │  Deployment: startup-investments-api   │  │    │        │
│   │                      │    │  │  ├── Pods: 1-5 (HPA autoscaling)      │  │    │        │
│   │  ┌────────────────┐  │    │  │  ├── Image: aistartuptr.azurecr.io/   │  │    │        │
│   │  │   NEXT.JS      │  │    │  │  │         startup-investments-api    │  │    │        │
│   │  │   (Standalone) │  │    │  │  └── Port: 3001                       │  │    │        │
│   │  │                │  │    │  └────────────────────────────────────────┘  │    │        │
│   │  │  Routes:       │  │    │                                              │    │        │
│   │  │  • /brief      │  │    │  Service: LoadBalancer (172.211.176.100)    │    │        │
│   │  │  • /dealbook   │  │    │  (Direct access blocked via Front Door)      │    │        │
│   │  │  • /signals    │  │    │                                              │    │        │
│   │  │  • /capital    │  │    │  API Endpoints:                              │    │        │
│   │  │  • /library    │  │    │  • /health (public)                         │    │        │
│   │  │  • /company/*  │  │    │  • /api/v1/* (X-API-Key required)           │    │        │
│   │  │                │  │    │  • /api/admin/* (X-Admin-Key required)      │    │        │
│   │  │  Auth:         │  │    └──────────────────────────────────────────────┘    │        │
│   │  │  Google OAuth  │  │                    │                                   │        │
│   │  └────────────────┘  │                    │                                   │        │
│   │                      │                    ▼                                   │        │
│   │  buildatlas.net      │    ┌──────────────────────────────────────┐           │        │
│   └──────────────────────┘    │     AZURE CACHE FOR REDIS            │           │        │
│              │                │     • API response caching           │           │        │
│              │                │     • Basic C0 (250MB)               │           │        │
│              │                └──────────────────────────────────────┘           │        │
│              │                                │                                   │        │
│              └────────────────────────────────┼───────────────────────────────────┘        │
│                                               │                                            │
│                                               ▼                                            │
│   ┌─────────────────────────────────────────────────────────────────────────────────────┐ │
│   │                    AZURE POSTGRESQL FLEXIBLE SERVER                                  │ │
│   │                    (Resource Group: aistartupstr)                                    │ │
│   │                                                                                      │ │
│   │    Server: aistartupstr.postgres.database.azure.com                                 │ │
│   │    Database: startupinvestments                                                     │ │
│   │    Access: Private Endpoint Only                                                    │ │
│   │                                                                                      │ │
│   │    Tables: startups, funding_rounds, investors, investments, startup_events,        │ │
│   │            deep_research_queue, pattern_correlations, users, watchlist_items        │ │
│   └─────────────────────────────────────────────────────────────────────────────────────┘ │
│                                               ▲                                            │
│                                               │                                            │
│   ┌─────────────────────────────────────────────────────────────────────────────────────┐ │
│   │                         AZURE FUNCTIONS (buildatlas-functions)                       │ │
│   │                                                                                      │ │
│   │    Timer Triggers:                          Blob Triggers:                           │ │
│   │    ├── check_pending_blobs (30 min)        └── process_csv_blob                     │ │
│   │    ├── monitor_websites (6 hours)              (startup-csvs/incoming/)             │ │
│   │    ├── consume_rss_feeds (1 hour)                                                   │ │
│   │    ├── process_startup_events (15 min)     HTTP Triggers:                           │ │
│   │    ├── process_research_queue (30 min)     └── /api/trigger/* (manual)              │ │
│   │    └── compute_pattern_correlations (daily)                                         │ │
│   └───────────────────────────────────────────┬─────────────────────────────────────────┘ │
│                                               │                                            │
│                                               ▼                                            │
│   ┌─────────────────────────────────────────────────────────────────────────────────────┐ │
│   │                         AZURE BLOB STORAGE (buildatlasstorage)                       │ │
│   │                                                                                      │ │
│   │    Container: startup-csvs                                                          │ │
│   │    ├── incoming/   → Trigger CSV processing                                         │ │
│   │    ├── processed/  → Successfully processed files                                   │ │
│   │    └── failed/     → Failed processing files                                        │ │
│   └─────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                            │
│   ┌─────────────────────────────────────────────────────────────────────────────────────┐ │
│   │                              CI/CD - GITHUB ACTIONS                                  │ │
│   │                                                                                      │ │
│   │    ├── frontend-deploy.yml  → apps/web/** → App Service                             │ │
│   │    ├── backend-deploy.yml   → apps/api/** → ACR → AKS                               │ │
│   │    ├── functions-deploy.yml → azure-functions/** → Functions                        │ │
│   │    └── sync-to-database.yml → data changes → Regenerate & Sync                      │ │
│   └─────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                            │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Architecture Summary

| Layer | Service | Resource | Purpose |
|-------|---------|----------|---------|
| **CDN/Edge** | Front Door | `afd-aistartuptr-prod` | SSL, routing, security |
| **Frontend** | App Service | `buildatlas-web` | Next.js app hosting |
| **Backend** | AKS | `aks-aistartuptr` | Express.js API (1-5 pods) |
| **Caching** | Redis | `redis-*` | API response cache |
| **Database** | PostgreSQL | `aistartupstr` | Primary data store |
| **Storage** | Blob Storage | `buildatlasstorage` | CSV uploads |
| **Automation** | Functions | `buildatlas-functions` | Timer/blob triggers |
| **Registry** | ACR | `aistartuptr` | Docker images |

### Data Flow

```
User Request → Front Door → AKS API → Redis Cache → PostgreSQL

CSV Upload → Blob Storage → Azure Function → Delta Processing → PostgreSQL
                                  │
                                  ├── startup_events created
                                  ├── deep_research_queue (LLM analysis)
                                  └── GitHub Action → Frontend redeploy
```

## Project Structure

```
startup-analysis/
├── apps/
│   ├── web/                    # Next.js frontend (App Service)
│   │   ├── app/
│   │   │   ├── (marketing)/    # Public pages: /, /methodology, /terms
│   │   │   ├── (auth)/         # Auth pages: /login
│   │   │   └── (app)/          # Protected: /brief, /dealbook, /signals
│   │   ├── components/
│   │   ├── lib/
│   │   └── data/               # Static JSON data for briefs
│   └── api/                    # Express.js backend (AKS)
├── infrastructure/
│   ├── kubernetes/             # K8s manifests for AKS
│   ├── azure/                  # Bicep templates
│   └── azure-functions/        # Azure Functions (Python)
├── database/
│   └── migrations/             # SQL migrations
└── packages/
    ├── shared/                 # Shared types/utilities
    └── analysis/               # Python analysis package
        └── src/
            ├── automation/     # Event processors, monitors
            ├── pipeline/       # CSV processing pipeline
            └── crawler/        # Web crawling & enrichment
```

## Tech Stack

### Frontend
- **Framework**: Next.js 14 (App Router, Standalone mode)
- **Styling**: Tailwind CSS
- **Components**: Radix UI, Framer Motion
- **Auth**: NextAuth.js (Google OAuth)
- **Hosting**: Azure App Service (B1)

### Backend
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL (Azure Flexible Server)
- **Caching**: Azure Cache for Redis
- **Hosting**: Azure Kubernetes Service (AKS)

### Automation
- **Functions**: Azure Functions (Python)
- **Triggers**: Timer, Blob, HTTP
- **Processing**: LLM-based analysis, RSS monitoring

### Infrastructure
- **CDN/Security**: Azure Front Door
- **Container Registry**: Azure Container Registry
- **Orchestration**: Kubernetes (AKS) with HPA
- **IaC**: Bicep
- **CI/CD**: GitHub Actions (OIDC auth)

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm
- Docker (for local development)
- Azure CLI (for deployment)

### Local Development

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Start the frontend**
   ```bash
   cd apps/web
   pnpm dev
   ```

4. **Start the backend**
   ```bash
   cd apps/api
   pnpm dev
   ```

### Database Setup

1. **Run migrations**
   ```bash
   psql -d startupinvestments -f database/migrations/001_initial_schema.sql
   ```

2. **Seed data (optional)**
   ```bash
   psql -d startupinvestments -f database/seeds/sample_data.sql
   ```

## Deployment

### CI/CD (Automatic)

Deployments are automatic via GitHub Actions:

| Trigger | Workflow | Target |
|---------|----------|--------|
| `apps/web/**` changes | `frontend-deploy.yml` | App Service |
| `apps/api/**` changes | `backend-deploy.yml` | ACR → AKS |
| `azure-functions/**` changes | `functions-deploy.yml` | Azure Functions |
| `data/**` changes | `sync-to-database.yml` | Regenerate & sync DB |

### Manual Backend Deployment

```bash
# Build and push (MUST use linux/amd64 for AKS)
docker buildx build --platform linux/amd64 \
  -t aistartuptr.azurecr.io/startup-investments-api:latest \
  --push apps/api

# Restart deployment
kubectl rollout restart deployment/startup-investments-api
kubectl rollout status deployment/startup-investments-api --timeout=180s
```

### Deploy Infrastructure (Bicep)

```bash
az deployment group create \
  --resource-group aistartuptr \
  --template-file infrastructure/azure/main.bicep \
  --parameters environment=prod
```

## Environment Variables

### GitHub Secrets (CI/CD)

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `API_KEY` | API authentication key |
| `FRONT_DOOR_ID` | Azure Front Door instance ID |
| `NEXTAUTH_SECRET` | NextAuth.js session secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `REDIS_URL` | Azure Redis Cache connection |

### GitHub Variables

| Variable | Description |
|----------|-------------|
| `AZURE_CLIENT_ID` | Service principal client ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `NEXTAUTH_URL` | Production URL (https://buildatlas.net) |

## Live URLs

| Service | URL |
|---------|-----|
| Frontend | https://buildatlas.net |
| API (via Front Door) | https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net |
| API Health | https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health |

## License

Private - All rights reserved
