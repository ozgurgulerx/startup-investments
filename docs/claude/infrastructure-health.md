# Infrastructure Health Check & Recovery Guide

When something seems wrong, follow this diagnostic sequence before taking any action.

## Quick Health Check (Run This First)

```bash
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

**Diagnosis:** Redis Cache may be down or connection string may be wrong.

```bash
# Check Redis state
az redis show --name aistartupstr-redis-cache --resource-group aistartupstr --query '{state:provisioningState, host:hostName, port:sslPort}' -o json

# If Redis is up but API can't connect, verify the K8s secret has correct REDIS_URL
kubectl get secret startup-investments-secrets -o jsonpath='{.data.redis-url}' | base64 -d

# Restart API to reconnect
kubectl rollout restart deployment/startup-investments-api
```

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
