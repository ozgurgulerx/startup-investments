# Email Infrastructure (Resend API)

## Overview
- **Provider:** [Resend](https://resend.com) — API-based transactional email
- **Transactional emails** (confirmation): Sent from Next.js API routes via `fetch()` to Resend HTTP API
- **Batch emails** (daily digest): Sent from Python via AKS CronJobs (`buildatlas-pipelines`) with VM cron as fallback

## Email Types

| Type | Trigger | Sender | Template |
|------|---------|--------|----------|
| Subscription confirmation | User subscribes on `/news` | Next.js API route (`apps/web/app/api/news/subscriptions/route.ts`) | Inline HTML |
| Daily digest | AKS CronJob (`news-digest`) | Python (`packages/analysis/src/automation/news_digest.py`) | Inline HTML |
| Unsubscribe | Click unsubscribe link in email | Next.js API route (GET handler) | Redirect |

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `RESEND_API_KEY` | Kubernetes secret / VM env / App Service | Resend API authentication |
| `RESEND_FROM_EMAIL` | Kubernetes secret / VM env (optional) | From address (default: `Build Atlas <news@buildatlas.net>`) |
| `NEWS_DIGEST_REPLY_TO` | Kubernetes secret / VM env (optional) | Reply-to address |
| `PUBLIC_BASE_URL` | Kubernetes secret / VM env (optional) | Base URL for links (default: `https://buildatlas.net`) |

## Subscription Flow (Double Opt-In)

```
1. User enters email on subscription card -> POST /api/news/subscriptions
2. DB record created with status = 'pending_confirmation'
3. Confirmation email sent via Resend API
4. User clicks "Confirm subscription" link in email
5. GET /api/news/subscriptions/confirm?token=... -> status = 'active'
6. Redirect to /news?confirmed=1
```

## Regional Subscriptions

Subscriptions are region-aware: same email can subscribe to both Global and Turkey feeds independently.

- **Database:** `news_email_subscriptions.region` column (`'global'` or `'turkey'`)
- **Unique constraint:** `(email_normalized, region)` — allows same email in both regions
- **Digest workflow:** Uses matrix strategy to send separately for each region
- **Subscription card:** Accepts `region` prop, passed from parent news page
- **URL structure:** `/news` (global), `/news/turkey` (Turkey)

## Daily Digest Workflow

```bash
# Manual trigger (AKS one-off run)
kubectl create job -n default --from=cronjob/news-digest news-digest-manual-<id>

# CLI (local)
cd packages/analysis
python main.py send-news-digest --region global
python main.py send-news-digest --region turkey --edition-date 2026-02-07
```
