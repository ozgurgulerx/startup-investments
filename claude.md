# Claude Code Guidelines

## Database Safety

- **Never delete any data from the database unless explicitly asked**
- Even when explicitly asked to delete data, always ask for confirmation before executing the deletion
- Prefer soft deletes (marking records as inactive/deleted) over hard deletes when possible

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
- **Health**: `http://172.211.176.100/health` (no auth required)
- **API**: `http://172.211.176.100/api/v1/*` (requires `X-API-Key` header)

### Secrets (in K8s)
```bash
# Update secrets
kubectl create secret generic startup-investments-secrets \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=api-key="$API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -
```

### CI/CD
Backend auto-deploys on push to `main` when `apps/api/**` or `infrastructure/kubernetes/**` changes.
Required GitHub secrets: `AZURE_CREDENTIALS`, `DATABASE_URL`, `API_KEY`

## Azure Static Web Apps Deployment

Frontend auto-deploys on push to `main` when `apps/web/**` changes.

### Static Export Mode
- Uses `STATIC_EXPORT=true` (set in workflow env)
- Output: `apps/web/out/`
- Auth disabled (backups in `apps/web/*.bak`, `apps/web/api.bak/`)

### Required Secret
- `AZURE_STATIC_WEB_APPS_API_TOKEN`

### Live URL
https://ambitious-stone-01ca3c903.2.azurestaticapps.net

### Re-enabling Auth
Restore backups and deploy to Vercel/Azure App Service instead (SWA has warmup timeout with standalone mode).

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
