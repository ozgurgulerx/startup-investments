import { pgTable, uuid, varchar, text, integer, boolean, timestamp, date, bigint, uniqueIndex, decimal, jsonb, customType } from 'drizzle-orm/pg-core';

// Custom bytea type for binary data (logos)
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
});
import { relations } from 'drizzle-orm';

// Startups table
export const startups = pgTable('startups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }),
  datasetRegion: varchar('dataset_region', { length: 20 }).notNull().default('global'),
  description: text('description'),
  website: varchar('website', { length: 500 }),
  foundedDate: date('founded_date'),
  headquartersCity: varchar('headquarters_city', { length: 100 }),
  headquartersCountry: varchar('headquarters_country', { length: 100 }),
  continent: varchar('continent', { length: 50 }),
  industry: varchar('industry', { length: 100 }),
  pattern: varchar('pattern', { length: 100 }),
  stage: varchar('stage', { length: 50 }),
  employeeCount: integer('employee_count'),
  genaiNative: boolean('genai_native').default(false),
  // Logo storage (binary data in database)
  logoData: bytea('logo_data'),
  logoContentType: varchar('logo_content_type', { length: 50 }),
  logoUpdatedAt: timestamp('logo_updated_at', { withTimezone: true }),
  // Context tracking fields
  contentHash: varchar('content_hash', { length: 64 }),
  lastCrawlAt: timestamp('last_crawl_at', { withTimezone: true }),
  crawlSuccessRate: decimal('crawl_success_rate', { precision: 3, scale: 2 }),
  // Analysis data (JSONB for full analysis storage)
  analysisData: jsonb('analysis_data'),
  period: varchar('period', { length: 10 }),
  moneyRaisedUsd: bigint('money_raised_usd', { mode: 'number' }),
  fundingStage: varchar('funding_stage', { length: 50 }),
  usesGenai: boolean('uses_genai').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueSlug: uniqueIndex('idx_startups_slug').on(table.datasetRegion, table.slug),
}));

// Funding rounds table
export const fundingRounds = pgTable('funding_rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),
  roundType: varchar('round_type', { length: 50 }).notNull(),
  amountUsd: bigint('amount_usd', { mode: 'number' }),
  announcedDate: date('announced_date'),
  leadInvestor: varchar('lead_investor', { length: 255 }),
  valuationUsd: bigint('valuation_usd', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueRound: uniqueIndex('idx_funding_rounds_unique').on(table.startupId, table.roundType, table.announcedDate),
}));

// Investors table
export const investors = pgTable('investors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  type: varchar('type', { length: 50 }),
  website: varchar('website', { length: 500 }),
  headquartersCountry: varchar('headquarters_country', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Investments junction table
export const investments = pgTable('investments', {
  id: uuid('id').primaryKey().defaultRandom(),
  fundingRoundId: uuid('funding_round_id').notNull().references(() => fundingRounds.id, { onDelete: 'cascade' }),
  investorId: uuid('investor_id').notNull().references(() => investors.id, { onDelete: 'cascade' }),
  isLead: boolean('is_lead').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueInvestment: uniqueIndex('unique_investment').on(table.fundingRoundId, table.investorId),
}));

// Newsletters table
export const newsletters = pgTable('newsletters', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 500 }).notNull(),
  content: text('content').notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  status: varchar('status', { length: 20 }).default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// =============================================================================
// CONTEXT MANAGEMENT TABLES
// =============================================================================

// Crawl logs - tracks crawl attempts and success rates
export const crawlLogs = pgTable('crawl_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').references(() => startups.id, { onDelete: 'cascade' }),
  sourceType: varchar('source_type', { length: 50 }).notNull(), // 'website', 'github', 'jobs', 'hackernews', 'deep_research'
  url: varchar('url', { length: 1000 }),

  // Status tracking
  status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending', 'success', 'failed', 'partial', 'blocked'
  httpStatus: integer('http_status'),
  errorMessage: text('error_message'),

  // Content metrics
  contentLength: integer('content_length'),
  pagesCrawled: integer('pages_crawled').default(1),
  usefulContentRatio: decimal('useful_content_ratio', { precision: 3, scale: 2 }), // 0.00-1.00

  // Timing
  crawlStartedAt: timestamp('crawl_started_at', { withTimezone: true }),
  crawlCompletedAt: timestamp('crawl_completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),

  // Retry tracking
  attemptNumber: integer('attempt_number').default(1),
  maxRetries: integer('max_retries').default(3),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),

  // Metadata
  userAgent: varchar('user_agent', { length: 500 }),
  proxyUsed: boolean('proxy_used').default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Startup snapshots - historical tracking of startup state
export const startupSnapshots = pgTable('startup_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),
  period: varchar('period', { length: 20 }).notNull(), // '2026-01' format

  // Point-in-time company data
  employeeCount: integer('employee_count'),
  fundingTotalUsd: bigint('funding_total_usd', { mode: 'number' }),
  latestRoundType: varchar('latest_round_type', { length: 50 }),
  latestRoundAmountUsd: bigint('latest_round_amount_usd', { mode: 'number' }),
  latestValuationUsd: bigint('latest_valuation_usd', { mode: 'number' }),

  // Analysis snapshot
  genaiIntensity: varchar('genai_intensity', { length: 50 }),
  buildPatterns: jsonb('build_patterns'), // Array of {name, confidence, evidence}
  confidenceScore: decimal('confidence_score', { precision: 5, scale: 2 }),
  newsletterPotential: varchar('newsletter_potential', { length: 50 }),
  technicalDepth: varchar('technical_depth', { length: 50 }),

  // Market position snapshot
  marketType: varchar('market_type', { length: 50 }),
  subVertical: varchar('sub_vertical', { length: 200 }),
  targetMarket: varchar('target_market', { length: 100 }),

  // Crawled content tracking
  contentHash: varchar('content_hash', { length: 64 }),
  sourcesCrawled: integer('sources_crawled').default(0),
  contentAnalyzedChars: integer('content_analyzed_chars').default(0),

  // Computed deltas from previous period
  fundingDeltaUsd: bigint('funding_delta_usd', { mode: 'number' }),
  employeeDelta: integer('employee_delta'),
  patternsChanged: boolean('patterns_changed').default(false),
  confidenceDelta: decimal('confidence_delta', { precision: 5, scale: 2 }),

  // Metadata
  snapshotReason: varchar('snapshot_reason', { length: 100 }), // 'monthly_batch', 'funding_event', 'manual'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueStartupPeriod: uniqueIndex('unique_startup_period').on(table.startupId, table.period),
}));

// Investor-startup links - tracks relationships across funding rounds
export const investorStartupLinks = pgTable('investor_startup_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  investorId: uuid('investor_id').notNull().references(() => investors.id, { onDelete: 'cascade' }),
  startupId: uuid('startup_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),

  // Relationship details
  relationshipType: varchar('relationship_type', { length: 50 }).notNull(), // 'lead', 'participant', 'board', 'advisor'
  firstRound: varchar('first_round', { length: 50 }),
  roundsParticipated: integer('rounds_participated').default(1),
  totalInvestedUsd: bigint('total_invested_usd', { mode: 'number' }),

  // Timestamps
  firstInvestmentDate: date('first_investment_date'),
  lastInvestmentDate: date('last_investment_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueInvestorStartup: uniqueIndex('unique_investor_startup').on(table.investorId, table.startupId),
}));

// Competitor links - tracks competitive relationships
export const competitorLinks = pgTable('competitor_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),
  competitorId: uuid('competitor_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),

  // Relationship details
  similarityScore: decimal('similarity_score', { precision: 3, scale: 2 }), // 0.00-1.00
  overlapType: varchar('overlap_type', { length: 100 }), // 'direct', 'adjacent', 'potential', 'substitute'

  // Analysis details
  sharedPatterns: jsonb('shared_patterns'), // Array of shared build patterns
  sharedVertical: varchar('shared_vertical', { length: 200 }),
  differentiationNotes: text('differentiation_notes'),

  // Metadata
  detectedBy: varchar('detected_by', { length: 50 }), // 'llm_analysis', 'pattern_match', 'manual'
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueCompetitorPair: uniqueIndex('unique_competitor_pair').on(table.startupId, table.competitorId),
}));

// Pattern correlations - tracks co-occurrence between build patterns
export const patternCorrelations = pgTable('pattern_correlations', {
  id: uuid('id').primaryKey().defaultRandom(),
  patternA: varchar('pattern_a', { length: 100 }).notNull(),
  patternB: varchar('pattern_b', { length: 100 }).notNull(),

  // Co-occurrence metrics
  coOccurrenceCount: integer('co_occurrence_count').default(0),
  totalStartupsWithA: integer('total_startups_with_a').default(0),
  totalStartupsWithB: integer('total_startups_with_b').default(0),

  // Funding correlation
  avgFundingWithBoth: bigint('avg_funding_with_both', { mode: 'number' }),
  avgFundingWithAOnly: bigint('avg_funding_with_a_only', { mode: 'number' }),
  avgFundingWithBOnly: bigint('avg_funding_with_b_only', { mode: 'number' }),

  // Correlation strength
  correlationCoefficient: decimal('correlation_coefficient', { precision: 4, scale: 3 }), // -1.000 to 1.000
  liftScore: decimal('lift_score', { precision: 5, scale: 2 }),

  // Metadata
  period: varchar('period', { length: 20 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniquePatternPair: uniqueIndex('unique_pattern_pair').on(table.patternA, table.patternB, table.period),
}));

// Deep research queue - tracks startups queued for deep research API
export const deepResearchQueue = pgTable('deep_research_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),

  // Queue management
  priority: integer('priority').default(5), // 1 (highest) to 10 (lowest)
  status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending', 'processing', 'completed', 'failed'
  reason: varchar('reason', { length: 100 }), // 'new_startup', 'funding_event', 'quarterly_refresh', 'manual'

  // Research configuration
  researchDepth: varchar('research_depth', { length: 20 }).default('standard'), // 'quick', 'standard', 'deep'
  focusAreas: jsonb('focus_areas'), // Array of specific areas to research

  // Results tracking
  tokensUsed: integer('tokens_used'),
  costUsd: decimal('cost_usd', { precision: 10, scale: 4 }),
  researchOutput: jsonb('research_output'),

  // Timing
  queuedAt: timestamp('queued_at', { withTimezone: true }).defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  // Error handling
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').default(0),
});

// Startup events - tracks events that trigger re-analysis
export const startupEvents = pgTable('startup_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').references(() => startups.id, { onDelete: 'cascade' }),

  // Event details
  eventType: varchar('event_type', { length: 50 }).notNull(), // 'funding_news', 'website_change', 'hackernews_mention', 'job_posting'
  eventSource: varchar('event_source', { length: 100 }), // 'techcrunch_rss', 'website_monitor', 'algolia_alert'
  eventTitle: text('event_title'),
  eventUrl: varchar('event_url', { length: 1000 }),
  eventContent: text('event_content'),

  // Processing status
  processed: boolean('processed').default(false),
  triggeredReanalysis: boolean('triggered_reanalysis').default(false),
  analysisId: uuid('analysis_id'),

  // Timestamps
  eventDate: timestamp('event_date', { withTimezone: true }),
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

// Relations
export const startupsRelations = relations(startups, ({ many }) => ({
  fundingRounds: many(fundingRounds),
  crawlLogs: many(crawlLogs),
  snapshots: many(startupSnapshots),
  investorLinks: many(investorStartupLinks),
  competitorsFrom: many(competitorLinks, { relationName: 'competitorFrom' }),
  competitorsTo: many(competitorLinks, { relationName: 'competitorTo' }),
  deepResearchQueue: many(deepResearchQueue),
  events: many(startupEvents),
}));

export const fundingRoundsRelations = relations(fundingRounds, ({ one, many }) => ({
  startup: one(startups, {
    fields: [fundingRounds.startupId],
    references: [startups.id],
  }),
  investments: many(investments),
}));

export const investorsRelations = relations(investors, ({ many }) => ({
  investments: many(investments),
  startupLinks: many(investorStartupLinks),
}));

export const investmentsRelations = relations(investments, ({ one }) => ({
  fundingRound: one(fundingRounds, {
    fields: [investments.fundingRoundId],
    references: [fundingRounds.id],
  }),
  investor: one(investors, {
    fields: [investments.investorId],
    references: [investors.id],
  }),
}));

// =============================================================================
// CONTEXT MANAGEMENT RELATIONS
// =============================================================================

export const crawlLogsRelations = relations(crawlLogs, ({ one }) => ({
  startup: one(startups, {
    fields: [crawlLogs.startupId],
    references: [startups.id],
  }),
}));

export const startupSnapshotsRelations = relations(startupSnapshots, ({ one }) => ({
  startup: one(startups, {
    fields: [startupSnapshots.startupId],
    references: [startups.id],
  }),
}));

export const investorStartupLinksRelations = relations(investorStartupLinks, ({ one }) => ({
  investor: one(investors, {
    fields: [investorStartupLinks.investorId],
    references: [investors.id],
  }),
  startup: one(startups, {
    fields: [investorStartupLinks.startupId],
    references: [startups.id],
  }),
}));

export const competitorLinksRelations = relations(competitorLinks, ({ one }) => ({
  startup: one(startups, {
    fields: [competitorLinks.startupId],
    references: [startups.id],
    relationName: 'competitorFrom',
  }),
  competitor: one(startups, {
    fields: [competitorLinks.competitorId],
    references: [startups.id],
    relationName: 'competitorTo',
  }),
}));

export const deepResearchQueueRelations = relations(deepResearchQueue, ({ one }) => ({
  startup: one(startups, {
    fields: [deepResearchQueue.startupId],
    references: [startups.id],
  }),
}));

export const startupEventsRelations = relations(startupEvents, ({ one }) => ({
  startup: one(startups, {
    fields: [startupEvents.startupId],
    references: [startups.id],
  }),
}));

