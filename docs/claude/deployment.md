# Deployment Guide

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

Admin endpoints are also accessible from localhost without auth (for internal pod access).

### Security Layers
1. **Front Door ID validation** - Direct access to AKS is blocked; must go through Front Door
2. **API Key authentication** - All API requests require `X-API-Key` header
3. **CORS** - Browser requests restricted to allowed origins

### K8s Secrets
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

---

## Frontend (App Service) Deployment

Frontend auto-deploys on push to `main` when `apps/web/**` changes.

### Deployment Mode
- Uses Next.js standalone mode (supports auth)
- Deployed via OIDC authentication to Azure App Service
- App Service Plan: `asp-startup-analysis` (B1 tier)

### Required GitHub Secrets
- `DATABASE_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `API_KEY`

### Required GitHub Variables
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- `NEXTAUTH_URL` = `https://buildatlas.net`

### CRITICAL: Hardcoded API URL

The API URL is HARDCODED in `.github/workflows/frontend-deploy.yml` in TWO places (line ~49 and ~225):

```
NEXT_PUBLIC_API_URL = https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net
```

Without this, the frontend falls back to file-based data loading (slow — reads 275+ JSON files from disk).

### Live URLs
- **Production**: https://buildatlas.net
- **Azure Default**: https://buildatlas-web.azurewebsites.net

### Authentication
- Google OAuth enabled
- Protected routes: `/startups`, `/patterns`, `/trends`, `/newsletter`, `/brief`
- Login page: `/login`

---

## Backend Availability

**The AKS cluster and API backend MUST remain running.** Stopping AKS causes 504 Gateway Timeout via Front Door, and the frontend degrades to slow file-based loading.

### NEVER Stop These Services
```bash
az aks stop --resource-group aistartuptr --name aks-aistartuptr    # NEVER
az aks delete ...                                                    # NEVER
kubectl delete deployment startup-investments-api                    # NEVER
kubectl scale deployment startup-investments-api --replicas=0        # NEVER
az postgres flexible-server stop --resource-group aistartupstr --name aistartupstr  # NEVER
```

### Current Backend Configuration

| Setting | Value |
|---------|-------|
| AKS Cluster | `aks-aistartuptr` (resource group: `aistartuptr`) |
| Node Pool | `systempool`, 1-2 nodes, autoscaling enabled |
| Deployment | `startup-investments-api`, 1 replica |
| Image | `aistartuptr.azurecr.io/startup-investments-api:latest` |
| Liveness Probe | `/health` on port 3001, every 30s |
| Readiness Probe | `/health` on port 3001, every 10s |
| Resources | 100m-500m CPU, 128Mi-512Mi memory |
| Redis Cache | `aistartupstr-redis-cache` (Standard, SSL port 6380) |
