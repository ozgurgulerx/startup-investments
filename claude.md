# Claude Code Guidelines

## Database Safety

- **Never delete any data from the database unless explicitly asked**
- Even when explicitly asked to delete data, always ask for confirmation before executing the deletion
- Prefer soft deletes (marking records as inactive/deleted) over hard deletes when possible

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
