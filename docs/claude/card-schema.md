# News Card Schema & UI Reference

> Canonical reference for the news card data model, component hierarchy, rendering rules, and styling conventions. Read this before modifying any news card code.

## Table of Contents

1. [Type Definitions](#type-definitions)
2. [Database Schema](#database-schema)
3. [Data Flow](#data-flow)
4. [API Layer — `rowToCard()`](#api-layer)
5. [Component Hierarchy](#component-hierarchy)
6. [Rendering Rules](#rendering-rules)
7. [Utility Functions](#utility-functions)
8. [Constants & Enums](#constants--enums)
9. [Styling Conventions](#styling-conventions)
10. [Signals System](#signals-system)

---

## Type Definitions

**Source:** `packages/shared/src/types/index.ts`

### `ImpactFrame` (14 values)

```typescript
export type ImpactFrame =
  | 'UNDERWRITING_TAKE' | 'ADOPTION_PLAY' | 'COST_CURVE' | 'LATENCY_LEVER'
  | 'BENCHMARK_TRAP' | 'DATA_MOAT' | 'PROCUREMENT_WEDGE' | 'REGULATORY_CONSTRAINT'
  | 'ATTACK_SURFACE' | 'CONSOLIDATION_SIGNAL' | 'HIRING_SIGNAL'
  | 'PLATFORM_SHIFT' | 'GO_TO_MARKET_EDGE' | 'EARLY_SIGNAL';
```

### `ImpactObject` (6 fields)

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `frame` | `ImpactFrame` | yes | Analytical lens applied to the story |
| `kicker` | `string` | yes | Short context line (subtitle) |
| `builder_move` | `string` | yes | Actionable insight for builders |
| `investor_angle` | `string` | yes | Insight for investors |
| `watchout` | `string` | no | Potential risks or gotchas |
| `validation` | `string` | no | How to verify the claim |

### `NewsItemCard` (27 fields)

| Field | Type | Required | Source | Purpose |
|-------|------|----------|--------|---------|
| `id` | `string` | yes | `news_clusters.id` (UUID) | Unique cluster identifier |
| `title` | `string` | yes | `news_clusters.title` | Headline |
| `summary` | `string` | yes | `news_clusters.summary` | Short description |
| `image_url` | `string` | no | `news_cluster_items` (primary item payload) | Header image |
| `url` | `string` | yes | `news_cluster_items` (primary item URL) | External article link |
| `canonical_url` | `string` | no | Same as `url` | Canonical link |
| `published_at` | `string` | yes | `news_clusters.published_at` | ISO 8601 timestamp |
| `story_type` | `string` | yes | `news_clusters.story_type` | Classification (see Constants) |
| `topic_tags` | `string[]` | yes | `news_clusters.topic_tags` | Topic classifications |
| `entities` | `string[]` | yes | `news_clusters.entities` | Named entities (startups, people) |
| `rank_score` | `number` | yes | `news_clusters.rank_score` | 0-1 ranking score |
| `rank_reason` | `string` | yes | `news_clusters.rank_reason` | Why it was ranked |
| `trust_score` | `number` | yes | `news_clusters.trust_score` | 0-1 credibility metric |
| `source_count` | `number` | yes | `news_clusters.source_count` | Number of covering sources |
| `primary_source` | `string` | yes | `news_cluster_items` (primary item source name) | Lead source name |
| `sources` | `string[]` | yes | `news_cluster_items` (all items) | All source names |
| `builder_takeaway` | `string` | no | `news_clusters.builder_takeaway` | "Why It Matters" paragraph |
| `builder_takeaway_is_llm` | `boolean` | no | Inferred from `llm_model` presence | True if LLM-generated |
| `impact` | `ImpactObject` | no | `news_clusters.impact` (JSONB) | Structured impact analysis |
| `llm_summary` | `string` | no | `news_clusters.llm_summary` | LLM-generated summary |
| `llm_model` | `string` | no | Always `undefined` in API response | **Never exposed** — security |
| `llm_signal_score` | `number` | no | `news_clusters.llm_signal_score` | Signal strength (0-1) |
| `llm_confidence_score` | `number` | no | `news_clusters.llm_confidence_score` | LLM analysis confidence (0-1) |
| `llm_topic_tags` | `string[]` | no | `news_clusters.llm_topic_tags` | LLM-classified topics |
| `llm_story_type` | `string` | no | `news_clusters.llm_story_type` | LLM-classified story type |
| `upvote_count` | `number` | no | `news_item_stats.upvote_count` | Community upvotes |

### `DailyNewsBrief` (7 fields)

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `headline` | `string` | yes | Briefing headline |
| `summary` | `string` | yes | Summary paragraph |
| `bullets` | `string[]` | yes | Key bullet points (first 4 shown) |
| `themes` | `string[]` | no | Thematic tags (first 6 shown) |
| `model` | `string` | no | Model used (informational) |
| `generated_at` | `string` | no | ISO 8601 generation timestamp |
| `cluster_count` | `number` | no | Story count in the edition |

### `NewsEdition` (5 fields)

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `edition_date` | `string` | yes | YYYY-MM-DD |
| `generated_at` | `string` | yes | ISO 8601 |
| `items` | `NewsItemCard[]` | yes | Ranked story clusters |
| `brief` | `DailyNewsBrief` | no | Daily briefing card |
| `stats` | `object` | yes | `total_clusters`, `top_story_count`, `story_type_counts`, `topic_counts`, `updated_at` |

### `SignalActionType`

```typescript
export type SignalActionType = 'upvote' | 'save' | 'hide' | 'not_useful';
```

---

## Database Schema

### `news_clusters` (core story table)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `cluster_key` | TEXT | Unique story hash (with region) |
| `canonical_url` | TEXT | Representative article URL |
| `title` | TEXT | Headline |
| `summary` | TEXT | Short summary |
| `published_at` | TIMESTAMPTZ | Publication date |
| `topic_tags` | TEXT[] | Topic classifications |
| `entities` | TEXT[] | Named entities |
| `story_type` | TEXT | One of: funding, mna, regulation, launch, news |
| `source_count` | INTEGER | Source coverage count |
| `rank_score` | NUMERIC(8,4) | Ranking score |
| `rank_reason` | TEXT | Rank explanation |
| `trust_score` | NUMERIC(5,4) | 0-1 credibility |
| `builder_takeaway` | TEXT | Editorial insight (migration 013) |
| `llm_summary` | TEXT | LLM summary (migration 013) |
| `llm_model` | TEXT | Model identifier (migration 013) |
| `llm_signal_score` | NUMERIC(5,4) | Signal strength (migration 014) |
| `llm_confidence_score` | NUMERIC(5,4) | Confidence (migration 014) |
| `llm_topic_tags` | TEXT[] | LLM topics (migration 014) |
| `llm_story_type` | TEXT | LLM story type (migration 014) |
| `impact` | JSONB | Structured ImpactObject (migration 034) |
| `region` | TEXT | 'global' or 'turkey' (migration 030) |

**Key indexes:** `idx_news_clusters_published`, `idx_news_clusters_rank`, `idx_news_clusters_tags` (GIN), `idx_news_clusters_impact_frame`, `idx_news_clusters_region_rank`

### `news_daily_editions` (daily snapshots)

| Column | Type | Notes |
|--------|------|-------|
| `edition_date` | DATE | Part of composite PK |
| `region` | TEXT | Part of composite PK (migration 020) |
| `generated_at` | TIMESTAMPTZ | Build timestamp |
| `status` | TEXT | Always 'ready' |
| `top_cluster_ids` | UUID[] | Ordered cluster references |
| `stats_json` | JSONB | Stats + daily brief |

**`stats_json` structure:**
```json
{
  "total_clusters": 120,
  "top_story_count": 40,
  "story_type_counts": { "funding": 12, "launch": 8, "news": 15, "mna": 3, "regulation": 2 },
  "topic_counts": { "generative-ai": 18, "saas": 7 },
  "updated_at": "2026-02-10T06:00:00Z",
  "daily_brief": {
    "headline": "...",
    "summary": "...",
    "bullets": ["...", "..."],
    "themes": ["...", "..."],
    "cluster_count": 120,
    "generated_at": "2026-02-10T06:00:00Z"
  }
}
```

### `news_item_stats` (community engagement)

| Column | Type |
|--------|------|
| `cluster_id` | UUID (PK, FK) |
| `upvote_count` | INT |
| `save_count` | INT |
| `not_useful_count` | INT |
| `updated_at` | TIMESTAMPTZ |

### `news_item_signals` (per-user actions)

| Column | Type | Notes |
|--------|------|-------|
| `cluster_id` | UUID | FK to news_clusters |
| `action_type` | TEXT | upvote, save, hide, not_useful |
| `user_id` | UUID | Logged-in user (nullable) |
| `anon_id` | TEXT | Anonymous visitor (nullable) |

Constraint: exactly one of `user_id` or `anon_id` must be set.

---

## Data Flow

```
Raw News Sources (RSS / API / Crawler)
    ↓
news_items_raw  (ingestion, deduplicated by canonical_url)
    ↓
news_clusters   (clustering + ranking + LLM enrichment)
    │
    ├─ Memory Gate  (entity linking, fact extraction, novelty scoring)
    ├─ LLM Enrich   (llm_summary, builder_takeaway, impact, signal/confidence scores)
    └─ Scoring       (rank_score, trust_score)
    ↓
news_daily_editions  (top_cluster_ids snapshot + stats_json)
    ↓
API: getNewsEdition()
    │
    ├─ Fetch clusters by top_cluster_ids order
    ├─ JOIN news_cluster_items for primary URL / image
    ├─ LEFT JOIN news_item_stats for upvote_count
    └─ rowToCard() per row
    ↓
NewsEdition JSON response  (cached in Redis, 5 min TTL)
    ↓
Frontend components  (NewsCard / StoryCard / ImpactBox / etc.)
```

---

## API Layer

**Source:** `apps/api/src/services/news.ts`

### `rowToCard()` — DB row to `NewsItemCard`

**Critical business logic:**

1. **`builder_takeaway`**: Only included if `llm_model` is set. Heuristic/default text is suppressed — it's repetitive and misleading.
2. **`impact`**: Only included if `llm_model` is set AND the JSONB has both `frame` and `kicker`. Parsed from string if needed.
3. **`llm_model`**: Always set to `undefined` — never exposed in API responses.
4. **`builder_takeaway_is_llm`**: Derived as `Boolean(llm_model)`.
5. **Arrays**: Default to `[]` when null (topic_tags, entities, sources).
6. **Numbers**: Passed through `toNumber()` with fallback to 0.
7. **`url` / `canonical_url`**: Mapped from `row.primary_url` (joined from `news_cluster_items`).
8. **`primary_source`**: Defaults to `'Unknown'` if null.

### `extractBrief()` — `stats_json` to `DailyNewsBrief`

Extracts `stats_json.daily_brief` if `headline` exists. Returns `undefined` otherwise.

### Key API Routes

| Method | Path | Response | Cache |
|--------|------|----------|-------|
| GET | `/api/v1/news/latest` | `NewsEdition` | 5 min |
| GET | `/api/v1/news` | `NewsEdition` | 5 min |
| GET | `/api/v1/news/topics` | `{ topic, count }[]` | 5 min |
| GET | `/api/v1/news/archive` | `NewsArchiveDay[]` | 5 min |
| GET | `/api/v1/news/search` | `NewsSearchResult[]` | 5 min |
| POST | `/api/v1/news/signal` | `{ active, upvote_count }` | none |
| POST | `/api/v1/news/signals/batch` | `Record<string, SignalActionType[]>` | none |

---

## Component Hierarchy

All components live in `apps/web/components/news/`.

```
interactive-radar.tsx
├── DailyBriefCard       (edition summary, dismissable)
├── PinnedStoryCard      (top-ranked story, gradient border, "Top Impact" badge)
├── StoryCard            (main story list card, selectable, with ReactionBar)
│   ├── TrustBadge       (trust score + source count)
│   ├── ImpactBox        (structured impact or legacy builder_takeaway)
│   └── ReactionBar      (upvote / save / hide / not_useful buttons)
└── StoryContext         (detail panel for selected story)

news-card.tsx            (grid card variant used in NewsCard grid layout)
├── TrustBadge
├── ImpactBox
└── CoverageDrawer       (expandable secondary source list)

news-hero-card.tsx       (featured wrapper — gradient border + glow, passes featured=true)
└── NewsCard (featured)
```

### Component Props

| Component | Key Props | Notes |
|-----------|-----------|-------|
| `NewsCard` | `item: NewsItemCard`, `featured?: boolean`, `className?: string` | Grid layout card |
| `StoryCard` | `item`, `isSelected`, `onSelect`, `isNew?`, `onHide?` | List layout, selectable |
| `PinnedStoryCard` | Same as StoryCard | Gradient border, "Top Impact" badge |
| `NewsHeroCard` | `item: NewsItemCard` | Wraps NewsCard with glow effect |
| `ImpactBox` | `item: NewsItemCard`, `compact?: boolean` | Renders impact or builder_takeaway |
| `TrustBadge` | `trustScore: number`, `sourceCount: number` | Shield icon + trust % + source count |
| `CoverageDrawer` | `sources: string[]` | `<details>` element with source badges |
| `ReactionBar` | `clusterId: string`, `compact?: boolean`, `onHide?` | Signal toggle buttons |
| `DailyBriefCard` | `brief: DailyNewsBrief`, `onDismiss: () => void` | Edition summary widget |
| `SignalsProvider` | `clusterIds: string[]`, `initialUpvoteCounts?`, `children` | Context provider for signals |

---

## Rendering Rules

### Summary preference order

```
item.llm_summary  →  item.summary  →  item.rank_reason
```

Both `NewsCard` and `StoryCard` use the same fallback chain.

### Image handling

- **NewsCard**: Show if `item.image_url` starts with `"http"`. Lazy-loaded. On error, hide image and re-render without it.
- **StoryCard**: Show if `item.image_url` matches `/^https?:\/\//i`. On error, set `imageFailed` state to hide.
- **Featured (NewsCard)**: Image height `h-32`; non-featured `h-20`.
- **StoryCard**: Image height `h-28`.

### ImpactBox display logic

```
if item.impact exists:
    mode = impactDisplayMode(impact, llm_confidence_score)
    ├── 'full'         → Build + Invest + Watch (hover) + Verify (hover)
    ├── 'compact'      → investor_angle only
    └── 'early_signal' → Verify + Build
else if item.builder_takeaway exists:
    → Legacy "Why It Matters" box (line-clamp-3, expand on hover)
else:
    → null (nothing rendered)
```

**Display mode decision tree:**
1. `frame === 'EARLY_SIGNAL'` → `early_signal`
2. `confidenceScore < 0.45` → `early_signal`
3. `builder_move.length > 0` → `full`
4. Otherwise → `compact`

### ImpactBox field labels (in "full" mode)

| Field | Label | Hover-only in compact mode? |
|-------|-------|-----------------------------|
| `builder_move` | **Build:** | no |
| `investor_angle` | **Invest:** | no |
| `watchout` | **Watch:** | yes |
| `validation` | **Verify:** | yes |

### Origin badge

- `builder_takeaway_is_llm === true` → shows "LLM" badge
- `builder_takeaway_is_llm === false` → shows "AUTO" badge
- Only shown when `compact` is false

### Trust score thresholds (TrustBadge)

| Score (%) | Tone | Color Token |
|-----------|------|-------------|
| >= 70 | Success | `text-success` / green |
| 45 - 69 | Warning | `text-warning` / orange |
| < 45 | Neutral | `text-muted-foreground` / gray |

Display format: `{pct}% trust · {sourceCount} src` with ShieldCheck icon.

### Topic tags

- **NewsCard**: First 3 tags, linked to `/topics/{tag}`
- **StoryCard**: First 2 tags, linked to `/topics/{tag}`

### CoverageDrawer

- Filters out `primary_source` from `sources` array
- Shows: "Also covered by N source(s)"
- Only renders if filtered sources array is non-empty

---

## Utility Functions

**Source:** `apps/web/lib/news-utils.ts`

### `timeAgo(iso: string): string`

| Condition | Output |
|-----------|--------|
| Invalid date or < 1 hour | `"just now"` |
| 1-23 hours | `"{N}h ago"` |
| >= 24 hours | `"{N}d ago"` |

Uses `safeDate()` for Safari-compatible parsing.

### `storyTypeToneClass(storyType: string): string`

Card-level gradient tint (border + background).

| Story Type | Output |
|------------|--------|
| `funding` | `border-success/30 bg-gradient-to-br from-success/10 via-card/70 to-card/60` |
| `mna` | `border-delta/30 bg-gradient-to-br from-delta/10 via-card/70 to-card/60` |
| `regulation` | `border-warning/30 bg-gradient-to-br from-warning/10 via-card/70 to-card/60` |
| `launch` | `border-accent-info/30 bg-gradient-to-br from-accent-info/10 via-card/70 to-card/60` |
| default | `border-border/40 bg-card/65` |

### `storyTypeBadgeClass(storyType: string): string`

Flat badge colors (no gradient). Same color tokens, pattern: `border-{token}/30 bg-{token}/10 text-{token}`.

### `aiSignalLabel(score: number): string`

Returns `"AI {N}%"` where N is `Math.round(score * 100)`.

### `frameLabel(frame: string): string`

Maps `ImpactFrame` enum to display label:

| Frame | Label |
|-------|-------|
| `UNDERWRITING_TAKE` | Underwriting Take |
| `ADOPTION_PLAY` | Adoption Play |
| `COST_CURVE` | Cost Curve |
| `LATENCY_LEVER` | Latency Lever |
| `BENCHMARK_TRAP` | Benchmark Trap |
| `DATA_MOAT` | Data Moat |
| `PROCUREMENT_WEDGE` | Procurement Wedge |
| `REGULATORY_CONSTRAINT` | Regulatory Constraint |
| `ATTACK_SURFACE` | Attack Surface |
| `CONSOLIDATION_SIGNAL` | Consolidation Signal |
| `HIRING_SIGNAL` | Hiring Signal |
| `PLATFORM_SHIFT` | Platform Shift |
| `GO_TO_MARKET_EDGE` | Go-to-Market Edge |
| `EARLY_SIGNAL` | Early Signal |
| (unknown) | Why It Matters |

### `impactDisplayMode(impact, confidenceScore?): ImpactDisplayMode`

Returns `'full'` | `'compact'` | `'early_signal'`. See [Rendering Rules](#impactbox-display-logic).

---

## Constants & Enums

### Story Types

```typescript
'funding' | 'mna' | 'regulation' | 'launch' | 'news'
```

### Signal Actions

```typescript
'upvote' | 'save' | 'hide' | 'not_useful'
```

### Impact Frames (14)

```typescript
'UNDERWRITING_TAKE' | 'ADOPTION_PLAY' | 'COST_CURVE' | 'LATENCY_LEVER'
| 'BENCHMARK_TRAP' | 'DATA_MOAT' | 'PROCUREMENT_WEDGE' | 'REGULATORY_CONSTRAINT'
| 'ATTACK_SURFACE' | 'CONSOLIDATION_SIGNAL' | 'HIRING_SIGNAL'
| 'PLATFORM_SHIFT' | 'GO_TO_MARKET_EDGE' | 'EARLY_SIGNAL'
```

### Color Tokens

| Token | Semantic Use |
|-------|-------------|
| `success` | Funding, high trust, positive signals |
| `delta` | M&A, "not useful" reaction |
| `warning` | Regulation, medium trust, hide reaction |
| `accent-info` | Launches, AI signal, impact boxes, selected states |
| `accent` | Save/bookmark reaction |
| `muted-foreground` | Default/neutral states |

### Trust Thresholds

| Threshold | Meaning |
|-----------|---------|
| `>= 0.70` | High trust (green) |
| `>= 0.45` | Medium trust (orange) |
| `< 0.45` | Low trust (gray); also triggers `early_signal` impact mode |

### Impact Display Mode Thresholds

| Condition | Mode |
|-----------|------|
| `frame === 'EARLY_SIGNAL'` | `early_signal` |
| `confidenceScore < 0.45` | `early_signal` |
| `builder_move.length > 0` | `full` |
| fallback | `compact` |

---

## Styling Conventions

### Card containers

- **NewsCard** (grid): `rounded-xl border backdrop-blur-sm`, gradient tint via `storyTypeToneClass()`, hover lift (`-translate-y-0.5`), min-height `md:min-h-[340px]`
- **StoryCard** (list): `rounded-xl border p-3`, no gradient, selected state uses `border-accent-info/45 bg-accent-info/10`
- **PinnedStoryCard**: gradient border `border-accent-info/25 bg-gradient-to-br from-accent-info/10 via-card/80 to-card/50`
- **NewsHeroCard**: double border with glow — outer `rounded-2xl border-accent-info/30` + inner `bg-background/85` + blur circle

### Text sizing

| Element | Size |
|---------|------|
| Badges | `text-[10px]` or `text-[9px]` uppercase tracking-wider |
| Card title (featured) | `text-xl font-medium` |
| Card title (normal) | `text-base font-medium` (NewsCard) / `text-sm font-medium` (StoryCard) |
| Summary | `text-sm` (featured) / `text-xs` (normal) |
| Impact text | `text-[11px]` (compact) / `text-xs` (full) |
| Time ago | `text-[10px]` |

### Impact box styling

- Border: `border-accent-info/25`
- Background: `bg-accent-info/10`
- Field labels: `text-accent-info/80 font-medium`
- Compact spacing: `mt-2`; full spacing: `mt-3`
- Hover reveal: `hidden group-hover/brief:block` on watchout + validation in compact mode

### Reaction bar buttons

- Default: `border-border/30 bg-transparent text-muted-foreground`
- Active states per action:
  - upvote: `border-accent-info/40 bg-accent-info/15 text-accent-info`
  - save: `border-accent/40 bg-accent/15 text-accent`
  - hide: `border-warning/40 bg-warning/15 text-warning`
  - not_useful: `border-delta/40 bg-delta/15 text-delta`

---

## Signals System

**Source:** `apps/web/components/news/signals-provider.tsx`

### Architecture

`SignalsProvider` wraps the news page, providing a React context with:

```typescript
interface SignalsContextValue {
  getActions: (clusterId: string) => SignalActionType[];
  toggle: (clusterId: string, action: SignalActionType) => Promise<{ active: boolean; upvote_count: number }>;
  getUpvoteCount: (clusterId: string) => number;
}
```

### Flow

1. **Mount**: Batch-fetches user's existing signals via `POST /api/news/signals/batch`
2. **Toggle**: Optimistic update → `POST /api/news/signals` → reconcile with server truth
3. **Revert**: On network failure, optimistic update is reverted
4. **Anonymous**: Uses `anon_id` (browser-generated) when no `user_id` is available

### Hooks

- `useSignals()` — throws if outside provider (use in components that require signals)
- `useSignalsOptional()` — returns `null` if outside provider (use in shared components like `ReactionBar`)

---

## Key Files Reference

| File | What it defines |
|------|-----------------|
| `packages/shared/src/types/index.ts` | `NewsItemCard`, `ImpactObject`, `ImpactFrame`, `DailyNewsBrief`, `NewsEdition`, `SignalActionType` |
| `apps/api/src/services/news.ts` | `rowToCard()`, `extractBrief()`, `getNewsEdition()`, embedding helpers |
| `apps/api/src/validation.ts` | Zod schemas for API output validation |
| `apps/web/lib/news-utils.ts` | `timeAgo`, `storyTypeToneClass`, `storyTypeBadgeClass`, `aiSignalLabel`, `frameLabel`, `impactDisplayMode` |
| `apps/web/components/news/news-card.tsx` | `NewsCard` (grid card) |
| `apps/web/components/news/story-row.tsx` | `StoryCard`, `PinnedStoryCard` (list cards) |
| `apps/web/components/news/impact-box.tsx` | `ImpactBox` (structured impact + legacy fallback) |
| `apps/web/components/news/trust-badge.tsx` | `TrustBadge` |
| `apps/web/components/news/coverage-drawer.tsx` | `CoverageDrawer` |
| `apps/web/components/news/reaction-bar.tsx` | `ReactionBar` |
| `apps/web/components/news/signals-provider.tsx` | `SignalsProvider`, `useSignals`, `useSignalsOptional` |
| `apps/web/components/news/news-hero-card.tsx` | `NewsHeroCard` (featured wrapper) |
| `apps/web/components/news/daily-brief-card.tsx` | `DailyBriefCard` (edition summary) |
| `apps/web/components/news/interactive-radar.tsx` | Main news page layout (integrates all card components) |
| `database/migrations/012_daily_news.sql` | Core news tables |
| `database/migrations/013_add_llm_fields.sql` | builder_takeaway, llm_summary, llm_model |
| `database/migrations/014_add_signal_fields.sql` | llm_signal_score, llm_confidence_score, llm_topic_tags, llm_story_type |
| `database/migrations/029_news_signals.sql` | news_item_stats, news_item_signals |
| `database/migrations/034_impact_enrichment.sql` | impact JSONB column + index |
