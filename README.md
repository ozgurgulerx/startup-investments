# Startup Investments Platform

A full-stack platform for tracking and analyzing AI startup investments, featuring automated newsletter generation and market insights.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend API   │────▶│   PostgreSQL    │
│ (Azure Static)  │     │  (Kubernetes)   │     │   (Azure DB)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Project Structure

```
startup-investments/
├── apps/
│   ├── web/              # Next.js frontend (Azure Static Web Apps)
│   └── api/              # Express.js API (Kubernetes)
├── packages/
│   ├── analysis/         # Python analysis scripts
│   └── shared/           # Shared TypeScript utilities
├── infrastructure/
│   ├── kubernetes/       # K8s manifests
│   └── azure/            # Bicep templates
├── database/
│   ├── migrations/       # SQL migration scripts
│   └── seeds/            # Seed data
└── .github/
    └── workflows/        # CI/CD pipelines
```

## Tech Stack

### Frontend
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Components**: Radix UI, Framer Motion
- **Hosting**: Azure Static Web Apps

### Backend
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL (Azure Database for PostgreSQL)
- **ORM**: Drizzle ORM
- **Hosting**: Azure Kubernetes Service (AKS)

### Infrastructure
- **Container Registry**: Azure Container Registry
- **Orchestration**: Kubernetes (AKS)
- **IaC**: Bicep

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

### Deploy Infrastructure
```bash
az deployment group create \
  --resource-group startup-investments-rg \
  --template-file infrastructure/azure/main.bicep \
  --parameters environment=prod
```

### Deploy Backend to Kubernetes
```bash
# Build and push image
docker build -t $ACR_NAME.azurecr.io/startup-investments-api:latest apps/api
docker push $ACR_NAME.azurecr.io/startup-investments-api:latest

# Apply K8s manifests
kubectl apply -f infrastructure/kubernetes/
```

### Deploy Frontend
Frontend deploys automatically via GitHub Actions on push to main.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENAI_API_KEY` | OpenAI API key for analysis |
| `AZURE_STORAGE_CONNECTION_STRING` | Azure Blob Storage connection |

## License

Private - All rights reserved
