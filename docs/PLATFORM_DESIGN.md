# AI Startups Intelligence Platform - System Design

## Overview

A B2C subscription-based platform providing Crunchbase-like startup intelligence focused on AI companies. Low subscription fee model (~$9-29/month) with Google authentication.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AZURE CLOUD                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────┐     ┌─────────────────────┐     ┌───────────────┐  │
│  │  Azure Static       │     │  Azure Kubernetes   │     │ Azure         │  │
│  │  Web Apps           │────▶│  Service (AKS)      │────▶│ PostgreSQL    │  │
│  │  (Next.js Frontend) │     │  (FastAPI Backend)  │     │ Flexible      │  │
│  └─────────────────────┘     └─────────────────────┘     └───────────────┘  │
│           │                           │                          │          │
│           │                           │                          │          │
│           ▼                           ▼                          │          │
│  ┌─────────────────────┐     ┌─────────────────────┐            │          │
│  │  Azure CDN          │     │  Azure Redis Cache  │            │          │
│  │  (Global Edge)      │     │  (Session/Cache)    │◀───────────┘          │
│  └─────────────────────┘     └─────────────────────┘                       │
│                                       │                                     │
│                                       ▼                                     │
│                              ┌─────────────────────┐                       │
│                              │  Azure Blob Storage │                       │
│                              │  (Static Assets)    │                       │
│                              └─────────────────────┘                       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                          EXTERNAL SERVICES                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Google OAuth │  │ Stripe       │  │ SendGrid     │  │ Crunchbase   │   │
│  │ (Auth)       │  │ (Payments)   │  │ (Email)      │  │ API (Data)   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema (PostgreSQL)

### Core Tables

```sql
-- =====================================================
-- AUTHENTICATION & USERS
-- =====================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    avatar_url TEXT,
    google_id VARCHAR(255) UNIQUE,
    email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    plan_type VARCHAR(50) NOT NULL, -- 'free', 'basic', 'pro', 'enterprise'
    status VARCHAR(50) NOT NULL, -- 'active', 'cancelled', 'past_due', 'trialing'
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- STARTUPS & FUNDING
-- =====================================================

CREATE TABLE startups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    description TEXT,
    website VARCHAR(500),
    logo_url TEXT,
    founded_year INTEGER,

    -- Location
    city VARCHAR(255),
    state VARCHAR(255),
    country VARCHAR(255),
    continent VARCHAR(100),

    -- Classification
    vertical VARCHAR(100),
    sub_vertical VARCHAR(255),
    market_type VARCHAR(50), -- 'horizontal', 'vertical'
    target_market VARCHAR(50), -- 'b2b', 'b2c', 'b2b2c'

    -- GenAI Analysis
    uses_genai BOOLEAN DEFAULT FALSE,
    genai_intensity VARCHAR(50), -- 'core', 'enhancement', 'tooling', 'none'
    technical_depth VARCHAR(50), -- 'high', 'medium', 'low'

    -- Funding Summary
    total_funding_usd BIGINT DEFAULT 0,
    latest_funding_stage VARCHAR(50),
    latest_funding_amount BIGINT,
    latest_funding_date DATE,

    -- Metadata
    crunchbase_url VARCHAR(500),
    linkedin_url VARCHAR(500),
    twitter_url VARCHAR(500),
    github_url VARCHAR(500),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Search
    search_vector TSVECTOR
);

CREATE TABLE funding_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,
    round_type VARCHAR(50) NOT NULL, -- 'pre_seed', 'seed', 'series_a', etc.
    amount_usd BIGINT,
    announced_date DATE,

    -- Valuation (if disclosed)
    pre_money_valuation BIGINT,
    post_money_valuation BIGINT,

    -- Source
    source_url TEXT,
    source_name VARCHAR(255),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE investors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    type VARCHAR(50), -- 'vc', 'angel', 'corporate', 'accelerator', 'pe'
    website VARCHAR(500),
    logo_url TEXT,
    description TEXT,

    -- Location
    city VARCHAR(255),
    country VARCHAR(255),

    -- Stats
    total_investments INTEGER DEFAULT 0,
    total_invested_usd BIGINT DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE funding_round_investors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funding_round_id UUID REFERENCES funding_rounds(id) ON DELETE CASCADE,
    investor_id UUID REFERENCES investors(id) ON DELETE CASCADE,
    is_lead BOOLEAN DEFAULT FALSE,
    amount_usd BIGINT, -- If specific amount known

    UNIQUE(funding_round_id, investor_id)
);

-- =====================================================
-- BUILD PATTERNS & TECH ANALYSIS
-- =====================================================

CREATE TABLE build_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    category VARCHAR(100), -- 'architecture', 'data', 'security', 'infrastructure'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE startup_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,
    pattern_id UUID REFERENCES build_patterns(id) ON DELETE CASCADE,
    confidence DECIMAL(3,2), -- 0.00 to 1.00
    description TEXT,
    evidence TEXT[],

    UNIQUE(startup_id, pattern_id)
);

CREATE TABLE tech_stacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,

    -- LLM Usage
    llm_providers TEXT[], -- ['openai', 'anthropic', 'google']
    llm_models TEXT[], -- ['gpt-4', 'claude-3', 'gemini']

    -- Frameworks
    frameworks TEXT[], -- ['langchain', 'llamaindex', 'autogen']

    -- Infrastructure
    cloud_providers TEXT[], -- ['aws', 'azure', 'gcp']
    databases TEXT[],

    -- Approach
    approach VARCHAR(100), -- 'api_first', 'model_first', 'hybrid'
    has_custom_models BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- COMPETITIVE INTELLIGENCE
-- =====================================================

CREATE TABLE competitive_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,

    competitive_moat VARCHAR(50), -- 'strong', 'medium', 'weak'
    secret_sauce TEXT,
    defensibility TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE competitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,
    competitor_startup_id UUID REFERENCES startups(id), -- If in our DB
    competitor_name VARCHAR(255) NOT NULL,
    similarity TEXT,
    differentiation TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- CONTENT & BRIEFS
-- =====================================================

CREATE TABLE startup_briefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,
    period VARCHAR(7) NOT NULL, -- '2026-01'

    content_markdown TEXT NOT NULL,

    -- Key findings
    unique_findings TEXT[],
    story_angles JSONB, -- [{angle_type, headline, summary, uniqueness_score}]
    evidence_quotes TEXT[],

    -- Sources
    sources_crawled INTEGER DEFAULT 0,
    source_urls TEXT[],

    generated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(startup_id, period)
);

CREATE TABLE monthly_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period VARCHAR(7) UNIQUE NOT NULL, -- '2026-01'

    -- Summary Stats
    total_deals INTEGER,
    total_funding_usd BIGINT,
    average_deal_size BIGINT,
    median_deal_size BIGINT,
    genai_adoption_rate DECIMAL(5,2),

    -- Content
    newsletter_markdown TEXT,
    highlights JSONB,

    -- Patterns
    pattern_distribution JSONB, -- {pattern_name: count}

    generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- USER ENGAGEMENT
-- =====================================================

CREATE TABLE saved_startups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,
    list_name VARCHAR(255) DEFAULT 'Saved',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, startup_id, list_name)
);

CREATE TABLE startup_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    startup_id UUID REFERENCES startups(id) ON DELETE CASCADE,
    alert_types TEXT[], -- ['funding', 'news', 'team']
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, startup_id)
);

CREATE TABLE search_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255),
    filters JSONB, -- {vertical: [], stage: [], location: [], etc.}
    frequency VARCHAR(50), -- 'daily', 'weekly', 'instant'
    is_active BOOLEAN DEFAULT TRUE,
    last_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL, -- 'view_startup', 'search', 'export', 'save'
    entity_type VARCHAR(50), -- 'startup', 'investor', 'report'
    entity_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google_id ON users(google_id);

-- Startups
CREATE INDEX idx_startups_slug ON startups(slug);
CREATE INDEX idx_startups_vertical ON startups(vertical);
CREATE INDEX idx_startups_country ON startups(country);
CREATE INDEX idx_startups_uses_genai ON startups(uses_genai);
CREATE INDEX idx_startups_funding ON startups(total_funding_usd DESC);
CREATE INDEX idx_startups_search ON startups USING GIN(search_vector);

-- Funding
CREATE INDEX idx_funding_rounds_startup ON funding_rounds(startup_id);
CREATE INDEX idx_funding_rounds_date ON funding_rounds(announced_date DESC);

-- Investors
CREATE INDEX idx_investors_slug ON investors(slug);
CREATE INDEX idx_funding_round_investors_investor ON funding_round_investors(investor_id);

-- Patterns
CREATE INDEX idx_startup_patterns_startup ON startup_patterns(startup_id);
CREATE INDEX idx_startup_patterns_pattern ON startup_patterns(pattern_id);

-- User Engagement
CREATE INDEX idx_saved_startups_user ON saved_startups(user_id);
CREATE INDEX idx_activity_log_user ON activity_log(user_id);
CREATE INDEX idx_activity_log_created ON activity_log(created_at DESC);

-- =====================================================
-- FULL TEXT SEARCH TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION update_startup_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.company_name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.vertical, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(NEW.city, '')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER startup_search_update
    BEFORE INSERT OR UPDATE ON startups
    FOR EACH ROW
    EXECUTE FUNCTION update_startup_search_vector();
```

---

## 3. Backend API Design (FastAPI)

### Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   │
│   ├── api/
│   │   ├── __init__.py
│   │   ├── deps.py              # Dependencies (auth, db)
│   │   └── v1/
│   │       ├── __init__.py
│   │       ├── router.py
│   │       ├── auth.py          # Google OAuth, sessions
│   │       ├── users.py         # User profile, preferences
│   │       ├── startups.py      # Startup CRUD, search
│   │       ├── investors.py     # Investor endpoints
│   │       ├── funding.py       # Funding rounds
│   │       ├── patterns.py      # Build patterns
│   │       ├── reports.py       # Monthly reports
│   │       ├── subscriptions.py # Stripe integration
│   │       └── exports.py       # CSV/Excel exports
│   │
│   ├── core/
│   │   ├── __init__.py
│   │   ├── security.py          # JWT, OAuth
│   │   ├── config.py            # Settings
│   │   └── exceptions.py        # Custom exceptions
│   │
│   ├── db/
│   │   ├── __init__.py
│   │   ├── database.py          # SQLAlchemy setup
│   │   └── migrations/          # Alembic migrations
│   │
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── startup.py
│   │   ├── investor.py
│   │   ├── funding.py
│   │   ├── pattern.py
│   │   └── subscription.py
│   │
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── startup.py
│   │   ├── investor.py
│   │   ├── funding.py
│   │   └── subscription.py
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── auth_service.py      # Google OAuth logic
│   │   ├── startup_service.py   # Business logic
│   │   ├── search_service.py    # Full-text search
│   │   ├── stripe_service.py    # Payments
│   │   ├── email_service.py     # SendGrid
│   │   └── export_service.py    # CSV/Excel generation
│   │
│   └── workers/
│       ├── __init__.py
│       ├── data_sync.py         # Sync from analysis pipeline
│       └── alerts.py            # Process user alerts
│
├── tests/
├── alembic.ini
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

### Key API Endpoints

```yaml
# Authentication
POST   /api/v1/auth/google          # Google OAuth callback
POST   /api/v1/auth/refresh         # Refresh token
DELETE /api/v1/auth/logout          # Logout

# Users
GET    /api/v1/users/me             # Current user profile
PATCH  /api/v1/users/me             # Update profile
GET    /api/v1/users/me/saved       # Saved startups
POST   /api/v1/users/me/saved       # Save a startup
DELETE /api/v1/users/me/saved/{id}  # Remove saved

# Startups
GET    /api/v1/startups             # List with filters & pagination
GET    /api/v1/startups/search      # Full-text search
GET    /api/v1/startups/{slug}      # Startup detail
GET    /api/v1/startups/{slug}/brief # AI-generated brief
GET    /api/v1/startups/{slug}/funding # Funding history
GET    /api/v1/startups/{slug}/competitors # Competitive analysis

# Investors
GET    /api/v1/investors            # List investors
GET    /api/v1/investors/{slug}     # Investor detail
GET    /api/v1/investors/{slug}/portfolio # Portfolio companies

# Funding
GET    /api/v1/funding/rounds       # Recent funding rounds
GET    /api/v1/funding/stats        # Aggregated stats

# Patterns
GET    /api/v1/patterns             # All build patterns
GET    /api/v1/patterns/{slug}      # Pattern detail + startups

# Reports
GET    /api/v1/reports              # Monthly reports list
GET    /api/v1/reports/{period}     # Specific month report
GET    /api/v1/reports/{period}/newsletter # Newsletter content

# Subscriptions
GET    /api/v1/subscriptions/plans  # Available plans
POST   /api/v1/subscriptions/checkout # Create Stripe checkout
POST   /api/v1/subscriptions/webhook # Stripe webhook
GET    /api/v1/subscriptions/portal # Stripe customer portal

# Exports (Pro feature)
POST   /api/v1/exports/startups     # Export filtered startups
POST   /api/v1/exports/investors    # Export investors
```

---

## 4. Frontend Structure (Next.js)

### Enhanced Project Structure

```
apps/web/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── layout.tsx
│   │
│   ├── (dashboard)/
│   │   ├── layout.tsx              # Auth-protected layout
│   │   ├── page.tsx                # Dashboard home
│   │   │
│   │   ├── startups/
│   │   │   ├── page.tsx            # Startup search & list
│   │   │   └── [slug]/page.tsx     # Startup detail
│   │   │
│   │   ├── investors/
│   │   │   ├── page.tsx            # Investor directory
│   │   │   └── [slug]/page.tsx     # Investor detail
│   │   │
│   │   ├── funding/
│   │   │   └── page.tsx            # Funding rounds feed
│   │   │
│   │   ├── patterns/
│   │   │   ├── page.tsx            # Build patterns overview
│   │   │   └── [slug]/page.tsx     # Pattern detail
│   │   │
│   │   ├── reports/
│   │   │   ├── page.tsx            # Monthly reports
│   │   │   └── [period]/page.tsx   # Report detail
│   │   │
│   │   ├── saved/
│   │   │   └── page.tsx            # User's saved startups
│   │   │
│   │   ├── alerts/
│   │   │   └── page.tsx            # Manage alerts
│   │   │
│   │   └── settings/
│   │       ├── page.tsx            # Account settings
│   │       ├── subscription/page.tsx # Subscription management
│   │       └── api-keys/page.tsx   # API access (Pro)
│   │
│   ├── (marketing)/
│   │   ├── page.tsx                # Landing page
│   │   ├── pricing/page.tsx        # Pricing page
│   │   └── about/page.tsx          # About page
│   │
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts  # NextAuth.js
│   │   └── webhooks/stripe/route.ts     # Stripe webhook
│   │
│   ├── layout.tsx
│   └── globals.css
│
├── components/
│   ├── auth/
│   │   ├── GoogleSignInButton.tsx
│   │   ├── AuthGuard.tsx
│   │   └── UserMenu.tsx
│   │
│   ├── startups/
│   │   ├── StartupCard.tsx
│   │   ├── StartupFilters.tsx
│   │   ├── StartupSearch.tsx
│   │   └── StartupComparison.tsx
│   │
│   ├── subscription/
│   │   ├── PricingCard.tsx
│   │   ├── SubscriptionBadge.tsx
│   │   └── UpgradePrompt.tsx
│   │
│   └── ...
│
├── lib/
│   ├── auth.ts                     # NextAuth config
│   ├── api-client.ts               # API client
│   ├── stripe.ts                   # Stripe client
│   └── hooks/
│       ├── useStartups.ts
│       ├── useSubscription.ts
│       └── ...
│
└── ...
```

---

## 5. Subscription Tiers

| Feature | Free | Basic ($9/mo) | Pro ($29/mo) |
|---------|------|---------------|--------------|
| Startup profiles | 10/month | Unlimited | Unlimited |
| Search & filters | Basic | Advanced | Advanced |
| Funding data | Last 30 days | Full history | Full history |
| Build patterns | View only | Full analysis | Full analysis |
| AI briefs | 3/month | 20/month | Unlimited |
| Export (CSV) | ❌ | 100 rows/mo | Unlimited |
| Saved startups | 10 | 100 | Unlimited |
| Alerts | 1 | 5 | Unlimited |
| API access | ❌ | ❌ | ✅ |
| Priority support | ❌ | ❌ | ✅ |

---

## 6. Azure Infrastructure Design

### Recommended Setup

```yaml
# Resource Group: rg-aistartups-prod

# 1. Frontend - Azure Static Web Apps
static-web-app:
  name: swa-aistartups-prod
  sku: Standard  # $9/month - custom domains, auth
  region: East US 2
  build:
    app_location: apps/web
    output_location: .next
  custom_domains:
    - aistartups.io
    - www.aistartups.io

# 2. Backend - Azure Kubernetes Service
aks:
  name: aks-aistartups-prod
  sku: Standard
  node_pools:
    - name: system
      vm_size: Standard_B2s  # 2 vCPU, 4GB RAM
      count: 2
      mode: System
    - name: workload
      vm_size: Standard_B4ms  # 4 vCPU, 16GB RAM
      min_count: 2
      max_count: 5
      mode: User
      enable_autoscaling: true
  addons:
    - http_application_routing
    - monitoring
  network:
    network_plugin: azure
    load_balancer_sku: standard

# 3. Database - Azure PostgreSQL Flexible Server
postgresql:
  name: psql-aistartups-prod
  sku: GP_Standard_D2s_v3  # 2 vCPU, 8GB RAM
  storage_gb: 128
  backup_retention_days: 14
  geo_redundant_backup: enabled
  high_availability: zone_redundant
  version: 16

# 4. Cache - Azure Cache for Redis
redis:
  name: redis-aistartups-prod
  sku: Standard  # C1 - 1GB
  family: C
  capacity: 1

# 5. Storage - Azure Blob Storage
storage:
  name: staistartupsprod
  sku: Standard_LRS
  containers:
    - name: logos
      access: blob  # Public read
    - name: exports
      access: private
    - name: backups
      access: private

# 6. CDN - Azure Front Door
frontdoor:
  name: fd-aistartups-prod
  sku: Standard_AzureFrontDoor
  origins:
    - static-web-app
    - aks-ingress
  caching:
    - path: /api/*
      caching: disabled
    - path: /*
      caching: enabled
      ttl: 1d

# 7. Monitoring - Application Insights
app_insights:
  name: appi-aistartups-prod
  workspace: log-aistartups-prod

# 8. Key Vault
keyvault:
  name: kv-aistartups-prod
  secrets:
    - DATABASE_URL
    - STRIPE_SECRET_KEY
    - GOOGLE_CLIENT_SECRET
    - NEXTAUTH_SECRET
```

### Cost Estimate (Monthly)

| Service | SKU | Est. Cost |
|---------|-----|-----------|
| Static Web Apps | Standard | $9 |
| AKS (2-5 nodes) | B4ms | $150-350 |
| PostgreSQL Flexible | D2s_v3 | $100 |
| Redis Cache | C1 Standard | $40 |
| Blob Storage | Standard | $5 |
| Front Door | Standard | $35 |
| App Insights | Pay-as-you-go | $10 |
| **Total** | | **~$350-550/mo** |

---

## 7. Authentication Flow (Google OAuth)

### NextAuth.js Configuration

```typescript
// lib/auth.ts
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code"
        }
      }
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id;
      // Add subscription info
      const subscription = await prisma.subscription.findUnique({
        where: { userId: user.id }
      });
      session.user.subscription = subscription?.plan_type || 'free';
      return session;
    },
    async signIn({ user, account }) {
      // Create default free subscription for new users
      const existingUser = await prisma.user.findUnique({
        where: { email: user.email! }
      });
      if (!existingUser) {
        // Will be created by adapter, subscription created in webhook
      }
      return true;
    }
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
```

### Google Cloud Console Setup

1. Create project at https://console.cloud.google.com
2. Enable Google+ API
3. Create OAuth 2.0 credentials:
   - Authorized JavaScript origins: `https://aistartups.io`
   - Authorized redirect URIs: `https://aistartups.io/api/auth/callback/google`

---

## 8. Stripe Integration

### Subscription Flow

```typescript
// services/stripe_service.py
import stripe
from fastapi import HTTPException

stripe.api_key = settings.STRIPE_SECRET_KEY

PRICE_IDS = {
    'basic_monthly': 'price_xxx',
    'basic_yearly': 'price_xxx',
    'pro_monthly': 'price_xxx',
    'pro_yearly': 'price_xxx',
}

async def create_checkout_session(user_id: str, price_id: str):
    user = await get_user(user_id)

    # Get or create Stripe customer
    if not user.stripe_customer_id:
        customer = stripe.Customer.create(
            email=user.email,
            metadata={'user_id': user_id}
        )
        await update_user(user_id, stripe_customer_id=customer.id)

    # Create checkout session
    session = stripe.checkout.Session.create(
        customer=user.stripe_customer_id,
        payment_method_types=['card'],
        line_items=[{'price': price_id, 'quantity': 1}],
        mode='subscription',
        success_url=f'{settings.FRONTEND_URL}/settings/subscription?success=true',
        cancel_url=f'{settings.FRONTEND_URL}/pricing?cancelled=true',
        metadata={'user_id': user_id}
    )

    return session.url

async def handle_webhook(payload: bytes, signature: str):
    event = stripe.Webhook.construct_event(
        payload, signature, settings.STRIPE_WEBHOOK_SECRET
    )

    if event.type == 'checkout.session.completed':
        session = event.data.object
        await activate_subscription(
            user_id=session.metadata.user_id,
            subscription_id=session.subscription
        )

    elif event.type == 'customer.subscription.updated':
        subscription = event.data.object
        await update_subscription_status(subscription)

    elif event.type == 'customer.subscription.deleted':
        subscription = event.data.object
        await cancel_subscription(subscription.id)
```

---

## 9. Data Pipeline Integration

### Sync from Analysis Pipeline

```python
# workers/data_sync.py
from celery import Celery
from sqlalchemy.orm import Session
import json

celery = Celery('tasks', broker=settings.REDIS_URL)

@celery.task
def sync_startup_analysis(period: str):
    """Sync analyzed startups from JSON files to database"""

    analysis_path = f"data/{period}/output/analysis_store"

    with open(f"{analysis_path}/index.json") as f:
        index = json.load(f)

    with get_db() as db:
        for name, info in index['startups'].items():
            # Load base analysis
            with open(f"{analysis_path}/base_analyses/{info['slug']}.json") as f:
                analysis = json.load(f)

            # Upsert startup
            startup = upsert_startup(db, analysis)

            # Upsert patterns
            for pattern in analysis.get('build_patterns', []):
                upsert_startup_pattern(db, startup.id, pattern)

            # Upsert tech stack
            if analysis.get('tech_stack'):
                upsert_tech_stack(db, startup.id, analysis['tech_stack'])

            # Load and store brief if exists
            brief_path = f"data/{period}/output/briefs/{info['slug']}_brief.md"
            if os.path.exists(brief_path):
                with open(brief_path) as f:
                    upsert_brief(db, startup.id, period, f.read())

        db.commit()

@celery.task
def sync_monthly_stats(period: str):
    """Sync monthly statistics"""

    with open(f"data/{period}/output/monthly_stats.json") as f:
        stats = json.load(f)

    with get_db() as db:
        upsert_monthly_report(db, period, stats)
        db.commit()
```

---

## 10. Required External Integrations

| Service | Purpose | Setup Required |
|---------|---------|----------------|
| **Google Cloud** | OAuth authentication | Create OAuth app, configure redirect URIs |
| **Stripe** | Subscription payments | Create products/prices, configure webhooks |
| **SendGrid** | Transactional email | API key, domain verification |
| **Azure AD B2C** (optional) | Enterprise SSO | Configure identity providers |
| **Crunchbase API** (optional) | Enrich data | API key subscription |
| **Clearbit** (optional) | Company enrichment | API key |

---

## 11. Next Steps

1. **Database Setup**
   - [ ] Add your IP to Azure PostgreSQL firewall
   - [ ] Run schema migration
   - [ ] Seed initial data from JSON files

2. **Backend Development**
   - [ ] Set up FastAPI project structure
   - [ ] Implement authentication endpoints
   - [ ] Implement startup/investor endpoints
   - [ ] Set up Stripe webhooks

3. **Frontend Updates**
   - [ ] Add NextAuth.js
   - [ ] Create auth pages (login, signup)
   - [ ] Add subscription management
   - [ ] Implement feature gating

4. **Infrastructure**
   - [ ] Create Azure resources (Terraform/Bicep)
   - [ ] Set up CI/CD pipelines
   - [ ] Configure monitoring

5. **Launch**
   - [ ] Beta testing
   - [ ] Documentation
   - [ ] Marketing site
