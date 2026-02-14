import { z } from 'zod';

// =============================================================================
// Reusable primitives
// =============================================================================

const paginationPage = z.coerce.number().int().min(1).max(1000).default(1);
const paginationLimit = z.coerce.number().int().min(1).max(100).default(25);
const periodParam = z.string().max(10).regex(/^(all|\d{4}-\d{2})$/).default('all');
function optionalTrimmedString(max: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.string().max(max).optional());
}

// Querystring params frequently arrive as `""` or `"   "`. Treat blanks as "not provided"
// so filtering + caching semantics stay aligned.
const optionalString = optionalTrimmedString(500);
const optionalSearchString = optionalTrimmedString(200);
const optionalTopicString = optionalTrimmedString(100);
const datasetRegionParam = z.enum(['global', 'turkey']).default('global');
const newsRegionParam = z.enum(['global', 'turkey']).default('global');
const sectorParam = optionalTrimmedString(50);
const newsDateParam = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

// =============================================================================
// GET endpoint schemas
// =============================================================================

export const startupsQuerySchema = z.object({
  page: paginationPage,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  region: datasetRegionParam,
});

export const companyQuerySchema = z.object({
  period: periodParam,
  region: datasetRegionParam,
});

export const statsQuerySchema = z.object({
  period: periodParam,
  region: datasetRegionParam,
});

export const periodsQuerySchema = z.object({
  region: datasetRegionParam,
});

export const dealBookQuerySchema = z.object({
  period: periodParam,
  region: datasetRegionParam,
  page: paginationPage,
  limit: paginationLimit,
  stage: optionalString,
  pattern: optionalString,
  continent: optionalString,
  vertical: optionalString,
  verticalId: optionalString,
  subVerticalId: optionalString,
  leafId: optionalString,
  minFunding: z.coerce.number().int().min(0).optional(),
  maxFunding: z.coerce.number().int().min(0).optional(),
  usesGenai: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['funding', 'name', 'date']).default('funding'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: optionalSearchString,
});

export const dealBookFiltersQuerySchema = z.object({
  period: periodParam,
  region: datasetRegionParam,
  verticalId: optionalString,
  subVerticalId: optionalString,
});

export const investorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const newsLatestQuerySchema = z.object({
  region: newsRegionParam,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const newsEditionQuerySchema = z.object({
  region: newsRegionParam,
  date: newsDateParam,
  topic: optionalTopicString,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const newsTopicsQuerySchema = z.object({
  region: newsRegionParam,
  date: newsDateParam,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const newsArchiveQuerySchema = z.object({
  region: newsRegionParam,
  limit: z.coerce.number().int().min(1).max(180).default(30),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const newsSourcesQuerySchema = z.object({
  region: newsRegionParam,
});

export const newsBriefQuerySchema = z.object({
  region: newsRegionParam,
});

export const newsSearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  region: newsRegionParam,
  limit: z.coerce.number().int().min(1).max(50).default(20),
  story_type: optionalTrimmedString(50),
  topic: optionalTopicString,
  date_from: newsDateParam,
  date_to: newsDateParam,
});

export const newsBriefArchiveQuerySchema = z.object({
  region: newsRegionParam,
  type: z.enum(['weekly', 'monthly']).default('weekly'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const sectorsQuerySchema = z.object({
  region: datasetRegionParam,
});

// =============================================================================
// News Signals schemas
// =============================================================================

const signalActionType = z.enum(['upvote', 'save', 'hide', 'not_useful']);

export const newsSignalToggleSchema = z.object({
  cluster_id: z.string().uuid(),
  action_type: signalActionType,
  user_id: z.string().uuid().optional(),
  anon_id: z.string().min(1).max(100).optional(),
}).refine(
  (data) => (data.user_id != null) !== (data.anon_id != null),
  { message: 'Exactly one of user_id or anon_id must be provided' }
);

export const newsSignalBatchSchema = z.object({
  cluster_ids: z.array(z.string().uuid()).min(1).max(200),
  user_id: z.string().uuid().optional(),
  anon_id: z.string().min(1).max(100).optional(),
}).refine(
  (data) => (data.user_id != null) !== (data.anon_id != null),
  { message: 'Exactly one of user_id or anon_id must be provided' }
);

export const newsSignalMergeSchema = z.object({
  user_id: z.string().uuid(),
  anon_id: z.string().min(1).max(100),
});

// =============================================================================
// Admin / POST schemas
// =============================================================================

// =============================================================================
// Editorial Feedback schemas
// =============================================================================

const editorialAction = z.enum(['reject', 'approve', 'flag', 'pin']);
const editorialReasonCategory = z.enum([
  'irrelevant_topic', 'not_startup', 'consumer_noise', 'duplicate',
  'low_quality_source', 'spam', 'off_region', 'big_tech_noise',
  'domain_chatter', 'other',
]);
const editorialRuleType = z.enum([
  'keyword_exclude', 'domain_exclude', 'source_downweight',
  'topic_exclude', 'entity_exclude', 'title_pattern_exclude',
]);

export const editorialActionSchema = z.object({
  cluster_id: z.string().uuid(),
  action: editorialAction,
  reason_category: editorialReasonCategory.optional(),
  reason_text: z.string().max(2000).optional(),
  title_keywords: z.array(z.string().max(100)).max(20).optional(),
});

export const editorialRuleCreateSchema = z.object({
  rule_type: editorialRuleType,
  region: newsRegionParam,
  rule_value: z.string().min(1).max(500),
  rule_weight: z.coerce.number().min(0).max(1).optional().default(1.0),
  notes: z.string().max(2000).optional(),
});

export const editorialRuleUpdateSchema = z.object({
  is_active: z.boolean().optional(),
  approved_at: z.enum(['now']).optional(),   // set to 'now' to approve
  notes: z.string().max(2000).optional(),
});

export const editorialReviewQuerySchema = z.object({
  region: newsRegionParam,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const editorialActionsQuerySchema = z.object({
  region: newsRegionParam,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const editorialRulesQuerySchema = z.object({
  region: newsRegionParam,
  include_pending: z.enum(['true', 'false']).default('true'),
});

export const editorialStatsQuerySchema = z.object({
  region: newsRegionParam,
  days: z.coerce.number().int().min(1).max(90).default(7),
});

// =============================================================================
// News output contract schemas (API response validation)
// =============================================================================

export const newsItemCardOutputSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  image_url: z.string().optional(),
  url: z.string(),
  canonical_url: z.string().optional(),
  published_at: z.string(),
  story_type: z.string(),
  topic_tags: z.array(z.string()),
  entities: z.array(z.string()),
  rank_score: z.number(),
  rank_reason: z.string(),
  trust_score: z.number(),
  source_count: z.number(),
  primary_source: z.string(),
  sources: z.array(z.string()),
  builder_takeaway: z.string().optional(),
  builder_takeaway_is_llm: z.boolean().optional(),
  llm_summary: z.string().optional(),
  llm_model: z.string().optional(),
  llm_signal_score: z.number().min(0).max(1).optional(),
  llm_confidence_score: z.number().min(0).max(1).optional(),
  llm_topic_tags: z.array(z.string()).optional(),
  llm_story_type: z.string().optional(),
  upvote_count: z.number().int().min(0).optional(),
});

export const dailyBriefOutputSchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  bullets: z.array(z.string()).min(1),
  themes: z.array(z.string()).optional(),
  generated_at: z.string().optional(),
  cluster_count: z.number().int().min(0).optional(),
});

export const newsEditionOutputSchema = z.object({
  edition_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generated_at: z.string().min(1),
  items: z.array(newsItemCardOutputSchema),
  brief: dailyBriefOutputSchema.optional(),
  stats: z.object({
    total_clusters: z.number(),
    top_story_count: z.number(),
    story_type_counts: z.record(z.string(), z.number()),
    topic_counts: z.record(z.string(), z.number()),
    updated_at: z.string(),
  }),
});

// =============================================================================
// Dealbook Brief schemas
// =============================================================================

export const briefQuerySchema = z.object({
  edition_id: z.string().uuid().optional(),
  region: datasetRegionParam,
  period_type: z.enum(['monthly', 'weekly']).default('monthly'),
  period_start: optionalTrimmedString(10),
  kind: z.enum(['rolling', 'sealed']).optional(),
  revision: z.preprocess((v) => {
    if (v === undefined || v === null || v === '' || v === 'latest') return undefined;
    return Number(v);
  }, z.number().int().min(1).optional()),
});

export const briefListSchema = z.object({
  region: datasetRegionParam,
  period_type: z.enum(['monthly', 'weekly']).default('monthly'),
  kind: z.enum(['rolling', 'sealed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const briefRegenerateSchema = z.object({
  region: z.enum(['global', 'turkey']).default('global'),
  period_type: z.enum(['monthly', 'weekly']).default('monthly'),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['rolling', 'sealed']).default('rolling'),
  force: z.boolean().optional().default(false),
});

// =============================================================================
// Admin / POST schemas
// =============================================================================

export const syncStartupSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(5000).optional().default(''),
  website: z.string().max(1000).optional().default(''),
  location: z.string().max(500).optional().default(''),
  industries: z.string().max(500).optional().default(''),
  roundType: z.string().max(100).optional().default(''),
  amountUsd: z.string().max(50).optional().default(''),
  announcedDate: z.string().max(20).optional().default(''),
  fundingStage: z.string().max(100).optional().default(''),
  leadInvestors: z.string().max(1000).optional().default(''),
});

export const syncRequestSchema = z.object({
  startups: z.array(syncStartupSchema).min(1).max(5000),
});

// =============================================================================
// Dossier Timeline
// =============================================================================

export const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: optionalTrimmedString(100),        // ISO effective_date for keyset pagination
  domain: z.enum(['architecture', 'gtm', 'capital', 'org', 'product']).optional(),
  type: optionalTrimmedString(50),           // event_type filter
  min_confidence: z.coerce.number().min(0).max(1).optional(),
  query: optionalTrimmedString(500),         // semantic search
  region: z.enum(['global', 'turkey']).default('global'),
});

// =============================================================================
// SIGNAL INTELLIGENCE
// =============================================================================

const signalStatus = z.enum(['candidate', 'emerging', 'accelerating', 'established', 'decaying']);
const signalDomain = z.enum(['architecture', 'gtm', 'capital', 'org', 'product']);

export const signalsQuerySchema = z.object({
  region: optionalTrimmedString(20),
  user_id: z.string().uuid().optional(),
  status: signalStatus.optional(),
  domain: signalDomain.optional(),
  sector: sectorParam,
  sort: z.enum(['conviction', 'momentum', 'impact', 'created', 'novelty', 'relevance']).optional().default('conviction'),
  window: z.coerce.number().int().refine(v => [7, 30, 90].includes(v)).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const signalsSummaryQuerySchema = z.object({
  region: optionalTrimmedString(20),
  sector: sectorParam,
  window: z.coerce.number().int().refine(v => [7, 30, 90].includes(v)).optional(),
});

export const signalRelevanceQuerySchema = z.object({
  region: optionalTrimmedString(20).optional(),
  user_id: z.string().uuid().optional(),
  window_days: z.coerce.number().int().min(7).max(365).optional().default(90),
  limit: z.coerce.number().int().min(1).max(25).optional().default(10),
});

// =============================================================================
// SIGNAL DEEP DIVES
// =============================================================================

export const deepDiveVersionQuerySchema = z.object({
  version: z.coerce.number().int().min(1),
});

export const occurrencesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const movesQuerySchema = z.object({
  startup_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const deepDiveListQuerySchema = z.object({
  region: optionalTrimmedString(20),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

// =============================================================================
// MOVERS / CHANGEFEED
// =============================================================================

const deltaType = z.enum([
  'funding_round', 'pattern_added', 'pattern_removed', 'signal_spike',
  'score_change', 'stage_change', 'employee_change', 'rank_jump',
  'new_entry', 'gtm_shift',
]);

export const moversFeedQuerySchema = z.object({
  region: z.enum(['global', 'turkey']).default('global'),
  delta_type: deltaType.optional(),
  domain: optionalTrimmedString(50),
  sector: sectorParam,
  startup_id: z.string().uuid().optional(),
  period: optionalTrimmedString(10),
  min_magnitude: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const moversSummaryQuerySchema = z.object({
  region: z.enum(['global', 'turkey']).default('global'),
  sector: sectorParam,
  period: optionalTrimmedString(10),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const moversUnreadQuerySchema = z.object({
  region: z.enum(['global', 'turkey']).default('global'),
  user_id: z.string().uuid(),
});

export const moversSeenSchema = z.object({
  user_id: z.string().uuid(),
  region: z.enum(['global', 'turkey']).default('global'),
  seen_at: z.string().datetime().optional(),
});

export const startupDeltasQuerySchema = z.object({
  region: z.enum(['global', 'turkey']).default('global'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const startupNeighborsQuerySchema = z.object({
  region: z.enum(['global', 'turkey']).default('global'),
  period: optionalTrimmedString(10),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const startupBenchmarksQuerySchema = z.object({
  region: z.enum(['global', 'turkey']).default('global'),
  period: optionalTrimmedString(10),
});

// =============================================================================
// BENCHMARKS (standalone page)
// =============================================================================

export const benchmarksQuerySchema = z.object({
  cohort_type: optionalTrimmedString(50),
  cohort_key: optionalTrimmedString(200),
  sector: sectorParam,
  region: z.enum(['global', 'turkey']).default('global'),
  period: optionalTrimmedString(10),
  metric: optionalTrimmedString(50),
});

export const benchmarksCompareQuerySchema = z.object({
  startup_id: z.string().uuid(),
  region: z.enum(['global', 'turkey']).default('global'),
  period: optionalTrimmedString(10),
});

export const benchmarksCohortQuerySchema = z.object({
  region: z.enum(['global', 'turkey']).default('global'),
  period: optionalTrimmedString(10),
});

// =============================================================================
// INVESTOR DNA
// =============================================================================

export const investorDnaQuerySchema = z.object({
  scope: z.enum(['global', 'turkey']).default('global'),
  window: z.coerce.number().int().min(1).max(36).optional().default(12),
});

export const investorScreenerQuerySchema = z.object({
  pattern: optionalTrimmedString(200),
  stage: optionalTrimmedString(50),
  min_deals: z.coerce.number().int().min(1).optional().default(1),
  sort: z.enum(['deal_count', 'total_amount', 'thesis_shift', 'lead_rate']).default('deal_count'),
  scope: z.enum(['global', 'turkey']).default('global'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const investorPortfolioQuerySchema = z.object({
  scope: z.enum(['global', 'turkey']).default('global'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const investorNetworkQuerySchema = z.object({
  scope: z.enum(['global', 'turkey']).default('global'),
  depth: z.coerce.number().int().min(1).max(2).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const investorNewsQuerySchema = z.object({
  scope: z.enum(['global', 'turkey']).default('global'),
  // Optional back-compat filter window. When omitted, we return all-time investor news (no aging).
  days: z.coerce.number().int().min(1).max(36_500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const startupInvestorsQuerySchema = z.object({
  scope: z.enum(['global', 'turkey']).default('global'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const startupFoundersQuerySchema = z.object({
  scope: z.enum(['global', 'turkey']).default('global'),
});

const aliasArraySchema = z.array(z.string().min(1).max(255)).max(200).optional().default([]);

export const investorUpsertSchema = z.object({
  name: z.string().min(1).max(255),
  type: optionalTrimmedString(50),
  website: optionalTrimmedString(1000),
  headquarters_country: optionalTrimmedString(100),
  aliases: aliasArraySchema,
  source: optionalTrimmedString(100).default('manual'),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

export const founderUpsertSchema = z.object({
  full_name: z.string().min(1).max(255),
  slug: optionalTrimmedString(255),
  linkedin_url: optionalTrimmedString(1000),
  x_url: optionalTrimmedString(1000),
  website: optionalTrimmedString(1000),
  bio: optionalTrimmedString(5000),
  primary_country: optionalTrimmedString(100),
  aliases: aliasArraySchema,
  source: optionalTrimmedString(100).default('manual'),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

export const graphEdgeUpsertSchema = z.object({
  src_type: z.enum(['investor', 'startup', 'founder', 'funding_round']),
  src_id: z.string().uuid(),
  edge_type: z.string().min(1).max(120),
  dst_type: z.enum(['investor', 'startup', 'founder', 'funding_round']),
  dst_id: z.string().uuid(),
  region: z.enum(['global', 'turkey']).default('global'),
  attrs_json: z.record(z.unknown()).optional().default({}),
  source: optionalTrimmedString(100).default('manual'),
  source_ref: optionalTrimmedString(1000),
  confidence: z.coerce.number().min(0).max(1).optional(),
  created_by: optionalTrimmedString(255),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().default('1900-01-01'),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().default('9999-12-31'),
}).refine((data) => !(data.src_type === data.dst_type && data.src_id === data.dst_id), {
  message: 'Self-loop edges are not allowed',
});

export const graphEdgesBulkUpsertSchema = z.object({
  edges: z.array(graphEdgeUpsertSchema).min(1).max(5000),
  refresh_views: z.boolean().optional().default(true),
});

export const onboardingContextCreateSchema = z.object({
  startupId: z.string().uuid().optional(),
  investorId: z.string().uuid().optional(),
  contextText: z.string().min(1).max(20000),
  traceEventId: z.string().uuid().optional(),
  source: z.enum(['admin', 'slack', 'api']).optional().default('admin'),
  createdBy: optionalTrimmedString(255),
  enqueueResearch: z.boolean().optional().default(true),
  metadata: z.record(z.unknown()).optional().default({}),
}).refine((data) => Boolean(data.startupId || data.investorId), {
  message: 'startupId or investorId is required',
  path: ['startupId'],
});

export const onboardingContextTemplateQuerySchema = z.object({
  startupId: z.string().uuid().optional(),
  investorId: z.string().uuid().optional(),
  traceEventId: z.string().uuid().optional(),
});

// =============================================================================
// ADMIN - PAID HEADLINE SEEDS (manual paywalled-source leads)
// =============================================================================

export const headlineSeedCreateSchema = z.object({
  publisherKey: z.enum(['theinformation']),
  url: z.string().url().max(2000),
  title: optionalTrimmedString(300),
  publishedAt: z.string().datetime().optional(),
});

export const headlineSeedsQuerySchema = z.object({
  publisherKey: z.enum(['theinformation']).optional(),
  status: z.enum(['new', 'processed', 'failed', 'ignored']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// =============================================================================
// PATTERN LANDSCAPES
// =============================================================================

export const landscapesQuerySchema = z.object({
  scope: z.enum(['global', 'turkey']).default('global'),
  period: optionalTrimmedString(10),
  sector: sectorParam,
  size_by: z.enum(['funding', 'count', 'deals']).default('funding'),
  color_by: z.enum(['stage', 'vertical', 'signal']).default('stage'),
  stage: optionalTrimmedString(50),
});

export const landscapesClusterQuerySchema = z.object({
  pattern: z.string().min(1).max(200),
  scope: z.enum(['global', 'turkey']).default('global'),
  period: optionalTrimmedString(10),
});

// =============================================================================
// SUBSCRIPTIONS & ALERTS
// =============================================================================

export const subscriptionCreateSchema = z.object({
  object_type: z.enum(['startup', 'investor', 'pattern', 'cohort']),
  object_id: z.string().min(1).max(500),
  scope: z.enum(['global', 'turkey']).default('global'),
});

export const subscriptionDeleteSchema = z.object({
  object_type: z.enum(['startup', 'investor', 'pattern', 'cohort']),
  object_id: z.string().min(1).max(500),
  scope: z.enum(['global', 'turkey']).default('global'),
});

export const subscriptionsQuerySchema = z.object({
  scope: z.enum(['global', 'turkey']).default('global'),
});

export const alertsQuerySchema = z.object({
  scope: z.enum(['global', 'turkey']).default('global'),
  status: z.enum(['unread', 'read', 'archived']).optional(),
  severity_min: z.coerce.number().int().min(1).max(5).optional(),
  type: optionalTrimmedString(50),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const alertUpdateSchema = z.object({
  status: z.enum(['read', 'archived']),
});

export const alertBatchUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(['read', 'archived']),
});

export const alertDigestQuerySchema = z.object({
  scope: z.enum(['global', 'turkey']).default('global'),
  period: z.enum(['latest']).default('latest'),
});
