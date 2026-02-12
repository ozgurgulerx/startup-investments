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
  status: signalStatus.optional(),
  domain: signalDomain.optional(),
  sort: z.enum(['conviction', 'momentum', 'impact', 'created']).optional().default('conviction'),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const signalsSummaryQuerySchema = z.object({
  region: optionalTrimmedString(20),
});
