// =============================================================================
// AI Startup Intelligence Platform - Shared Types
// =============================================================================

export type {
  BriefSnapshotMetrics,
  BriefSnapshotDeltas,
  BriefVerticalLandscape,
  BriefCapitalGraphPulse,
  BriefNewsContext,
  SignalRef,
  BuilderAction,
  BuilderActionRef,
  BriefSnapshot,
  BriefSnapshotSummary,
  BriefEditionSummary,
} from './brief-snapshot';

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

export type GenAIIntensity = 'core' | 'enhancement' | 'tooling' | 'none' | 'unclear';
export type MarketType = 'horizontal' | 'vertical';
export type TargetMarket = 'b2b' | 'b2c' | 'b2b2c';
export type NewsletterPotential = 'high' | 'medium' | 'low';
export type MoatDurability = 'strong' | 'medium' | 'weak';
export type TechnicalDepth = 'high' | 'medium' | 'low' | 'unknown';

export type FundingStage =
  | 'pre_seed'
  | 'seed'
  | 'series_a'
  | 'series_b'
  | 'series_c'
  | 'series_d_plus'
  | 'late_stage'
  | 'growth'
  | 'unknown';

export type Vertical =
  | 'healthcare'
  | 'financial_services'
  | 'legal'
  | 'ecommerce'
  | 'enterprise_saas'
  | 'developer_tools'
  | 'marketing'
  | 'hr_recruiting'
  | 'education'
  | 'media_content'
  | 'cybersecurity'
  | 'industrial'
  | 'consumer'
  | 'other';

// -----------------------------------------------------------------------------
// Build Patterns
// -----------------------------------------------------------------------------

export interface BuildPattern {
  name: string;
  pattern_name?: string;
  confidence: number;
  evidence: string[];
  description?: string;
  novelty_score?: number;
  why_notable?: string;
  category?: string;
}

// Pattern categories for dynamic discovery
export const BUILD_PATTERN_CATEGORIES = [
  'Model Architecture',
  'Compound AI Systems',
  'Retrieval & Knowledge',
  'Evaluation & Quality',
  'Operations & Infrastructure',
  'Safety & Trust',
  'Learning & Improvement',
  'Data Strategy',
] as const;

export type BuildPatternCategory = (typeof BUILD_PATTERN_CATEGORIES)[number];

// Canonical patterns (legacy + new)
export const BUILD_PATTERNS = [
  // Legacy patterns (for backward compatibility)
  'Agentic Architectures',
  'Vertical Data Moats',
  'Micro-model Meshes',
  'Continuous-learning Flywheels',
  'RAG (Retrieval-Augmented Generation)',
  'Knowledge Graphs',
  'Natural-Language-to-Code',
  'Guardrail-as-LLM',
  // New patterns
  'Fine-tuned Models',
  'Compound AI Systems',
  'EvalOps',
  'LLMOps',
  'LLM Security',
  'Inference Optimization',
  'Data Flywheels',
  'Model Routing',
  'Prompt Engineering',
  'Hybrid Search',
  'Active Learning',
  'Synthetic Data Generation',
] as const;

export type BuildPatternName = (typeof BUILD_PATTERNS)[number];

// -----------------------------------------------------------------------------
// Startup Analysis
// -----------------------------------------------------------------------------

export interface TechStack {
  llm_providers?: string[];
  llm_models?: string[];
  vector_databases?: string[];
  frameworks?: string[];
  hosting?: string[];
  approach?: string;
  uses_open_source_models?: boolean;
  has_custom_models?: boolean;
}

// -----------------------------------------------------------------------------
// Enhanced Analysis Fields (NEW)
// -----------------------------------------------------------------------------

export interface FounderInfo {
  name?: string;
  role?: string;
  background?: string;
  previous_companies?: string[];
  technical_depth?: TechnicalDepth;
  domain_expertise?: string;
}

export interface TeamSignals {
  engineering_heavy?: boolean;
  has_ml_expertise?: boolean;
  has_domain_expertise?: boolean;
  hiring_signals?: string[];
  team_size_indicators?: 'small' | 'medium' | 'large';
  remote_distributed?: boolean;
}

export interface TeamAnalysis {
  founders: FounderInfo[];
  team_signals: TeamSignals;
  founder_market_fit?: string;
  team_strengths: string[];
  team_red_flags: string[];
  team_confidence?: number;
}

export interface FounderEntity {
  id: string;
  full_name: string;
  slug?: string | null;
  linkedin_url?: string | null;
  x_url?: string | null;
  website?: string | null;
  bio?: string | null;
  primary_country?: string | null;
  source?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface InvestorAlias {
  id?: string;
  investor_id?: string;
  alias: string;
  alias_type?: string;
  source?: string;
  confidence?: number | null;
  created_at?: string;
}

export interface StartupFounderLink {
  founder_id: string;
  role?: string | null;
  is_current?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  ownership_pct?: number | null;
  confidence?: number | null;
  source?: string | null;
}

export interface PricingModel {
  type?: 'freemium' | 'enterprise_only' | 'usage_based' | 'subscription' | 'marketplace' | 'api_pricing' | 'custom' | 'unknown';
  pricing_evidence?: string[];
  free_tier_available?: boolean;
  enterprise_focus?: boolean;
  price_points?: string[];
}

export interface GTMStrategy {
  primary_channel?: 'product_led' | 'sales_led' | 'partnership_led' | 'developer_first' | 'content_marketing' | 'unknown';
  evidence?: string[];
  target_segment?: 'smb' | 'mid_market' | 'enterprise' | 'consumer' | 'developer' | 'unknown';
  sales_motion?: 'self_serve' | 'inside_sales' | 'field_sales' | 'hybrid' | 'unknown';
}

export interface RevenueModel {
  monetization_approach?: string;
  unit_economics_signals?: string[];
  recurring_revenue?: boolean;
}

export interface BusinessModel {
  pricing_model: PricingModel;
  gtm_strategy: GTMStrategy;
  revenue_model?: RevenueModel;
  distribution_advantages: string[];
  customer_acquisition?: {
    acquisition_channels?: string[];
    customer_proof_points?: string[];
  };
  business_model_clarity?: 'clear' | 'evolving' | 'unclear';
  business_model_confidence?: number;
}

export interface FeatureDepth {
  core_features: string[];
  differentiating_features: string[];
  roadmap_signals?: string[];
  feature_completeness?: 'mvp' | 'growing' | 'comprehensive';
}

export interface IntegrationEcosystem {
  integrations_mentioned: string[];
  api_maturity?: 'none' | 'basic' | 'comprehensive' | 'platform';
  sdk_availability?: string[];
  webhook_support?: boolean;
  marketplace_presence?: string[];
}

export interface UseCases {
  primary_use_case?: string;
  secondary_use_cases?: string[];
  customer_stories?: string[];
  industry_focus?: string[];
}

export interface ProductAnalysis {
  product_stage?: 'pre_launch' | 'beta' | 'general_availability' | 'mature' | 'unknown';
  stage_evidence?: string[];
  feature_depth?: FeatureDepth;
  integration_ecosystem?: IntegrationEcosystem;
  use_cases?: UseCases;
  product_risks: string[];
  product_strengths: string[];
  product_confidence?: number;
}

export interface FineTuningDetails {
  uses_fine_tuning: boolean;
  fine_tuning_approach?: string;
  training_data_source?: string;
}

export interface ModelRouting {
  uses_routing: boolean;
  routing_strategy?: string;
}

export interface CompoundAI {
  is_compound_system: boolean;
  orchestration_pattern?: string;
}

export interface ModelDetails {
  primary_models: string[];
  fine_tuning?: FineTuningDetails;
  inference_optimization: string[];
  model_routing?: ModelRouting;
  compound_ai?: CompoundAI;
}

export interface NovelApproach {
  approach: string;
  why_novel: string;
  potential_impact?: string;
}

export interface EngineeringQuality {
  score: number;
  has_public_api: boolean;
  github_presence: boolean;
  github_stars?: number;
}

export interface Competitor {
  name: string;
  description?: string;
  similarity?: string;
  how_different?: string;
  similarity_score?: number;
}

export interface SecretSauce {
  core_advantage?: string;
  defensibility?: string;
  evidence?: string[];
}

export interface Differentiation {
  primary?: string;
  technical?: string;
  business?: string;
  positioning?: string;
}

export interface CompetitiveAnalysis {
  competitors?: Competitor[];
  differentiation?: string | Differentiation;
  secret_sauce?: string | SecretSauce;
  moat_assessment?: MoatDurability;
  competitive_moat?: string;
  moat_explanation?: string;
  moat_types?: string[];
}

export interface StoryAngle {
  angle_type: string;
  headline: string;
  summary: string;
  evidence?: string[];
  uniqueness_score: number;
}

export interface AntiPattern {
  pattern_type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  evidence?: string[];
}

export interface ContrarianAnalysis {
  bull_case_flaw: string;
  elephant_in_room: string;
  timing_assessment: {
    verdict: 'too_early' | 'too_late' | 'right_now';
    reasoning: string;
  };
  incumbent_threat: {
    most_dangerous_competitor: string;
    killer_feature: string;
    time_to_threat: string;
  };
  hidden_assumptions: string[];
  moat_reality: {
    claimed_moat: string;
    actual_moat: string;
    moat_durability: MoatDurability;
  };
  honest_take: string;
}

export interface ViralHooks {
  headlines: {
    style: string;
    headline: string;
    subheadline: string;
    hook_strength: number;
  }[];
  best_headline: string;
  social_media_version: string;
}

export interface BuilderTakeaway {
  category: 'architecture' | 'cost' | 'product' | 'org' | 'go-to-market';
  title: string;
  insight: string;
  how_to_apply: string;
  when_not_to_use?: string;
  example?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  impact: 'high' | 'medium' | 'low';
}

export interface StartupAnalysis {
  company_name: string;
  company_slug: string;
  website?: string;
  logo_url?: string;
  description?: string;
  funding_amount?: number;
  funding_stage?: FundingStage;
  location?: string;
  industries?: string[];

  // GenAI Analysis
  uses_genai: boolean;
  genai_intensity?: GenAIIntensity;
  models_mentioned?: string[];

  // Patterns (legacy field)
  build_patterns: BuildPattern[];

  // Discovered Patterns (NEW - dynamic pattern discovery)
  discovered_patterns?: BuildPattern[];
  pattern_category_scores?: Record<BuildPatternCategory, number>;
  novel_approaches?: NovelApproach[];

  // Model Details (NEW - detailed model/LLM information)
  model_details?: ModelDetails;

  // Market
  market_type?: MarketType;
  vertical?: Vertical;
  sub_vertical?: string;
  sub_sub_vertical?: string;
  /**
   * Flexible, versioned vertical taxonomy (supports arbitrary depth).
   * Stored in DB under startups.analysis_data.vertical_taxonomy.
   */
  vertical_taxonomy?: {
    ontology_id?: string;
    ontology_version?: string;
    primary?: {
      vertical_id?: string | null;
      vertical_label?: string | null;
      sub_vertical_id?: string | null;
      sub_vertical_label?: string | null;
      leaf_id?: string | null;
      leaf_label?: string | null;
    };
    path?: Array<{
      id: string;
      label: string;
      confidence?: number;
    }>;
  };
  target_market?: TargetMarket;

  // Technical
  tech_stack?: TechStack;
  engineering_quality?: EngineeringQuality;
  technical_depth?: TechnicalDepth;
  implementation_maturity?: 'research' | 'prototype' | 'production' | 'scale';

  // Business Analysis (NEW)
  team_analysis?: TeamAnalysis;
  business_model?: BusinessModel;
  product_analysis?: ProductAnalysis;

  // Competitive
  competitive_analysis?: CompetitiveAnalysis;

  // Newsletter
  newsletter_potential?: NewsletterPotential;
  story_angles?: StoryAngle[];
  unique_findings?: string[];
  anti_patterns?: AntiPattern[];
  evidence_quotes?: string[];

  // Viral Analysis (if available)
  contrarian_analysis?: ContrarianAnalysis;
  viral_hooks?: ViralHooks;
  builder_takeaways?: BuilderTakeaway[];

  // Metadata
  analyzed_at?: string;
  confidence_score?: number;
  raw_content_analyzed?: number;
  sources_crawled?: number;
}

// -----------------------------------------------------------------------------
// Monthly Statistics
// -----------------------------------------------------------------------------

export interface FundingBucket {
  count: number;
  total_usd: number;
  avg_usd: number;
}

export interface DealSummary {
  total_deals: number;
  deals_with_funding: number;
  total_funding_usd: number;
  average_deal_size: number;
  median_deal_size: number;
  min_deal_size: number;
  max_deal_size: number;
}

export interface TopDeal {
  name: string;
  funding_usd: number;
  stage: string;
  location: string;
  website: string;
}

export interface TopInvestor {
  name: string;
  deal_count: number;
  total_invested: number;
  avg_investment: number;
}

export interface HighPotentialStartup {
  name: string;
  vertical: Vertical;
  patterns: string[];
}

export interface GenAIAnalysisSummary {
  total_analyzed: number;
  uses_genai_count: number;
  genai_adoption_rate: number;
  intensity_distribution: Record<GenAIIntensity, number>;
  pattern_distribution: Record<string, number>;
  newsletter_potential: Record<NewsletterPotential, number>;
  vertical_distribution: Record<Vertical, number>;
  market_type_distribution: Record<MarketType, number>;
  target_market_distribution: Record<TargetMarket, number>;
  technical_depth_distribution: Record<TechnicalDepth, number>;
  high_potential_startups: HighPotentialStartup[];
}

export interface MonthlyStats {
  period: string;
  generated_at: string;
  deal_summary: DealSummary;
  funding_by_stage: Record<FundingStage, FundingBucket>;
  funding_by_type: Record<string, FundingBucket>;
  funding_by_vertical: Record<string, FundingBucket>;
  funding_by_continent: Record<string, FundingBucket>;
  funding_by_country: Record<string, FundingBucket>;
  funding_by_city: Record<string, FundingBucket>;
  funding_by_us_state?: Record<string, FundingBucket>;
  top_deals: TopDeal[];
  top_investors: TopInvestor[];
  genai_analysis: GenAIAnalysisSummary;
}

// -----------------------------------------------------------------------------
// Newsletter Data
// -----------------------------------------------------------------------------

export interface NewsletterTheme {
  title: string;
  description: string;
  patterns: {
    name: string;
    prevalence: 'High' | 'Medium' | 'Low' | 'Growing';
    meaning: string;
  }[];
}

export interface NewsletterStory {
  company: string;
  viral_hooks?: ViralHooks;
  contrarian?: ContrarianAnalysis;
  story_arc?: {
    narrative_arc: {
      hook: {
        opening_line: string;
        stakes: string;
        why_now: string;
      };
      discovery: {
        surface_story: string;
        deeper_story: string;
        surprise: string;
      };
      analysis: {
        technical_insight: string;
        competitive_insight: string;
        tension: string;
      };
      resolution: {
        takeaway: string;
        prediction: string;
        call_to_action: string;
      };
    };
    estimated_read_time: string;
    target_word_count: number;
    suggested_visuals: string[];
  };
}

export interface NewsletterData {
  generated_at: string;
  theme: NewsletterTheme;
  stories: NewsletterStory[];
}

// -----------------------------------------------------------------------------
// Trend Data (cross-month)
// -----------------------------------------------------------------------------

export interface PatternTrend {
  pattern: string;
  data: {
    period: string;
    count: number;
    percentage: number;
  }[];
  trend: 'growing' | 'stable' | 'declining';
  change_percentage: number;
}

export interface FundingTrend {
  period: string;
  total_funding: number;
  deal_count: number;
  avg_deal_size: number;
  median_deal_size: number;
}

export interface TrendData {
  patterns: PatternTrend[];
  funding: FundingTrend[];
  periods_available: string[];
}

// -----------------------------------------------------------------------------
// API Response Types
// -----------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T;
  meta?: {
    period?: string;
    generated_at?: string;
    count?: number;
  };
}

export interface PeriodInfo {
  period: string;
  deal_count: number;
  total_funding: number;
  has_newsletter: boolean;
}

export interface PeriodsResponse {
  periods: PeriodInfo[];
  current: string;
}

export interface GraphNode {
  id: string;
  type: 'investor' | 'startup' | 'founder' | 'funding_round';
  name: string;
  slug?: string;
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  src_id: string;
  dst_id: string;
  edge_type: string;
  meta?: Record<string, unknown>;
}

export interface InvestorNetworkResponse {
  investor_id: string;
  scope: 'global' | 'turkey';
  depth: number;
  graph_extension: {
    enabled: boolean;
    name: string;
    available: boolean;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface StartupInvestorsResponse {
  startup_id: string;
  scope: 'global' | 'turkey';
  source: 'capital_graph_edges' | 'legacy_investments';
  total: number;
  investors: Array<{
    investor_id: string;
    name: string;
    type?: string | null;
    relationship_type: string;
    is_lead: boolean;
    amount_usd?: number | null;
    round_type?: string | null;
    announced_date?: string | null;
  }>;
}

// -----------------------------------------------------------------------------
// Daily News Types
// -----------------------------------------------------------------------------

export interface NewsSourceRef {
  name: string;
  key: string;
}

export type ImpactFrame =
  | 'UNDERWRITING_TAKE' | 'ADOPTION_PLAY' | 'COST_CURVE' | 'LATENCY_LEVER'
  | 'BENCHMARK_TRAP' | 'DATA_MOAT' | 'PROCUREMENT_WEDGE' | 'REGULATORY_CONSTRAINT'
  | 'ATTACK_SURFACE' | 'CONSOLIDATION_SIGNAL' | 'HIRING_SIGNAL'
  | 'PLATFORM_SHIFT' | 'GO_TO_MARKET_EDGE' | 'EARLY_SIGNAL';

export interface ImpactObject {
  frame: ImpactFrame;
  kicker: string;
  builder_move: string;
  investor_angle: string;
  watchout?: string;
  validation?: string;
}

export interface EvidenceItem {
  publisher: string;
  url: string;
  canonical_url?: string;
  published_at?: string;
  fetched_at?: string;
  paywalled?: boolean;
  author?: string;
}

export interface NewsItemCard {
  id: string;
  /** Canonical Evidence Object id (news_cluster evidence). */
  evidence_id?: string;
  title: string;
  summary: string;
  image_url?: string;
  url: string;
  canonical_url?: string;
  published_at: string;
  story_type: string;
  topic_tags: string[];
  entities: string[];
  rank_score: number;
  rank_reason: string;
  trust_score: number;
  source_count: number;
  primary_source: string;
  sources: string[];
  builder_takeaway?: string;
  builder_takeaway_is_llm?: boolean;
  impact?: ImpactObject;
  llm_summary?: string;
  llm_model?: string;
  llm_signal_score?: number;
  llm_confidence_score?: number;
  llm_topic_tags?: string[];
  llm_story_type?: string;
  upvote_count?: number;
  entity_links?: Array<{ entity_name: string; startup_slug: string | null; match_score: number }>;
  primary_company_slug?: string | null;
  delta_type?: string;
  ba_title?: string;
  ba_bullets?: string[];
  why_it_matters?: string;
  evidence?: EvidenceItem[];
}

// -----------------------------------------------------------------------------
// Canonical Evidence + Event Contracts
// -----------------------------------------------------------------------------

export type EvidenceObjectType =
  | 'news_cluster' | 'news_item' | 'page_snapshot' | 'page_diff'
  | 'github_release' | 'job_post' | 'manual';

export interface EvidenceObjectMember {
  member_evidence_id: string;
  is_primary: boolean;
}

export interface EvidenceObject {
  evidence_id: string;
  evidence_type: EvidenceObjectType;
  uri: string;
  captured_at: string;
  source_weight: number;
  language: string;
  content_ref?: string | null;
  hash: string;
  canonicalization_version: number;
  provenance_json?: Record<string, any>;
  members?: EvidenceObjectMember[];
}

export interface EventObject {
  id: string;
  event_type: string;
  effective_date: string;
  detected_at: string;
  confidence: number;
  evidence_ids: string[];
  actor_entity_id?: string | null;
  target_entity_id?: string | null;
  event_features_json?: Record<string, any>;
  event_features_version?: number;
}

export type SignalActionType = 'upvote' | 'save' | 'hide' | 'not_useful';

export interface DailyNewsBrief {
  headline: string;
  summary: string;
  bullets: string[];
  themes?: string[];
  model?: string;
  generated_at?: string;
  cluster_count?: number;
}

export interface NewsEdition {
  edition_date: string;
  generated_at: string;
  items: NewsItemCard[];
  brief?: DailyNewsBrief;
  stats: {
    total_clusters: number;
    top_story_count: number;
    story_type_counts: Record<string, number>;
    topic_counts: Record<string, number>;
    updated_at: string;
  };
}

export interface NewsTopicStat {
  topic: string;
  count: number;
}

export interface NewsArchiveDay {
  edition_date: string;
  generated_at: string;
  total_clusters: number;
  top_story_count: number;
  brief_headline?: string;
  top_topics?: string[];
  story_type_counts?: Record<string, number>;
}

// Search Results
// -----------------------------------------------------------------------------

export interface NewsSearchResult {
  id: string;
  title: string;
  summary: string;
  story_type: string;
  topic_tags: string[];
  entities: string[];
  published_at: string;
  similarity: number;
  primary_url?: string;
  primary_source?: string;
  image_url?: string;
}

// Periodic Briefs (Weekly / Monthly)
// -----------------------------------------------------------------------------

export interface PeriodicBriefNarrative {
  executive_summary?: string;
  trend_analysis?: string;
  builder_lessons?: string;
  outlook?: string;
}

export interface PeriodicBriefStats {
  total_stories: number;
  top_stories: Array<{ title: string; story_type: string; rank_score: number; cluster_id?: string }>;
  top_topics: Array<{ topic: string; count: number }>;
  story_types: Record<string, number>;
  funding_total_usd?: number;
  new_entities_count?: number;
  weekly_breakdown?: Array<{ week_start: string; story_count: number }>;
}

export interface PeriodicBrief {
  id: string;
  region: 'global' | 'turkey';
  period_type: 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  title: string | null;
  stats: PeriodicBriefStats;
  narrative: PeriodicBriefNarrative;
  top_entity_names: string[];
  story_count: number;
  status: string;
  generated_at: string;
}

export interface PeriodicBriefSummary {
  id: string;
  period_type: 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  title: string | null;
  story_count: number;
  generated_at: string;
}
