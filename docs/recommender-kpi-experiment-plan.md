# Recommender KPI Dashboard and Experiment Plan

Last updated: 2026-02-13

## Purpose

Define how Build Atlas will measure whether recommendations increase:

- retention (`D7`, `D30`, repeat usage),
- engagement (follows, watchlist adds, alert/digest interaction),
- user value (faster discovery of relevant signals/startups).

This plan is designed to work with the current stack and existing recommendation path:

- Backend endpoint: `apps/api/src/index.ts` -> `GET /api/v1/signals/recommendations`
- Backend ranking service: `apps/api/src/services/signals.ts` -> `getSignalRecommendations(...)`
- Web proxy route: `apps/web/app/api/signals/recommendations/route.ts`
- Current recommendation UI surface: `apps/web/app/(app)/signals/interactive-signals.tsx`

## Scope

Phase 1 (now):

- Signals recommendation module (already in production)
- Instrumentation hardening and experimentization of current flow

Phase 2 (after Phase 1 win):

- Add recommendation blocks to Watchlist and Dealbook surfaces
- Reuse the same KPI and event taxonomy in this document

## Product Value Hypotheses

1. Recommendations reduce time-to-first-action by showing relevant opportunities earlier.
2. Recommendations increase watchlist/signal depth, improving downstream alert quality.
3. Better relevance loops increase weekly return behavior and long-term retention.

## KPI Framework

### North Star

- `Qualified Recommendation Action Rate (QRAR)`
- Definition: unique users with at least one qualified recommendation action / unique users exposed to recommendations
- Qualified actions:
  - follow signal from recommendation
  - add startup to watchlist from recommendation
  - open recommendation and perform any tracked downstream action within 24h

### Primary Success Metrics

| KPI | Definition | Target for rollout |
|---|---|---|
| QRAR | `users_with_qualified_action / exposed_users` | `+15%` relative vs control |
| Recommendation-attributed D7 return | Users with recommendation action who return in 7 days | `+8%` relative vs control |
| Follow/Add conversion | Follow or watchlist add after recommendation click (24h window) | `+20%` relative vs control |

### Secondary Metrics

| KPI | Definition | Why it matters |
|---|---|---|
| Watchlist depth | Avg tracked companies per active user | Stronger personalization signals |
| Signal follow depth | Avg followed signals per active user | Improves alert relevance |
| Alert open rate | Users opening alerts / users receiving alerts | Tests downstream utility |
| Digest open rate | Users opening digest / users receiving digest | Tests habit loop strength |

### Guardrails

| Guardrail | Threshold |
|---|---|
| Recommendation dismiss rate | Must not rise by more than `+10%` relative |
| Recommendation API error rate | `< 1.0%` |
| Recommendation API p95 latency | `< 700ms` server-side |
| 24h unfollow/unwatch after recommendation action | Must not rise by more than `+5%` relative |

## Dashboard Spec

Use PostHog for product analytics dashboards. Create one dashboard named `Recommender Health`.

### Panel Group A: Executive Snapshot

- Exposed users (DAU/WAU)
- QRAR
- Recommendation-attributed D7 return
- Recommendation-attributed D30 return
- Follow/add conversion (24h)

Breakdowns:

- `region` (`global`, `turkey`)
- `surface` (`signals`, `watchlist`, `dealbook`, `news`)
- `experiment_variant` (`control`, `treatment`)

### Panel Group B: Recommendation Funnel

Funnel steps:

1. `reco_list_viewed`
2. `reco_item_impression`
3. `reco_item_clicked`
4. `reco_item_followed` or `reco_item_watchlist_added`
5. `return_visit_7d` (derived)

Show:

- step conversion rates,
- median time between steps,
- top drop-off step.

### Panel Group C: Quality and Trust

- Dismiss rate by reason (`not_relevant`, `already_known`, `too_early`, `hide_category`)
- CTR by recommendation reason type (`watchlist_overlap`, `vertical_similarity`, `high_impact_fallback`)
- Repeat exposure rate for same item in 7 days (should trend down with dedupe)
- Diversity score by exposed set (distinct vertical IDs per user-week)

### Panel Group D: Delivery Health

- `GET /api/signals/recommendations` success/error rate
- p50/p95 latency
- empty result rate
- fallback usage rate (if ranking falls back to impact list)

## Event Taxonomy

Keep existing events and add recommendation-specific events. All names are snake_case.

### Existing events already present

- `signal_follow_toggle`
- `signal_follow_toggle_failed`
- `signals_new_dismiss`
- `alert_open`
- `alert_mark_read`
- `alert_mark_all_read`
- `digest_open`

### New required events

| Event | Trigger | Required properties |
|---|---|---|
| `reco_list_viewed` | Recommendation container rendered | `surface`, `region`, `algorithm_version`, `request_id`, `item_count` |
| `reco_item_impression` | Item enters viewport | `surface`, `item_type`, `item_id`, `position`, `reason_type`, `algorithm_version`, `request_id` |
| `reco_item_clicked` | User opens/selects a recommendation | `surface`, `item_type`, `item_id`, `position`, `reason_type`, `request_id` |
| `reco_item_followed` | Follow action executed from recommendation | `surface`, `item_type`, `item_id`, `position`, `request_id` |
| `reco_item_watchlist_added` | Watchlist add from recommendation | `surface`, `item_type`, `item_id`, `position`, `request_id` |
| `reco_item_dismissed` | User dismisses item | `surface`, `item_type`, `item_id`, `position`, `dismiss_reason`, `request_id` |
| `reco_feedback_submitted` | Explicit relevance feedback submitted | `surface`, `item_type`, `item_id`, `feedback_type`, `request_id` |

### Common properties (attach to all recommendation events)

- `user_id` (if authenticated)
- `region`
- `surface`
- `algorithm_version` (example: `signals_v1_overlap_impact`, `signals_v2_hybrid_ranker`)
- `experiment_name`
- `experiment_variant`
- `request_id` (unique per recommendation API response)
- `is_authenticated`

## Current File Touchpoints (Implementation Map)

Phase 1 instrumentation can be added in:

- `apps/web/app/(app)/signals/interactive-signals.tsx`
  - emit `reco_list_viewed`
  - emit per-card `reco_item_impression`
  - emit `reco_item_clicked`
  - enrich existing `signal_follow_toggle` with recommendation context when applicable
- `apps/web/app/api/signals/recommendations/route.ts`
  - pass through `request_id` and `algorithm_version` from backend response
- `apps/api/src/services/signals.ts`
  - include `request_id`, `algorithm_version`, `reason_type` in response payload
  - add server timing fields for latency monitoring

Phase 2 surfaces:

- `apps/web/app/(app)/watchlist/page.tsx`
- `apps/web/app/(app)/dealbook/interactive-dealbook.tsx`

## Experiment Plan

### Experiment 1: Ranking Quality (Signals Surface)

- Name: `reco_signals_ranking_v2`
- Unit of randomization: `user_id` (sticky assignment)
- Audience: authenticated users in `global` and `turkey`
- Variants:
  - `control`: current overlap + impact ranking
  - `treatment`: hybrid retrieval/ranking candidate set (or improved ranker), same UI

### Hypothesis

Treatment improves QRAR and D7 return without degrading dismiss rate or latency guardrails.

### Duration and sample

- Minimum runtime: 14 full days
- Minimum exposed users: 3,000 per arm
- Preferred target for stronger confidence: 8,000 per arm (roughly enough for ~15% relative lift detection on mid-single-digit conversion baselines)

### Decision rules

- Ship if:
  - QRAR improves >= `+15%` relative with statistical confidence,
  - no guardrail breach.
- Iterate if:
  - QRAR improves between `+5%` and `+15%`, or mixed segment outcomes.
- Roll back if:
  - QRAR declines, or any guardrail materially regresses.

### Experiment 2: Surface Expansion (Watchlist + Dealbook)

Start only after Experiment 1 passes.

- Name: `reco_surface_expansion_v1`
- `control`: recommendations only on Signals
- `treatment`: recommendations on Signals + Watchlist (then Dealbook)

Primary outcome:

- Lift in recommendation-attributed D7 return and watchlist depth.

## Attribution Rules

- Click attribution window: 24h
- Action attribution window: 24h after click
- Return attribution window: 7d and 30d after action
- Last-touch recommendation attribution when multiple recommendation interactions exist

## Operational Checklist

1. Add recommendation event emissions to Signals page.
2. Add `request_id`, `algorithm_version`, `reason_type` to recommendation response payload.
3. Create PostHog dashboard `Recommender Health` with panel groups A-D.
4. Define PostHog feature flag for experiment assignment.
5. Run internal QA on event payload completeness (no missing `request_id`).
6. Launch 10% traffic for 24h, then 50%, then 100% of experiment audience.
7. Evaluate at day 14 with decision rules.

## SQL Backstops (DB-side sanity checks)

These are not substitutes for PostHog experimentation but are useful health checks.

### Watchlist depth

```sql
SELECT
  COUNT(*)::numeric / NULLIF(COUNT(DISTINCT user_id), 0) AS avg_watchlist_items_per_user
FROM user_watchlists;
```

### Signal follow depth

```sql
SELECT
  COUNT(*)::numeric / NULLIF(COUNT(DISTINCT user_id), 0) AS avg_followed_signals_per_user
FROM user_signal_follows;
```

### Alert throughput and read behavior

```sql
SELECT
  DATE_TRUNC('week', created_at) AS week_utc,
  COUNT(*) AS alerts_created,
  COUNT(*) FILTER (WHERE status = 'read') AS alerts_marked_read
FROM user_alerts
GROUP BY 1
ORDER BY 1 DESC;
```

## Out of Scope (for this plan)

- Full recommender model architecture details (retrieval embeddings, ranker training pipeline)
- Cost/performance optimization of ANN infrastructure
- Anonymous-user personalization
