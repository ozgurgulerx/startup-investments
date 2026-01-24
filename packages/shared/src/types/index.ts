// =============================================================================
// AI Startup Intelligence Platform - Shared Types
// =============================================================================

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
  confidence: number;
  evidence: string[];
  description?: string;
}

export const BUILD_PATTERNS = [
  'Agentic Architectures',
  'Vertical Data Moats',
  'Micro-model Meshes',
  'Continuous-learning Flywheels',
  'RAG (Retrieval-Augmented Generation)',
  'Knowledge Graphs',
  'Natural-Language-to-Code',
  'Guardrail-as-LLM',
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
  description?: string;
  funding_amount?: number;
  funding_stage?: FundingStage;
  location?: string;
  industries?: string[];

  // GenAI Analysis
  uses_genai: boolean;
  genai_intensity?: GenAIIntensity;
  models_mentioned?: string[];

  // Patterns
  build_patterns: BuildPattern[];

  // Market
  market_type?: MarketType;
  vertical?: Vertical;
  sub_vertical?: string;
  target_market?: TargetMarket;

  // Technical
  tech_stack?: TechStack;
  engineering_quality?: EngineeringQuality;
  technical_depth?: TechnicalDepth;

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
  sources_crawled?: any[];
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
