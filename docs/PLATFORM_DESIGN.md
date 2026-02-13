# Platform Design (Deprecated)

This file is intentionally kept as a deprecation marker.

It does not reflect the current production architecture and should not be used for operational or implementation decisions.

Current source of truth:
- `docs/OPERATING_MODEL.md`
- `AGENTS.md`
- `infrastructure/vm-cron/crontab`

Why deprecated:
- Legacy notes in this file describe older platform assumptions (for example Static Web Apps + FastAPI) that are no longer the deployed system.
- Current production uses Next.js on App Service, Express API on AKS behind Front Door, and VM cron as the primary automation control plane.

If historical context is needed, use git history for previous revisions of this file.
