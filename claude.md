# Claude Code Guidelines

## Git Workflow

**Push code after every change.** Do not accumulate changes locally.

```bash
git add -A && git commit -m "Description of change" && git push
```

- Commit messages should be concise and descriptive
- Push immediately after completing each task or fix
- CI/CD will auto-deploy based on changed paths

## Database Safety

- **Never delete any data from the database unless explicitly asked**
- Even when explicitly asked to delete data, always ask for confirmation before executing the deletion
- Prefer soft deletes (marking records as inactive/deleted) over hard deletes when possible

## API Security Architecture

**Direct access to the API is blocked.** All requests must go through Azure Front Door.

- **Production URL**: `https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net`
- **API Key required**: Include `X-API-Key` header on all `/api/*` requests
- **Health endpoint**: `/health` is public (no auth) for K8s probes
- **AKS IP (172.211.176.100)**: Direct access returns 403 Forbidden

When making API calls from frontend code, always use the Front Door URL and include the API key header.

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

### Security Layers
1. **Front Door ID validation** - Direct access to AKS is blocked; must go through Front Door
2. **API Key authentication** - All API requests require `X-API-Key` header
3. **CORS** - Browser requests restricted to allowed origins

### Secrets (in K8s)
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

## Azure App Service Deployment

Frontend auto-deploys on push to `main` when `apps/web/**` changes.

### Deployment Mode
- Uses Next.js standalone mode (supports auth)
- Deployed via OIDC authentication to Azure App Service
- App Service Plan: `asp-startup-analysis` (B1 tier)

### Required GitHub Secrets
- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_SECRET` - NextAuth.js secret
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret

### Required GitHub Variables
- `AZURE_CLIENT_ID` - Service principal client ID
- `AZURE_TENANT_ID` - Azure AD tenant ID
- `AZURE_SUBSCRIPTION_ID` - Azure subscription ID
- `NEXTAUTH_URL` - Production URL (https://buildatlas.net)

### Live URLs
- **Production**: https://buildatlas.net
- **Azure Default**: https://buildatlas-web.azurewebsites.net

### Authentication
- Google OAuth enabled
- Protected routes: `/startups`, `/patterns`, `/trends`, `/newsletter`, `/brief`
- Login page: `/login`

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
