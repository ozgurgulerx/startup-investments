# Configuration Management

**CRITICAL: When ANY configuration value changes, ALL locations must be updated together.**

Configuration exists in 5 places that MUST stay in sync:

| Setting | GitHub Secrets | GitHub Variables | App Service | K8s Secrets | CI/CD Workflow |
|---------|----------------|------------------|-------------|-------------|----------------|
| `DATABASE_URL` | Yes | - | Yes | Yes | - |
| `API_KEY` | Yes | - | Yes | Yes | - |
| `FRONT_DOOR_ID` | Yes | - | - | Yes | - |
| `NEXTAUTH_SECRET` | Yes | - | Yes | - | - |
| `NEXTAUTH_URL` | - | Yes | Yes | - | - |
| `GOOGLE_CLIENT_ID` | Yes | - | Yes | - | - |
| `GOOGLE_CLIENT_SECRET` | Yes | - | Yes | - | - |
| `REDIS_URL` | Yes | - | - | Yes | - |
| `NEXT_PUBLIC_API_URL` | - | - | Yes | - | Yes (hardcoded) |
| `POSTHOG_KEY` | Yes | - | Yes | - | Yes |
| `NEXT_PUBLIC_POSTHOG_HOST` | - | - | Yes | - | Yes (hardcoded) |
| `AZURE_CLIENT_ID` | - | Yes | - | - | - |
| `AZURE_TENANT_ID` | - | Yes | - | - | - |
| `AZURE_SUBSCRIPTION_ID` | - | Yes | - | - | - |

## Hardcoded Values (DO NOT USE VARIABLES)

| Value | Location | Current Value |
|-------|----------|---------------|
| API URL | `.github/workflows/frontend-deploy.yml` (lines 49 & 225) | `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net` |
| PostHog Host | `.github/workflows/frontend-deploy.yml` | `https://us.i.posthog.com` |
| Frontend URL | `apps/api/src/index.ts` (FRONTEND_URL) | `https://buildatlas.net` |
| App Service Name | `.github/workflows/frontend-deploy.yml` | `buildatlas-web` |
| Resource Group (App Service) | Multiple workflows | `rg-startup-analysis` |
| Resource Group (AKS/Storage) | Multiple workflows | `aistartuptr` |
| Resource Group (Database) | Multiple workflows | `aistartupstr` |

## When to Update Each Location

**If DATABASE_URL changes:**
```bash
# 1. GitHub Secrets
gh secret set DATABASE_URL --body "new-value"

# 2. App Service
az webapp config appsettings set --name buildatlas-web --resource-group rg-startup-analysis \
  --settings DATABASE_URL="new-value"

# 3. Kubernetes
kubectl create secret generic startup-investments-secrets \
  --from-literal=database-url="new-value" \
  --from-literal=api-key="$API_KEY" \
  --from-literal=front-door-id="$FRONT_DOOR_ID" \
  --from-literal=redis-url="$REDIS_URL" \
  --dry-run=client -o yaml | kubectl apply -f -
```

**If API_KEY changes:**
```bash
# 1. GitHub Secrets
gh secret set API_KEY --body "new-value"

# 2. App Service
az webapp config appsettings set --name buildatlas-web --resource-group rg-startup-analysis \
  --settings API_KEY="new-value"

# 3. Kubernetes
kubectl create secret generic startup-investments-secrets \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=api-key="new-value" \
  --from-literal=front-door-id="$FRONT_DOOR_ID" \
  --from-literal=redis-url="$REDIS_URL" \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Restart API to pick up new secret
kubectl rollout restart deployment/startup-investments-api
```

**If REDIS_URL changes:**
```bash
# 1. GitHub Secrets
gh secret set REDIS_URL --body "new-value"

# 2. Kubernetes
kubectl create secret generic startup-investments-secrets \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=api-key="$API_KEY" \
  --from-literal=front-door-id="$FRONT_DOOR_ID" \
  --from-literal=redis-url="new-value" \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Restart API
kubectl rollout restart deployment/startup-investments-api
```

**If API URL changes (e.g., new Front Door endpoint):**
```bash
# 1. Update .github/workflows/frontend-deploy.yml - TWO PLACES:
#    - Line ~49: NEXT_PUBLIC_API_URL in build step
#    - Line ~225: NEXT_PUBLIC_API_URL in app-settings-json

# 2. Update App Service immediately
az webapp config appsettings set --name buildatlas-web --resource-group rg-startup-analysis \
  --settings NEXT_PUBLIC_API_URL="new-url"

# 3. Commit and push workflow change
git add -A && git commit -m "Update API URL to new-url" && git push
```

## Sync All Configuration (Full Reset)

If configuration is out of sync, run this to reset everything:

```bash
# Get current values from Kubernetes (source of truth for secrets)
DATABASE_URL=$(kubectl get secret startup-investments-secrets -o jsonpath='{.data.database-url}' | base64 -d)
API_KEY=$(kubectl get secret startup-investments-secrets -o jsonpath='{.data.api-key}' | base64 -d)
FRONT_DOOR_ID=$(kubectl get secret startup-investments-secrets -o jsonpath='{.data.front-door-id}' | base64 -d)
REDIS_URL=$(kubectl get secret startup-investments-secrets -o jsonpath='{.data.redis-url}' | base64 -d)

# Sync to App Service
az webapp config appsettings set --name buildatlas-web --resource-group rg-startup-analysis \
  --settings \
    DATABASE_URL="$DATABASE_URL" \
    API_KEY="$API_KEY" \
    NEXT_PUBLIC_API_URL="https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net"

# Verify
echo "App Service settings:"
az webapp config appsettings list --name buildatlas-web --resource-group rg-startup-analysis \
  --query "[?name=='DATABASE_URL' || name=='API_KEY' || name=='NEXT_PUBLIC_API_URL'].name" -o tsv
```

## Post-Change Verification

After ANY configuration change, verify the system works:

```bash
# 1. Check API health
curl -s https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health | jq '{status, database, cache: .cache.connected}'

# 2. Check page load time (should be < 1 second)
time curl -s -o /dev/null https://buildatlas.net/dealbook

# 3. Check AKS pods
kubectl get pods -l app=startup-investments-api
```
