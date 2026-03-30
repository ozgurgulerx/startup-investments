# Infrastructure Health Check & Recovery Guide

When something seems wrong, follow this diagnostic sequence before taking any action.

## PREREQUISITE: Verify kubectl Context

**ALWAYS run this before any `kubectl` command.** The local machine has multiple AKS clusters configured. Running commands against the wrong cluster will return misleading "not found" results.

```bash
# Verify you are on the correct context
kubectl config current-context
# MUST show: aks-aistartuptr

# If wrong, switch:
kubectl config use-context aks-aistartuptr
```

The correct context for this project is **`aks-aistartuptr`** (cluster `aks-aistartuptr` in resource group `aistartuptr`). Other contexts (e.g. `aks-aviation-rag`, `aks-fund-rag`) belong to different projects.

## Quick Health Check (Run This First)

```bash
kubectl config use-context aks-aistartuptr 2>/dev/null && \
echo "=== Frontend ===" && \
curl -s -o /dev/null -w "buildatlas.net: HTTP %{http_code} (%{time_total}s)\n" https://buildatlas.net && \
echo "=== API ===" && \
curl -s https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print(f\"API: {d['status']}, DB: {d['database']}, Redis: connected={d['cache']['connected']}, mem={d['cache']['memoryUsed']}\")
except: print('API: DOWN or unreachable')
" && \
echo "=== AKS ===" && \
az aks show --resource-group aistartuptr --name aks-aistartuptr --query 'powerState.code' -o tsv && \
echo "=== PostgreSQL ===" && \
az postgres flexible-server show --resource-group aistartupstr --name aistartupstr --query 'state' -o tsv && \
echo "=== Redis ===" && \
az redis show --name aistartupstr-redis-cache --resource-group aistartupstr --query 'provisioningState' -o tsv && \
echo "=== API Pods ===" && \
kubectl get pods -l app=startup-investments-api -o wide
```

## Symptom -> Diagnosis -> Fix

### API returning 504 Gateway Timeout

**Diagnosis:** Front Door cannot reach the AKS backend.

```bash
# Step 1: Is AKS running?
az aks show --resource-group aistartuptr --name aks-aistartuptr --query 'powerState.code' -o tsv
# If "Stopped" -> AKS cluster is down

# Step 2: Start AKS
az aks start --resource-group aistartuptr --name aks-aistartuptr
# Takes 2-4 minutes

# Step 3: Refresh kubectl credentials
az aks get-credentials --resource-group aistartuptr --name aks-aistartuptr --overwrite-existing

# Step 4: Verify pods are running
kubectl get pods -l app=startup-investments-api

# Step 5: Verify API responds
curl -s https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health | python3 -m json.tool
```

### API pods in CrashLoopBackOff

**Diagnosis:** The API container is crashing on startup.

```bash
# Check pod logs for error
kubectl logs deployment/startup-investments-api --tail=100

# Check pod events
kubectl describe pod -l app=startup-investments-api

# Common causes:
# - Database connection refused -> Check PostgreSQL is running
# - Missing env vars -> Check K8s secrets exist
# - Bad image -> Check ACR image exists

# Fix: Restart the deployment
kubectl rollout restart deployment/startup-investments-api
kubectl rollout status deployment/startup-investments-api --timeout=180s
```

### Database connection errors in API logs

**Diagnosis:** PostgreSQL may be stopped or unreachable.

```bash
# Check PostgreSQL state
az postgres flexible-server show --resource-group aistartupstr --name aistartupstr --query 'state' -o tsv

# If "Stopped" -> Start it
az postgres flexible-server start --resource-group aistartupstr --name aistartupstr
# Takes 1-2 minutes

# Then restart API pods to reconnect
kubectl rollout restart deployment/startup-investments-api
```

### Redis not connected (cache.connected = false in /health)

**Diagnosis:** Redis Cache may be down, connection string may be wrong, or access key auth may be disabled.

```bash
# Check Redis state
az redis show --name aistartupstr-redis-cache --resource-group aistartupstr --query '{state:provisioningState, host:hostName, port:sslPort}' -o json

# Check if access key authentication is enabled (MUST be false for our setup)
az redis show --name aistartupstr-redis-cache --resource-group aistartupstr --query 'disableAccessKeyAuthentication' -o tsv
# If "true" -> access key auth is DISABLED, which breaks the API connection. Fix:
az redis update --resource-group aistartupstr --name aistartupstr-redis-cache --set disableAccessKeyAuthentication=false

# If Redis is up but API can't connect, verify the K8s secret has correct REDIS_URL
kubectl get secret startup-investments-secrets -o jsonpath='{.data.redis-url}' | base64 -d

# Restart API to reconnect (the Redis client gives up after ~92 failures and won't auto-reconnect)
kubectl rollout restart deployment/startup-investments-api
```

**Known issue (2026-03):** Azure may disable access key auth via policy or portal changes (`disableAccessKeyAuthentication: true`). The API uses access key auth (password in K8s secret `REDIS_URL`), NOT AAD/Entra ID auth. If access key auth gets disabled, the API logs show `WRONGPASS invalid username-password pair` and eventually the Redis client gives up entirely. Fix: re-enable access key auth, then restart pods.

### Frontend returning 403 (App Service stopped)

**Diagnosis:** The App Service `buildatlas-web` is in Stopped state.

```bash
# Check App Service state
az webapp show --resource-group rg-startup-analysis --name buildatlas-web --query 'state' -o tsv
# If "Stopped":
az webapp start --resource-group rg-startup-analysis --name buildatlas-web

# Verify
curl -s -o /dev/null -w "%{http_code}" https://buildatlas.net
# Should return 200
```

**Known issue (2026-03):** Azure may auto-stop App Services on cheaper plans during inactivity or due to billing/quota. If `buildatlas.net` returns HTTP 403, check App Service state first.

### Frontend loading slowly (no API, file-based fallback)

**Diagnosis:** API is down, so frontend falls back to reading JSON files from disk.

```bash
# Check if API is accessible
curl -s -o /dev/null -w "%{http_code}" https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health

# If not 200 -> Follow "API returning 504" section above
# Once API is back, frontend automatically switches to fast API-based loading
```

### K8s secrets missing or corrupted

```bash
# Verify secrets exist
kubectl get secret startup-investments-secrets -o json | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k in d['data']: print(f'  {k}: {len(d[\"data\"][k])} chars (base64)')
"

# Expected keys: database-url, api-key, front-door-id, redis-url
# If missing, recreate from known values (requires user to provide values)
```

## Full Recovery Sequence (Nuclear Option)

If multiple services are down, recover in this order:

```bash
# 0. Ensure correct kubectl context
kubectl config use-context aks-aistartuptr

# 1. PostgreSQL first (other services depend on it)
az postgres flexible-server show --resource-group aistartupstr --name aistartupstr --query 'state' -o tsv
# If stopped:
az postgres flexible-server start --resource-group aistartupstr --name aistartupstr

# 2. Redis (API uses it for caching)
az redis show --name aistartupstr-redis-cache --resource-group aistartupstr --query 'provisioningState' -o tsv
# Redis rarely stops on its own - if down, check Azure Portal

# 3. AKS (hosts the API)
az aks show --resource-group aistartuptr --name aks-aistartuptr --query 'powerState.code' -o tsv
# If stopped:
az aks start --resource-group aistartuptr --name aks-aistartuptr
az aks get-credentials --resource-group aistartuptr --name aks-aistartuptr --overwrite-existing

# 4. Verify API pods are running
kubectl get pods -l app=startup-investments-api
# If no pods or CrashLoopBackOff:
kubectl rollout restart deployment/startup-investments-api

# 5. Verify end-to-end
curl -s https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net/health | python3 -m json.tool
curl -s -o /dev/null -w "Frontend: HTTP %{http_code}\n" https://buildatlas.net
```
