"""Pydantic data models for startup analysis."""

from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from enum import Enum
import re
from pydantic import BaseModel, Field


class FundingStage(str, Enum):
    """Funding stage classification."""
    PRE_SEED = "pre_seed"
    SEED = "seed"
    SERIES_A = "series_a"
    SERIES_B = "series_b"
    SERIES_C = "series_c"
    SERIES_D_PLUS = "series_d_plus"
    LATE_STAGE = "late_stage"
    UNKNOWN = "unknown"


class GenAIIntensity(str, Enum):
    """How central is GenAI to the product."""
    CORE = "core"           # GenAI is the main product
    ENHANCEMENT = "enhancement"  # GenAI enhances existing product
    TOOLING = "tooling"     # GenAI used internally
    NONE = "none"           # No GenAI detected
    UNCLEAR = "unclear"     # Can't determine


class MarketType(str, Enum):
    """Market orientation."""
    HORIZONTAL = "horizontal"  # Platform/enabler across industries
    VERTICAL = "vertical"      # Industry-specific solution


class Vertical(str, Enum):
    """Industry vertical classification."""
    HEALTHCARE = "healthcare"
    LEGAL = "legal"
    FINANCIAL_SERVICES = "financial_services"
    DEVELOPER_TOOLS = "developer_tools"
    ENTERPRISE_SAAS = "enterprise_saas"
    CONSUMER = "consumer"
    INDUSTRIAL = "industrial"
    EDUCATION = "education"
    MARKETING = "marketing"
    HR_RECRUITING = "hr_recruiting"
    CYBERSECURITY = "cybersecurity"
    ECOMMERCE = "ecommerce"
    MEDIA_CONTENT = "media_content"
    OTHER = "other"


class MoatType(str, Enum):
    """Types of competitive moats."""
    DATA_MOAT = "data_moat"           # Proprietary data, data flywheels
    TECHNICAL_MOAT = "technical_moat"  # Novel algorithms, patents
    DISTRIBUTION_MOAT = "distribution_moat"  # Integrations, partnerships
    NETWORK_MOAT = "network_moat"      # Network effects
    SPEED_MOAT = "speed_moat"          # Time-to-market, execution


class TargetMarket(str, Enum):
    """Target customer segment."""
    B2B = "b2b"
    B2C = "b2c"
    B2B2C = "b2b2c"
    UNKNOWN = "unknown"


class BuildPattern(BaseModel):
    """A detected AI build pattern."""
    name: str
    confidence: float = Field(ge=0, le=1)
    evidence: List[str] = Field(default_factory=list)
    description: Optional[str] = None


class Competitor(BaseModel):
    """A competitor identified for a startup."""
    name: str
    similarity: str = ""  # What they have in common
    how_different: str = ""  # How the startup differs


class Differentiation(BaseModel):
    """How a startup differentiates from competitors."""
    primary: str = ""  # Main differentiator
    technical: str = ""  # Technical differentiators
    business: str = ""  # Business model differentiators
    positioning: str = ""  # Market positioning


class SecretSauce(BaseModel):
    """The startup's unique competitive advantage."""
    core_advantage: str = ""
    defensibility: str = ""
    evidence: List[str] = Field(default_factory=list)


class CompetitiveAnalysis(BaseModel):
    """Complete competitive analysis for a startup."""
    competitors: List[Competitor] = Field(default_factory=list)
    differentiation: Differentiation = Field(default_factory=Differentiation)
    secret_sauce: SecretSauce = Field(default_factory=SecretSauce)
    competitive_moat: str = "unknown"  # low, medium, high
    moat_explanation: str = ""
    moat_types: List[MoatType] = Field(default_factory=list)  # Specific moat categories


class TechStack(BaseModel):
    """Detected technology stack components."""
    llm_providers: List[str] = Field(default_factory=list)  # OpenAI, Anthropic, etc.
    llm_models: List[str] = Field(default_factory=list)     # GPT-4, Claude, Llama, etc.
    vector_databases: List[str] = Field(default_factory=list)  # Pinecone, Weaviate, etc.
    frameworks: List[str] = Field(default_factory=list)     # LangChain, LlamaIndex, etc.
    hosting: List[str] = Field(default_factory=list)        # Azure, AWS, self-hosted
    approach: str = "unknown"  # rag, fine_tuning, hybrid, prompt_engineering
    uses_open_source_models: bool = False
    has_custom_models: bool = False


class EngineeringQuality(BaseModel):
    """Engineering quality and maturity signals."""
    score: int = Field(default=0, ge=0, le=10)  # Overall engineering maturity score
    has_public_api: bool = False
    has_sdk: bool = False
    has_documentation: bool = False
    has_engineering_blog: bool = False
    github_presence: bool = False
    github_stars: int = 0
    github_contributors: int = 0
    open_source_projects: List[str] = Field(default_factory=list)
    signals: List[str] = Field(default_factory=list)  # Specific quality indicators


class StoryAngle(BaseModel):
    """A potential newsletter story angle."""
    angle_type: str  # architecture, data, vertical_expert, contrarian, efficiency
    headline: str    # Compelling one-liner hook
    summary: str     # 2-3 sentence expansion
    evidence: List[str] = Field(default_factory=list)  # Supporting facts
    uniqueness_score: int = Field(default=5, ge=1, le=10)  # How unique/newsworthy


class AntiPattern(BaseModel):
    """Warning signs detected in a startup."""
    pattern_type: str  # wrapper, feature_not_product, no_moat, overclaiming
    description: str
    severity: str = "medium"  # low, medium, high
    evidence: List[str] = Field(default_factory=list)


# =============================================================================
# Enhanced Analysis Models (NEW - for richer briefs)
# =============================================================================

class DiscoveredPattern(BaseModel):
    """A dynamically discovered build pattern with novelty scoring."""
    category: str  # Model Architecture, Compound AI Systems, etc.
    pattern_name: str  # Specific descriptive name
    confidence: float = Field(ge=0, le=1)
    evidence: List[str] = Field(default_factory=list)
    description: str = ""
    novelty_score: int = Field(default=5, ge=1, le=10)
    why_notable: str = ""


class NovelApproach(BaseModel):
    """A unique technical approach not fitting standard patterns."""
    approach: str
    why_novel: str
    potential_impact: str = ""


class FineTuningDetails(BaseModel):
    """Details about model fine-tuning."""
    uses_fine_tuning: bool = False
    fine_tuning_approach: str = ""  # LoRA, full fine-tune, etc.
    training_data_source: str = ""


class ModelRouting(BaseModel):
    """Model routing/orchestration details."""
    uses_routing: bool = False
    routing_strategy: str = ""


class CompoundAIDetails(BaseModel):
    """Compound AI system details."""
    is_compound_system: bool = False
    orchestration_pattern: str = ""


class ModelDetails(BaseModel):
    """Detailed model/LLM usage information."""
    primary_models: List[str] = Field(default_factory=list)
    fine_tuning: FineTuningDetails = Field(default_factory=FineTuningDetails)
    inference_optimization: List[str] = Field(default_factory=list)
    model_routing: ModelRouting = Field(default_factory=ModelRouting)
    compound_ai: CompoundAIDetails = Field(default_factory=CompoundAIDetails)


class FounderInfo(BaseModel):
    """Information about a founder."""
    name: str = ""
    role: str = ""
    background: str = ""
    previous_companies: List[str] = Field(default_factory=list)
    technical_depth: str = "unknown"  # high, medium, low
    domain_expertise: str = ""


class TeamSignals(BaseModel):
    """Team composition signals."""
    engineering_heavy: bool = False
    has_ml_expertise: bool = False
    has_domain_expertise: bool = False
    hiring_signals: List[str] = Field(default_factory=list)
    team_size_indicators: str = "unknown"  # small, medium, large
    remote_distributed: bool = False


class TeamAnalysis(BaseModel):
    """Team and leadership analysis."""
    founders: List[FounderInfo] = Field(default_factory=list)
    team_signals: TeamSignals = Field(default_factory=TeamSignals)
    founder_market_fit: str = ""
    team_strengths: List[str] = Field(default_factory=list)
    team_red_flags: List[str] = Field(default_factory=list)
    team_confidence: float = 0.0


class PricingModel(BaseModel):
    """Pricing model details."""
    type: str = "unknown"  # freemium, enterprise_only, usage_based, subscription, etc.
    pricing_evidence: List[str] = Field(default_factory=list)
    free_tier_available: bool = False
    enterprise_focus: bool = False
    price_points: List[str] = Field(default_factory=list)


class GTMStrategy(BaseModel):
    """Go-to-market strategy details."""
    primary_channel: str = "unknown"  # product_led, sales_led, developer_first, etc.
    evidence: List[str] = Field(default_factory=list)
    target_segment: str = "unknown"  # smb, mid_market, enterprise, consumer
    sales_motion: str = "unknown"  # self_serve, inside_sales, field_sales, hybrid


class RevenueModel(BaseModel):
    """Revenue model details."""
    monetization_approach: str = ""
    unit_economics_signals: List[str] = Field(default_factory=list)
    recurring_revenue: bool = False


class CustomerAcquisition(BaseModel):
    """Customer acquisition signals."""
    acquisition_channels: List[str] = Field(default_factory=list)
    customer_proof_points: List[str] = Field(default_factory=list)


class BusinessModel(BaseModel):
    """Complete business model analysis."""
    pricing_model: PricingModel = Field(default_factory=PricingModel)
    gtm_strategy: GTMStrategy = Field(default_factory=GTMStrategy)
    revenue_model: RevenueModel = Field(default_factory=RevenueModel)
    distribution_advantages: List[str] = Field(default_factory=list)
    customer_acquisition: CustomerAcquisition = Field(default_factory=CustomerAcquisition)
    business_model_clarity: str = "unclear"  # clear, evolving, unclear
    business_model_confidence: float = 0.0


class FeatureDepth(BaseModel):
    """Product feature depth."""
    core_features: List[str] = Field(default_factory=list)
    differentiating_features: List[str] = Field(default_factory=list)
    roadmap_signals: List[str] = Field(default_factory=list)
    feature_completeness: str = "unknown"  # mvp, growing, comprehensive


class IntegrationEcosystem(BaseModel):
    """Integration ecosystem details."""
    integrations_mentioned: List[str] = Field(default_factory=list)
    api_maturity: str = "none"  # none, basic, comprehensive, platform
    sdk_availability: List[str] = Field(default_factory=list)
    webhook_support: bool = False
    marketplace_presence: List[str] = Field(default_factory=list)


class UseCases(BaseModel):
    """Product use cases."""
    primary_use_case: str = ""
    secondary_use_cases: List[str] = Field(default_factory=list)
    customer_stories: List[str] = Field(default_factory=list)
    industry_focus: List[str] = Field(default_factory=list)


class ProductAnalysis(BaseModel):
    """Complete product analysis."""
    product_stage: str = "unknown"  # pre_launch, beta, general_availability, mature
    stage_evidence: List[str] = Field(default_factory=list)
    feature_depth: FeatureDepth = Field(default_factory=FeatureDepth)
    integration_ecosystem: IntegrationEcosystem = Field(default_factory=IntegrationEcosystem)
    use_cases: UseCases = Field(default_factory=UseCases)
    product_risks: List[str] = Field(default_factory=list)
    product_strengths: List[str] = Field(default_factory=list)
    product_confidence: float = 0.0


class CrawledSource(BaseModel):
    """A crawled source with its content."""
    url: str
    source_type: str  # website, blog, docs, github, social
    crawled_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    success: bool = True
    content_length: int = 0
    title: Optional[str] = None
    error: Optional[str] = None


class CrawledDocumentV2(BaseModel):
    """Canonical crawler output schema for downstream indexing/enrichment."""
    url: str
    canonical_url: str
    domain: str
    page_type: str = "generic"
    content_type: str = "html"
    clean_text: str = ""
    clean_markdown: str = ""
    title: Optional[str] = None
    content_hash: Optional[str] = None
    html_hash: Optional[str] = None
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    fetch_method: str = "http"  # http | browser
    status_code: int = 0
    response_time_ms: int = 0
    crawled_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    quality_score: float = 0.0
    error_category: Optional[str] = None
    proxy_tier: str = "none"
    blocked_detected: bool = False
    provider: str = "none"
    capture_id: Optional[str] = None


class StartupInput(BaseModel):
    """Input data for a startup from CSV."""
    name: str
    website: Optional[str] = None
    description: Optional[str] = None
    industries: List[str] = Field(default_factory=list)
    location: Optional[str] = None
    funding_amount: Optional[float] = None
    funding_type: Optional[str] = None
    funding_stage: FundingStage = FundingStage.UNKNOWN
    lead_investors: List[str] = Field(default_factory=list)
    crunchbase_url: Optional[str] = None

    @classmethod
    def from_csv_row(cls, row: Dict[str, Any]) -> "StartupInput":
        """Create from CSV row."""
        # Parse funding amount
        funding_amount = None
        if row.get("Money Raised (in USD)"):
            try:
                funding_amount = float(str(row["Money Raised (in USD)"]).replace(",", ""))
            except ValueError:
                pass

        # Parse industries
        industries = []
        if row.get("Organization Industries"):
            industries = [i.strip() for i in str(row["Organization Industries"]).split(",")]

        # Parse investors
        investors = []
        if row.get("Lead Investors"):
            investors = [i.strip() for i in str(row["Lead Investors"]).split(",")]

        # Determine funding stage
        stage = FundingStage.UNKNOWN
        funding_type = str(row.get("Funding Type", "")).lower()
        if "pre-seed" in funding_type or "pre seed" in funding_type:
            stage = FundingStage.PRE_SEED
        elif "seed" in funding_type:
            stage = FundingStage.SEED
        elif "series a" in funding_type:
            stage = FundingStage.SERIES_A
        elif "series b" in funding_type:
            stage = FundingStage.SERIES_B
        elif "series c" in funding_type:
            stage = FundingStage.SERIES_C
        elif "series d" in funding_type or "series e" in funding_type:
            stage = FundingStage.SERIES_D_PLUS
        elif "late stage" in funding_type:
            stage = FundingStage.LATE_STAGE

        return cls(
            name=re.sub(r'^[^-]+ - ', '', row.get("Transaction Name", "")).strip(),
            website=row.get("Organization Website"),
            description=row.get("Organization Description"),
            industries=industries,
            location=row.get("Organization Location"),
            funding_amount=funding_amount,
            funding_type=row.get("Funding Type"),
            funding_stage=stage,
            lead_investors=investors,
            crunchbase_url=row.get("Transaction Name URL"),
        )


class StartupAnalysis(BaseModel):
    """Complete analysis result for a startup."""
    # Basic info
    company_name: str
    company_slug: str
    website: Optional[str] = None
    logo_url: Optional[str] = None  # URL to company logo (Azure Blob or local)
    description: Optional[str] = None

    # Funding info
    funding_amount: Optional[float] = None
    funding_stage: FundingStage = FundingStage.UNKNOWN

    # GenAI Analysis
    uses_genai: bool = False
    genai_intensity: GenAIIntensity = GenAIIntensity.UNCLEAR
    models_mentioned: List[str] = Field(default_factory=list)

    # Build Patterns (legacy - for backward compatibility)
    build_patterns: List[BuildPattern] = Field(default_factory=list)

    # Discovered Patterns (NEW - dynamic pattern discovery)
    discovered_patterns: List[DiscoveredPattern] = Field(default_factory=list)
    pattern_category_scores: Dict[str, float] = Field(default_factory=dict)
    novel_approaches: List[NovelApproach] = Field(default_factory=list)

    # Model Details (NEW - detailed LLM/model information)
    model_details: ModelDetails = Field(default_factory=ModelDetails)

    # Market Classification
    market_type: MarketType = MarketType.HORIZONTAL
    vertical: Vertical = Vertical.OTHER
    sub_vertical: Optional[str] = None
    target_market: TargetMarket = TargetMarket.UNKNOWN

    # Technical Analysis
    tech_stack: TechStack = Field(default_factory=TechStack)
    engineering_quality: EngineeringQuality = Field(default_factory=EngineeringQuality)
    implementation_maturity: str = "unknown"  # research, prototype, production, scale

    # Business Analysis (NEW)
    team_analysis: TeamAnalysis = Field(default_factory=TeamAnalysis)
    business_model: BusinessModel = Field(default_factory=BusinessModel)
    product_analysis: ProductAnalysis = Field(default_factory=ProductAnalysis)

    # Unique Insights (the high-value findings)
    unique_findings: List[str] = Field(default_factory=list)
    technical_depth: str = "unknown"  # low, medium, high
    newsletter_potential: str = "unknown"  # low, medium, high

    # Story Angles for Newsletter
    story_angles: List[StoryAngle] = Field(default_factory=list)

    # Anti-patterns / Warning Signs
    anti_patterns: List[AntiPattern] = Field(default_factory=list)

    # Competitive Analysis
    competitive_analysis: CompetitiveAnalysis = Field(default_factory=CompetitiveAnalysis)

    # Evidence
    sources_crawled: List[CrawledSource] = Field(default_factory=list)
    evidence_quotes: List[str] = Field(default_factory=list)

    # Metadata
    analyzed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    confidence_score: float = 0.0
    raw_content_analyzed: int = 0  # chars of content processed

    @staticmethod
    def to_slug(name: str) -> str:
        """Convert company name to slug."""
        return name.lower().replace(" ", "-").replace(".", "").replace(",", "")


class BatchInsights(BaseModel):
    """Aggregated insights from analyzing multiple startups."""
    startups_analyzed: int = 0
    analysis_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Pattern aggregations
    pattern_frequency: Dict[str, int] = Field(default_factory=dict)
    emerging_patterns: List[str] = Field(default_factory=list)
    convergent_approaches: List[str] = Field(default_factory=list)
    outlier_techniques: List[str] = Field(default_factory=list)

    # Market insights
    vertical_distribution: Dict[str, int] = Field(default_factory=dict)
    stage_distribution: Dict[str, int] = Field(default_factory=dict)

    # Newsletter-ready insights
    newsletter_ready_insights: List[str] = Field(default_factory=list)
    top_findings: List[Dict[str, Any]] = Field(default_factory=list)


# =============================================================================
# External Intelligence Models
# =============================================================================

class StartupProviderData(BaseModel):
    """Data from startup information providers (Crunchbase, CB Insights, etc.)."""
    source: str  # crunchbase, cbinsights, pitchbook, tracxn, dealroom
    profile_url: Optional[str] = None
    funding_rounds_in_period: List[Dict[str, Any]] = Field(default_factory=list)
    total_funding: Optional[float] = None
    investors: List[str] = Field(default_factory=list)
    competitors_mentioned: List[str] = Field(default_factory=list)
    employee_count: Optional[str] = None
    founded_year: Optional[int] = None
    analyst_mentions: List[str] = Field(default_factory=list)
    market_category: Optional[str] = None
    news_in_period: List[Dict[str, Any]] = Field(default_factory=list)
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TechProgramParticipation(BaseModel):
    """Big tech startup program participation."""
    program_name: str  # Google for Startups, AWS Activate, etc.
    company: str  # Google, Amazon, Microsoft, NVIDIA
    status: str = "unknown"  # member, alumni, portfolio, unknown
    program_url: Optional[str] = None
    benefits: List[str] = Field(default_factory=list)  # credits, support, etc.
    joined_date: Optional[str] = None
    evidence_url: Optional[str] = None
    confidence: float = 0.0  # 0-1 confidence score


class AcceleratorParticipation(BaseModel):
    """Accelerator/incubator participation."""
    accelerator: str  # YC, Techstars, etc.
    batch: Optional[str] = None  # W24, S23, etc.
    program_location: Optional[str] = None
    year: Optional[int] = None
    status: str = "unknown"  # current, alumni, selected, unknown
    demo_day_url: Optional[str] = None
    profile_url: Optional[str] = None
    confidence: float = 0.0  # 0-1 confidence score


class VCResource(BaseModel):
    """Curated VC content/resources."""
    vc_firm: str  # Sequoia, a16z, etc.
    resource_type: str  # youtube, blog, podcast, essay
    title: str
    url: str
    relevance_topic: str  # What topic this covers
    publish_date: Optional[str] = None
    description: Optional[str] = None
    relevance_score: float = 0.0  # How relevant to the startup


class StartupIntelligence(BaseModel):
    """Aggregated external intelligence for a startup."""
    company_name: str
    period: str  # e.g., "2026-01"
    period_start: str
    period_end: str
    provider_data: List[StartupProviderData] = Field(default_factory=list)
    tech_programs: List[TechProgramParticipation] = Field(default_factory=list)
    accelerators: List[AcceleratorParticipation] = Field(default_factory=list)
    vc_resources: List[VCResource] = Field(default_factory=list)
    intelligence_score: float = 0.0  # 0-1 credibility score
    last_collected: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
