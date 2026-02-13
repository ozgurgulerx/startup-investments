import { pgTable, uuid, varchar, text, integer, boolean, timestamp, date, bigint, uniqueIndex, index, decimal, jsonb, customType, real } from 'drizzle-orm/pg-core';

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
  mergedIntoStartupId: uuid('merged_into_startup_id'),
  onboardingStatus: varchar('onboarding_status', { length: 20 }).notNull().default('verified'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueSlug: uniqueIndex('idx_startups_slug').on(table.datasetRegion, table.slug),
}));

// Startup aliases — maps old names/slugs/domains to canonical startup after merge
export const startupAliases = pgTable('startup_aliases', {
  id: uuid('id').defaultRandom().primaryKey(),
  alias: text('alias').notNull(),
  startupId: uuid('startup_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),
  aliasType: varchar('alias_type', { length: 20 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueAlias: uniqueIndex('uq_startup_aliases_alias').on(table.alias),
  startupIdx: index('idx_startup_aliases_startup').on(table.startupId),
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
  source: varchar('source', { length: 50 }).notNull().default('csv'),
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

// Founders table
export const founders = pgTable('founders', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  slug: text('slug'),
  linkedinUrl: text('linkedin_url'),
  xUrl: text('x_url'),
  website: text('website'),
  bio: text('bio'),
  primaryCountry: text('primary_country'),
  source: text('source').notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueFounderSlug: uniqueIndex('uq_founders_slug').on(table.slug),
  uniqueFounderLinkedin: uniqueIndex('uq_founders_linkedin_url').on(table.linkedinUrl),
  uniqueFounderXUrl: uniqueIndex('uq_founders_x_url').on(table.xUrl),
  founderNameIdx: index('idx_founders_name_norm').on(table.fullName),
}));

// Founder aliases
export const founderAliases = pgTable('founder_aliases', {
  id: uuid('id').primaryKey().defaultRandom(),
  founderId: uuid('founder_id').notNull().references(() => founders.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  aliasType: text('alias_type').notNull().default('name_variant'),
  source: text('source').notNull().default('manual'),
  confidence: decimal('confidence', { precision: 5, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueFounderAlias: uniqueIndex('uq_founder_aliases_alias_norm').on(table.alias),
  founderAliasFounderIdx: index('idx_founder_aliases_founder').on(table.founderId),
}));

// Investor aliases
export const investorAliases = pgTable('investor_aliases', {
  id: uuid('id').primaryKey().defaultRandom(),
  investorId: uuid('investor_id').notNull().references(() => investors.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  aliasType: text('alias_type').notNull().default('name_variant'),
  source: text('source').notNull().default('manual'),
  confidence: decimal('confidence', { precision: 5, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueInvestorAlias: uniqueIndex('uq_investor_aliases_alias_norm').on(table.alias),
  investorAliasInvestorIdx: index('idx_investor_aliases_investor').on(table.investorId),
}));

// Startup-founder links
export const startupFounders = pgTable('startup_founders', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),
  founderId: uuid('founder_id').notNull().references(() => founders.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default(''),
  isCurrent: boolean('is_current').notNull().default(true),
  startDate: date('start_date'),
  endDate: date('end_date'),
  ownershipPct: decimal('ownership_pct', { precision: 5, scale: 2 }),
  source: text('source').notNull().default('manual'),
  confidence: decimal('confidence', { precision: 5, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueStartupFounderRole: uniqueIndex('uq_startup_founders_unique').on(table.startupId, table.founderId, table.role),
  startupFoundersStartupIdx: index('idx_startup_founders_startup').on(table.startupId),
  startupFoundersFounderIdx: index('idx_startup_founders_founder').on(table.founderId),
}));

// Canonical graph edges for investors/startups/founders/funding_rounds
export const capitalGraphEdges = pgTable('capital_graph_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  srcType: text('src_type').notNull(),
  srcId: uuid('src_id').notNull(),
  edgeType: text('edge_type').notNull(),
  dstType: text('dst_type').notNull(),
  dstId: uuid('dst_id').notNull(),
  region: text('region').notNull().default('global'),
  attrsJson: jsonb('attrs_json').notNull().default({}),
  source: text('source').notNull().default('manual'),
  sourceRef: text('source_ref'),
  confidence: decimal('confidence', { precision: 5, scale: 4 }),
  createdBy: text('created_by'),
  validFrom: date('valid_from').notNull().default('1900-01-01'),
  validTo: date('valid_to').notNull().default('9999-12-31'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueGraphEdgeIdentity: uniqueIndex('uq_capital_graph_edges_identity')
    .on(table.srcType, table.srcId, table.edgeType, table.dstType, table.dstId, table.region, table.validFrom, table.validTo),
  graphSrcActiveIdx: index('idx_capital_graph_src_active').on(table.srcType, table.srcId, table.region, table.edgeType),
  graphDstActiveIdx: index('idx_capital_graph_dst_active').on(table.dstType, table.dstId, table.region, table.edgeType),
  graphEdgeTypeIdx: index('idx_capital_graph_edge_type').on(table.edgeType, table.region),
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
  eventKey: text('event_key'),

  // Processing status
  processed: boolean('processed').default(false),
  triggeredReanalysis: boolean('triggered_reanalysis').default(false),
  analysisId: uuid('analysis_id'),

  // Timestamps
  eventDate: timestamp('event_date', { withTimezone: true }),
  effectiveDate: date('effective_date'),
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

// Relations
export const startupsRelations = relations(startups, ({ many }) => ({
  fundingRounds: many(fundingRounds),
  crawlLogs: many(crawlLogs),
  snapshots: many(startupSnapshots),
  investorLinks: many(investorStartupLinks),
  founderLinks: many(startupFounders),
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
  aliases: many(investorAliases),
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

export const foundersRelations = relations(founders, ({ many }) => ({
  aliases: many(founderAliases),
  startupLinks: many(startupFounders),
}));

export const founderAliasesRelations = relations(founderAliases, ({ one }) => ({
  founder: one(founders, {
    fields: [founderAliases.founderId],
    references: [founders.id],
  }),
}));

export const investorAliasesRelations = relations(investorAliases, ({ one }) => ({
  investor: one(investors, {
    fields: [investorAliases.investorId],
    references: [investors.id],
  }),
}));

export const startupFoundersRelations = relations(startupFounders, ({ one }) => ({
  startup: one(startups, {
    fields: [startupFounders.startupId],
    references: [startups.id],
  }),
  founder: one(founders, {
    fields: [startupFounders.founderId],
    references: [founders.id],
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

// =============================================================================
// SIGNAL INTELLIGENCE ENGINE
// =============================================================================

// Event registry - canonical event type definitions
export const eventRegistry = pgTable('event_registry', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull(),
  eventType: text('event_type').notNull(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  extractionMethod: text('extraction_method').notNull().default('heuristic'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Pattern registry - authoritative pattern definitions
export const patternRegistry = pgTable('pattern_registry', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull(),
  clusterName: text('cluster_name').notNull(),
  patternName: text('pattern_name').notNull(),
  category: text('category'),
  status: text('status').notNull().default('active'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Signals - statistical claims with lifecycle scoring
export const signals = pgTable('signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull(),
  clusterName: text('cluster_name'),
  patternId: uuid('pattern_id').references(() => patternRegistry.id),
  claim: text('claim').notNull(),
  region: text('region').notNull().default('global'),
  conviction: decimal('conviction', { precision: 5, scale: 4 }).notNull().default('0'),
  momentum: decimal('momentum', { precision: 5, scale: 4 }).notNull().default('0'),
  impact: decimal('impact', { precision: 5, scale: 4 }).notNull().default('0'),
  adoptionVelocity: decimal('adoption_velocity', { precision: 8, scale: 4 }).notNull().default('0'),
  status: text('status').notNull().default('candidate'),
  evidenceCount: integer('evidence_count').notNull().default(0),
  uniqueCompanyCount: integer('unique_company_count').notNull().default(0),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
  lastEvidenceAt: timestamp('last_evidence_at', { withTimezone: true }),
  lastScoredAt: timestamp('last_scored_at', { withTimezone: true }),
  metadataJson: jsonb('metadata_json').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Signal evidence - links signals to events/clusters
export const signalEvidence = pgTable('signal_evidence', {
  id: uuid('id').primaryKey().defaultRandom(),
  signalId: uuid('signal_id').notNull().references(() => signals.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id').references(() => startupEvents.id, { onDelete: 'set null' }),
  clusterId: uuid('cluster_id'),
  startupId: uuid('startup_id').references(() => startups.id, { onDelete: 'set null' }),
  weight: decimal('weight', { precision: 5, scale: 4 }).notNull().default('1'),
  evidenceType: text('evidence_type').notNull().default('event'),
  snippet: text('snippet'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const signalsRelations = relations(signals, ({ one }) => ({
  pattern: one(patternRegistry, {
    fields: [signals.patternId],
    references: [patternRegistry.id],
  }),
}));

// =============================================================================
// MOVERS / CHANGEFEED
// =============================================================================

// Delta events — captures startup state changes between periods
export const deltaEvents = pgTable('delta_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').references(() => startups.id, { onDelete: 'cascade' }),
  signalId: uuid('signal_id').references(() => signals.id, { onDelete: 'set null' }),
  deltaType: text('delta_type').notNull(),
  domain: text('domain').notNull().default('general'),
  region: text('region').notNull().default('global'),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  magnitude: real('magnitude'),
  direction: text('direction'),
  headline: text('headline').notNull(),
  detail: text('detail'),
  evidenceJson: jsonb('evidence_json').notNull().default({}),
  period: text('period'),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// User feed state — tracks read position per user per region
export const userFeedState = pgTable('user_feed_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  region: text('region').notNull().default('global'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().default(new Date('1970-01-01')),
}, (table) => ({
  uniqueUserRegion: uniqueIndex('uq_user_feed_state').on(table.userId, table.region),
}));

// =============================================================================
// COMPARABLES & BENCHMARKS
// =============================================================================

// Startup neighbors — pre-computed similar startups
export const startupNeighbors = pgTable('startup_neighbors', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),
  neighborId: uuid('neighbor_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),
  rank: integer('rank').notNull(),
  overallScore: real('overall_score').notNull(),
  vectorScore: real('vector_score'),
  patternScore: real('pattern_score'),
  metaScore: real('meta_score'),
  sharedPatterns: text('shared_patterns').array().notNull().default([]),
  method: text('method').notNull().default('hybrid'),
  period: text('period').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueNeighborPeriod: uniqueIndex('uq_startup_neighbors').on(table.startupId, table.neighborId, table.period),
}));

// Cohort benchmarks — percentile distributions per cohort per metric
export const cohortBenchmarks = pgTable('cohort_benchmarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  cohortKey: text('cohort_key').notNull(),
  cohortType: text('cohort_type').notNull(),
  region: text('region').notNull().default('global'),
  metric: text('metric').notNull(),
  cohortSize: integer('cohort_size').notNull(),
  p10: real('p10'),
  p25: real('p25'),
  p50: real('p50'),
  p75: real('p75'),
  p90: real('p90'),
  mean: real('mean'),
  stddev: real('stddev'),
  period: text('period').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueCohortMetric: uniqueIndex('uq_cohort_benchmarks').on(table.cohortKey, table.metric, table.period, table.region),
}));

// =============================================================================
// INVESTOR DNA
// =============================================================================

// Investor pattern mix — monthly materialized investor profile
export const investorPatternMix = pgTable('investor_pattern_mix', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: text('scope').notNull().default('global'),
  month: date('month').notNull(),
  investorId: uuid('investor_id').notNull().references(() => investors.id, { onDelete: 'cascade' }),
  dealCount: integer('deal_count').notNull().default(0),
  totalAmountUsd: decimal('total_amount_usd'),
  leadCount: integer('lead_count').notNull().default(0),
  medianCheckUsd: decimal('median_check_usd'),
  patternDealCounts: jsonb('pattern_deal_counts').notNull().default({}),
  patternAmounts: jsonb('pattern_amounts').notNull().default({}),
  stageDealCounts: jsonb('stage_deal_counts').notNull().default({}),
  stageAmounts: jsonb('stage_amounts').notNull().default({}),
  thesisShiftJs: decimal('thesis_shift_js', { precision: 5, scale: 4 }),
  topGainers: jsonb('top_gainers'),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueMix: uniqueIndex('uq_investor_pattern_mix').on(table.scope, table.month, table.investorId),
}));

// Co-invest edges — monthly materialized co-investment graph
export const investorCoInvestEdges = pgTable('investor_co_invest_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: text('scope').notNull().default('global'),
  month: date('month').notNull(),
  investorId: uuid('investor_id').notNull().references(() => investors.id, { onDelete: 'cascade' }),
  partnerInvestorId: uuid('partner_investor_id').notNull().references(() => investors.id, { onDelete: 'cascade' }),
  coDeals: integer('co_deals').notNull().default(0),
  coAmountUsd: decimal('co_amount_usd'),
  sharedPatterns: jsonb('shared_patterns'),
}, (table) => ({
  uniqueEdge: uniqueIndex('uq_co_invest_edges').on(table.scope, table.month, table.investorId, table.partnerInvestorId),
}));

// =============================================================================
// WATCHLIST INTELLIGENCE
// =============================================================================

// User subscriptions — extended subscription targets
export const userSubscriptions = pgTable('user_subscriptions', {
  userId: uuid('user_id').notNull(),
  scope: text('scope').notNull().default('global'),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: uniqueIndex('pk_user_subscriptions').on(table.userId, table.scope, table.objectType, table.objectId),
}));

// User alerts — materialized alerts from delta_events
export const userAlerts = pgTable('user_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  scope: text('scope').notNull().default('global'),
  deltaId: uuid('delta_id').notNull().references(() => deltaEvents.id, { onDelete: 'cascade' }),
  severity: integer('severity').notNull().default(1),
  status: text('status').notNull().default('unread'),
  reason: jsonb('reason').notNull().default({}),
  narrative: jsonb('narrative'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  feedIdx: index('idx_user_alerts_feed').on(table.userId, table.status, table.createdAt),
  deltaIdx: index('idx_user_alerts_delta').on(table.deltaId),
}));

// User digest threads — weekly/monthly digest compilations
export const userDigestThreads = pgTable('user_digest_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  scope: text('scope').notNull().default('global'),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  themes: jsonb('themes').notNull().default([]),
  alertIds: text('alert_ids').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdx: index('idx_user_digest_threads_user').on(table.userId, table.periodEnd),
}));
