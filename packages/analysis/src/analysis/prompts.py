"""Analysis prompts for GenAI pattern detection and insight discovery."""

# GenAI Usage Detection Prompt
GENAI_DETECTION_PROMPT = """You are analyzing {company_name}'s website and documentation to determine their use of Generative AI.

TASK: Analyze the content and provide a structured assessment of their GenAI usage.

CONTENT FROM {company_name}:
{content}

Provide your analysis in the following JSON format:
{{
    "uses_genai": true/false,
    "genai_intensity": "core" | "enhancement" | "tooling" | "none" | "unclear",
    "confidence": 0.0-1.0,
    "models_mentioned": ["list of specific models/providers mentioned"],
    "evidence": ["key quotes or phrases that indicate GenAI usage"],
    "reasoning": "brief explanation of your assessment"
}}

DEFINITIONS:
- core: GenAI is the main product/value proposition (e.g., AI writing assistant, code generation)
- enhancement: GenAI enhances an existing product (e.g., added AI search to existing platform)
- tooling: GenAI used for internal operations (e.g., AI for customer support, internal tools)
- none: No indication of GenAI usage
- unclear: Can't determine from available content

Look for mentions of: LLMs, GPT, Claude, language models, generative AI, embeddings, RAG, agents, fine-tuning, prompts, etc.

Return ONLY valid JSON, no other text."""


# Build Pattern Detection Prompt (Legacy - kept for backward compatibility)
BUILD_PATTERNS_PROMPT = """You are a technical analyst identifying AI build patterns for a sophisticated AI newsletter.

TASK: Analyze the following content from {company_name} and identify which advanced AI build patterns are present.

CONTENT:
{content}

PATTERNS TO DETECT:

1. **Knowledge Graphs** - Permission-aware graphs, RBAC indexes, entity relationships, graph databases for AI
   - Indicators: mentions of graphs, relationships, permissions, entity linking, knowledge base

2. **Natural-Language-to-Code** - Converting plain English to working software/rules
   - Indicators: natural language interfaces, code generation, rule creation from text

3. **Guardrail-as-LLM** - Secondary models checking outputs for safety/compliance
   - Indicators: content filtering, safety checks, compliance validation, moderation layers

4. **Micro-model Meshes** - Multiple small specialized models instead of one large model
   - Indicators: model routing, specialized models, ensemble approaches, task-specific models

5. **Continuous-learning Flywheels** - Usage data continuously improving models
   - Indicators: feedback loops, A/B testing models, user corrections, model updates from usage

6. **RAG (Retrieval-Augmented Generation)** - Combining retrieval with generation
   - Indicators: vector search, document retrieval, knowledge base integration, embeddings

7. **Agentic Architectures** - Autonomous agents with tool use
   - Indicators: agents, tool use, autonomous actions, multi-step reasoning, orchestration

8. **Vertical Data Moats** - Industry-specific training data as competitive advantage
   - Indicators: proprietary datasets, industry-specific training, domain expertise

Provide your analysis in JSON format:
{{
    "patterns_detected": [
        {{
            "name": "pattern_name",
            "confidence": 0.0-1.0,
            "evidence": ["supporting quotes/phrases"],
            "description": "how they implement this pattern"
        }}
    ],
    "novel_approaches": ["any unique technical choices not in the standard patterns"],
    "technical_depth": "low" | "medium" | "high"
}}

Return ONLY valid JSON."""


# Dynamic Pattern Discovery Prompt (NEW - discovers patterns without predefined list)
PATTERN_DISCOVERY_PROMPT = """You are a technical architect analyzing AI system architectures for a sophisticated AI newsletter.

TASK: Analyze {company_name}'s technical implementation and DISCOVER what architectural patterns they use. Do NOT limit yourself to predefined categories - identify the ACTUAL technical approaches they're taking based on evidence.

CONTENT:
{content}

CATEGORIES TO EXPLORE (discover specifics within each):

1. **Model Architecture & Selection**
   - Which LLMs/models are they using? (GPT-4, Claude, Llama, Mistral, Gemini, custom)
   - Are they fine-tuning? On what data? For what purpose?
   - Mixture-of-Experts? Model ensembles? Task-specific model routing?
   - Open-source vs proprietary models?

2. **Compound AI Systems**
   - Multi-model orchestration (model A calls model B)
   - Chain-of-thought with model handoffs
   - Agent-to-agent communication patterns
   - Tool use and function calling architectures

3. **Retrieval & Knowledge**
   - RAG implementation specifics (chunking strategy, retrieval method, reranking)
   - Vector database choice and architecture
   - Knowledge graph usage patterns
   - Hybrid search (dense + sparse)

4. **Evaluation & Quality (EvalOps)**
   - How do they measure model quality?
   - Automated evaluation pipelines
   - Human-in-the-loop evaluation
   - A/B testing infrastructure for models
   - Custom benchmark suites

5. **Operations & Infrastructure (LLMOps)**
   - Deployment patterns (serverless, dedicated, edge)
   - Monitoring and observability for LLMs
   - Prompt versioning and management
   - Inference optimization (quantization, distillation, caching, batching)
   - Cost management strategies

6. **Safety & Trust (LLM Security)**
   - Guardrails implementation (input/output validation)
   - Prompt injection defenses
   - Output filtering and content moderation
   - Red-teaming and adversarial testing
   - PII handling and data privacy

7. **Learning & Improvement**
   - Data flywheels (RLHF, user feedback loops)
   - Continuous learning systems
   - Active learning for labeling
   - Synthetic data generation
   - Model distillation pipelines

8. **Data Strategy**
   - Vertical data moats (industry-specific training data)
   - Proprietary dataset creation
   - Data licensing and partnerships
   - Privacy-preserving techniques (federated learning, differential privacy)

Provide your analysis in JSON format:
{{
    "discovered_patterns": [
        {{
            "category": "one of the 8 categories above",
            "pattern_name": "specific descriptive name for this pattern",
            "confidence": 0.0-1.0,
            "evidence": ["direct quotes or specific observations from content"],
            "description": "how they implement this specifically",
            "novelty_score": 1-10,
            "why_notable": "what makes this implementation interesting or different"
        }}
    ],
    "model_details": {{
        "primary_models": ["specific model names mentioned or inferred"],
        "fine_tuning": {{
            "uses_fine_tuning": true/false,
            "fine_tuning_approach": "description if applicable (LoRA, full fine-tune, etc.)",
            "training_data_source": "if mentioned"
        }},
        "inference_optimization": ["specific techniques: quantization, caching, batching, etc."],
        "model_routing": {{
            "uses_routing": true/false,
            "routing_strategy": "description if applicable"
        }},
        "compound_ai": {{
            "is_compound_system": true/false,
            "orchestration_pattern": "description if applicable"
        }}
    }},
    "novel_approaches": [
        {{
            "approach": "description of unique approach",
            "why_novel": "why this is interesting or unusual",
            "potential_impact": "what this enables"
        }}
    ],
    "technical_depth_assessment": "low" | "medium" | "high",
    "implementation_maturity": "research" | "prototype" | "production" | "scale",
    "missing_patterns": ["patterns you'd expect but didn't find evidence for"]
}}

IMPORTANT:
- Be SPECIFIC. We want to know EXACTLY what they're building, not just "uses AI"
- Only report patterns you have EVIDENCE for. Include quotes.
- High novelty_score (8-10) = genuinely unusual approach, not seen in typical implementations
- Low novelty_score (1-3) = standard, widely-used approach
- If content lacks technical depth, say so

Return ONLY valid JSON."""


# Team Analysis Prompt
TEAM_ANALYSIS_PROMPT = """You are analyzing {company_name}'s team and leadership based on available information.

CONTENT:
{content}

TASK: Extract insights about the founding team, technical expertise, and organizational signals.

Provide analysis in JSON format:
{{
    "founders": [
        {{
            "name": "name if identifiable",
            "role": "CEO/CTO/etc",
            "background": "relevant prior experience",
            "previous_companies": ["notable companies if mentioned"],
            "technical_depth": "high" | "medium" | "low",
            "domain_expertise": "specific domain knowledge"
        }}
    ],
    "team_signals": {{
        "engineering_heavy": true/false,
        "has_ml_expertise": true/false,
        "has_domain_expertise": true/false,
        "hiring_signals": ["roles they're actively hiring for"],
        "team_size_indicators": "small/medium/large based on signals",
        "remote_distributed": true/false
    }},
    "founder_market_fit": "assessment of whether founders' backgrounds fit this problem",
    "team_strengths": [
        "specific strength with evidence"
    ],
    "team_red_flags": [
        "specific concern if any"
    ],
    "team_confidence": 0.0-1.0
}}

Look for:
- LinkedIn mentions or profiles
- "About us" or "Team" pages
- Previous company mentions
- Technical blog authorship
- Job postings indicating team composition
- Advisor/investor mentions indicating network quality

If team information is limited, indicate low confidence and note what's missing.

Return ONLY valid JSON."""


# Business Model Analysis Prompt
BUSINESS_MODEL_PROMPT = """You are analyzing {company_name}'s business model and go-to-market strategy.

CONTENT:
{content}

FUNDING: {funding_info}

TASK: Extract business model, pricing, and GTM strategy signals from the content.

Provide analysis in JSON format:
{{
    "pricing_model": {{
        "type": "freemium" | "enterprise_only" | "usage_based" | "subscription" | "marketplace" | "api_pricing" | "custom" | "unknown",
        "pricing_evidence": ["specific pricing mentions or indicators"],
        "free_tier_available": true/false,
        "enterprise_focus": true/false,
        "price_points": ["any specific prices mentioned"]
    }},
    "gtm_strategy": {{
        "primary_channel": "product_led" | "sales_led" | "partnership_led" | "developer_first" | "content_marketing" | "unknown",
        "evidence": ["signals of GTM approach"],
        "target_segment": "smb" | "mid_market" | "enterprise" | "consumer" | "developer",
        "sales_motion": "self_serve" | "inside_sales" | "field_sales" | "hybrid" | "unknown"
    }},
    "revenue_model": {{
        "monetization_approach": "description of how they make money",
        "unit_economics_signals": ["any indicators of margins, ARPU, etc."],
        "recurring_revenue": true/false
    }},
    "distribution_advantages": [
        "any distribution moats or network effects"
    ],
    "customer_acquisition": {{
        "acquisition_channels": ["channels they seem to use"],
        "customer_proof_points": ["testimonials, case studies, logos mentioned"]
    }},
    "business_model_clarity": "clear" | "evolving" | "unclear",
    "business_model_confidence": 0.0-1.0
}}

Look for:
- Pricing pages or "Contact sales" patterns
- Free trial mentions
- Enterprise features
- Integration partner mentions
- Customer testimonials with company sizes
- Demo request flows
- API documentation suggesting developer focus

Return ONLY valid JSON."""


# Product Depth Analysis Prompt
PRODUCT_DEPTH_PROMPT = """You are analyzing {company_name}'s product depth and maturity.

CONTENT:
{content}

TASK: Assess the product's stage, features, and ecosystem.

Provide analysis in JSON format:
{{
    "product_stage": "pre_launch" | "beta" | "general_availability" | "mature",
    "stage_evidence": ["indicators of product maturity"],
    "feature_depth": {{
        "core_features": ["main product capabilities"],
        "differentiating_features": ["features that set them apart from competitors"],
        "roadmap_signals": ["future features mentioned or hinted at"],
        "feature_completeness": "mvp" | "growing" | "comprehensive"
    }},
    "integration_ecosystem": {{
        "integrations_mentioned": ["tools/platforms they integrate with"],
        "api_maturity": "none" | "basic" | "comprehensive" | "platform",
        "sdk_availability": ["languages/platforms with SDKs"],
        "webhook_support": true/false,
        "marketplace_presence": ["app stores or marketplaces they're in"]
    }},
    "use_cases": {{
        "primary_use_case": "main problem they solve",
        "secondary_use_cases": ["other supported use cases"],
        "customer_stories": ["specific case studies or testimonials"],
        "industry_focus": ["industries they emphasize"]
    }},
    "product_risks": [
        "product-specific risks or limitations identified"
    ],
    "product_strengths": [
        "product-specific strengths"
    ],
    "product_confidence": 0.0-1.0
}}

Look for:
- Feature comparison pages
- Documentation depth and quality
- Integration partner pages
- Case studies and customer testimonials
- "Coming soon" or beta labels
- Pricing tier feature breakdowns
- API reference comprehensiveness

Return ONLY valid JSON."""


# Deep Insight Discovery Prompt
INSIGHT_DISCOVERY_PROMPT = """You are analyzing {company_name}'s technical implementation for a sophisticated AI newsletter that focuses on discovering unique, high-impact insights.

Your goal is NOT to categorize - it's to DISCOVER what's genuinely interesting and unique about this implementation.

CONTENT FROM {company_name}:
{content}

FUNDING CONTEXT: {funding_info}

Look for:
1. **UNUSUAL technical choices** - What are they doing differently from typical implementations?
2. **NOVEL architectures** - Any patterns or approaches not commonly seen?
3. **HIDDEN complexity** - What technical challenges are they solving that aren't obvious?
4. **DEFENSIBILITY signals** - What would be hard for competitors to replicate?
5. **CONVERGENT patterns** - Approaches that mirror other top-funded AI startups?
6. **MARKET insights** - Why is this approach well-timed for the current market?

Provide your analysis in JSON format:
{{
    "unique_findings": [
        "finding 1 - be specific and technical",
        "finding 2 - focus on what's genuinely interesting"
    ],
    "technical_moat": "what makes this technically defensible",
    "market_timing": "why now? what enables this approach today?",
    "newsletter_potential": "low" | "medium" | "high",
    "newsletter_angle": "if you were writing about this, what's the hook?",
    "comparable_approaches": ["other companies doing similar things"]
}}

Be critical. Not every company has unique insights. If the content is too marketing-focused or lacks technical depth, say so.

Return ONLY valid JSON."""


# Market Classification Prompt
MARKET_CLASSIFICATION_PROMPT = """Classify {company_name}'s market position based on the following content.

CONTENT:
{content}

COMPANY DESCRIPTION: {description}
INDUSTRIES: {industries}

Provide classification in JSON format:
{{
    "market_type": "horizontal" | "vertical",
    "sub_vertical": "specific industry if vertical (e.g., LegalTech, HealthTech, FinTech)",
    "target_market": "b2b" | "b2c" | "b2b2c",
    "positioning": "brief description of market position",
    "competitive_landscape": "who are they competing with",
    "differentiation": "what makes them different from competitors"
}}

DEFINITIONS:
- horizontal: Platform/enabler used across multiple industries
- vertical: Solution specific to one industry

Return ONLY valid JSON."""


# Cross-Startup Pattern Mining Prompt
CROSS_STARTUP_ANALYSIS_PROMPT = """You are analyzing patterns across multiple AI startups for a newsletter about AI build patterns.

STARTUPS ANALYZED:
{startup_summaries}

TASK: Identify cross-cutting patterns, emerging trends, and high-impact insights for newsletter publication.

Provide analysis in JSON format:
{{
    "emerging_consensus": [
        {{
            "pattern": "pattern description",
            "startups_using": ["list of startups"],
            "significance": "why this matters"
        }}
    ],
    "outlier_approaches": [
        {{
            "startup": "company name",
            "approach": "what they're doing differently",
            "potential": "why this might be significant"
        }}
    ],
    "infrastructure_dependencies": [
        "common building blocks across startups"
    ],
    "market_timing_signals": [
        "why now observations"
    ],
    "newsletter_headlines": [
        "potential article angles that would resonate with AI builders"
    ],
    "pattern_frequency": {{
        "pattern_name": count
    }}
}}

Focus on insights that would be valuable to AI practitioners and builders - not just investors.

Return ONLY valid JSON."""


# Competitive Analysis Prompt
COMPETITIVE_ANALYSIS_PROMPT = """You are a competitive intelligence analyst examining {company_name}'s market position.

Based on the following content from their website and documentation, identify:
1. Who are their main competitors?
2. How does this company differentiate from competitors?
3. What is their "secret sauce" - their unique technical or business advantage?

CONTENT FROM {company_name}:
{content}

COMPANY DESCRIPTION: {description}
INDUSTRIES: {industries}
FUNDING: {funding_info}

Provide your analysis in JSON format:
{{
    "competitors": [
        {{
            "name": "Competitor Name",
            "similarity": "What they have in common",
            "how_different": "How {company_name} differs from this competitor"
        }}
    ],
    "differentiation": {{
        "primary": "The main way they stand out from competitors",
        "technical": "Technical differentiators (architecture, models, data, etc.)",
        "business": "Business model or GTM differentiators",
        "positioning": "How they position themselves vs alternatives"
    }},
    "secret_sauce": {{
        "core_advantage": "Their fundamental unique advantage",
        "defensibility": "Why this is hard to replicate",
        "evidence": ["quotes or facts supporting this"]
    }},
    "competitive_moat": "low" | "medium" | "high",
    "moat_explanation": "Why their competitive position is defensible or not"
}}

Be specific. Look for:
- Direct mentions of competitors or "vs" comparisons
- Claims of being "first", "only", "best at X"
- Unique technology, data, or expertise
- Specific customer segments they own
- Integration advantages or ecosystem effects

If competitors aren't explicitly mentioned, infer likely competitors based on the problem space and features.

Return ONLY valid JSON."""


# Tech Stack Detection Prompt
TECH_STACK_PROMPT = """You are analyzing {company_name}'s technical architecture and tech stack.

CONTENT FROM {company_name}:
{content}

TASK: Identify the specific technologies, models, and infrastructure they use or mention.

Provide your analysis in JSON format:
{{
    "llm_providers": ["OpenAI", "Anthropic", "Google", "Meta", etc.],
    "llm_models": ["GPT-4", "Claude", "Llama 2", "Mistral", etc.],
    "vector_databases": ["Pinecone", "Weaviate", "Chroma", "pgvector", "Qdrant", etc.],
    "frameworks": ["LangChain", "LlamaIndex", "Semantic Kernel", "Haystack", etc.],
    "hosting": ["Azure", "AWS", "GCP", "Self-hosted", "Edge/On-device"],
    "approach": "rag" | "fine_tuning" | "hybrid" | "prompt_engineering" | "unknown",
    "uses_open_source_models": true/false,
    "has_custom_models": true/false,
    "architecture_notes": "Brief description of their technical approach"
}}

Look for:
- Explicit mentions of model names (GPT-4, Claude, Llama, Mistral, etc.)
- Vector DB mentions (Pinecone, Weaviate, embeddings storage)
- Framework references (LangChain, LlamaIndex)
- Cloud provider mentions (Azure OpenAI, AWS Bedrock, GCP Vertex)
- Terms like "fine-tuned", "custom model", "proprietary model"
- RAG/retrieval mentions, embedding mentions

Return ONLY valid JSON."""


# Engineering Quality Assessment Prompt
ENGINEERING_QUALITY_PROMPT = """You are assessing the engineering quality and maturity of {company_name} based on their web presence.

CONTENT FROM {company_name} (includes website, docs, GitHub if available):
{content}

TASK: Evaluate their engineering sophistication and developer-friendliness.

Provide your assessment in JSON format:
{{
    "score": 1-10,
    "has_public_api": true/false,
    "has_sdk": true/false,
    "has_documentation": true/false,
    "has_engineering_blog": true/false,
    "api_maturity": "none" | "basic" | "good" | "excellent",
    "documentation_quality": "none" | "basic" | "good" | "excellent",
    "signals": [
        "Specific positive engineering signals found"
    ],
    "red_flags": [
        "Any concerning engineering signals"
    ],
    "assessment": "Brief overall engineering quality assessment"
}}

SCORING GUIDE:
- 1-3: No visible engineering culture, marketing-only presence
- 4-5: Basic API/docs, minimal technical content
- 6-7: Good documentation, clear technical approach, some transparency
- 8-9: Excellent developer experience, engineering blog, open source contributions
- 10: Industry-leading engineering practices, comprehensive docs, active community

Look for:
- Developer documentation quality
- API design and versioning
- SDK availability (Python, JS, etc.)
- Engineering blog posts
- Open source contributions
- Technical architecture transparency
- Response to technical feedback

Return ONLY valid JSON."""


# Vertical Context Prompt
VERTICAL_ANALYSIS_PROMPT = """You are classifying {company_name} into an industry vertical and providing vertical-specific analysis.

CONTENT FROM {company_name}:
{content}

COMPANY DESCRIPTION: {description}
INDUSTRIES MENTIONED: {industries}

TASK: Identify the primary vertical and provide vertical-specific context.

VERTICALS:
- healthcare: Medical AI, clinical, drug discovery, patient care
- legal: Legal tech, contract analysis, compliance
- financial_services: FinTech, banking, insurance, trading
- developer_tools: APIs, SDKs, infrastructure for developers
- enterprise_saas: B2B SaaS, productivity, collaboration
- consumer: Consumer-facing apps, B2C
- industrial: Manufacturing, supply chain, logistics
- education: EdTech, learning, training
- marketing: MarTech, advertising, content
- hr_recruiting: HR tech, recruiting, talent management
- cybersecurity: Security, threat detection, compliance
- ecommerce: Retail, commerce, marketplace
- media_content: Content creation, media, entertainment
- other: Doesn't fit above categories

Provide your analysis in JSON format:
{{
    "vertical": "one of the verticals above",
    "confidence": 0.0-1.0,
    "sub_vertical": "more specific category (e.g., 'clinical decision support' for healthcare)",
    "vertical_specific_insights": [
        "How their AI approach fits this vertical's needs",
        "Vertical-specific technical considerations"
    ],
    "regulatory_considerations": "HIPAA, SOC2, GDPR, etc. if applicable",
    "typical_buyers": "Who buys in this vertical",
    "vertical_competitors": ["Main competitors in this specific vertical"],
    "market_timing_vertical": "Why is this approach timely for this vertical specifically"
}}

Return ONLY valid JSON."""


# Story Angle Generation Prompt
STORY_ANGLES_PROMPT = """You are a newsletter editor finding compelling story angles for {company_name}.

CONTENT FROM {company_name}:
{content}

ANALYSIS CONTEXT:
- Build Patterns Detected: {patterns}
- Tech Stack: {tech_stack}
- Vertical: {vertical}
- Funding: {funding_info}
- Engineering Quality: {eng_quality}

TASK: Generate 3-4 compelling newsletter story angles for an AI-focused technical audience.

ANGLE TYPES:
1. **architecture** - "How they built X differently" - Focus on technical choices
2. **data** - "Their secret weapon: proprietary Y data" - Focus on data advantages
3. **vertical_expert** - "Deep domain expertise in Z" - Focus on vertical knowledge
4. **contrarian** - "Why they bet against the trend" - Focus on unconventional choices
5. **efficiency** - "10x faster/cheaper than alternatives" - Focus on performance

Provide your analysis in JSON format:
{{
    "story_angles": [
        {{
            "angle_type": "architecture|data|vertical_expert|contrarian|efficiency",
            "headline": "Compelling one-liner hook (newsletter headline style)",
            "summary": "2-3 sentence expansion of the angle",
            "evidence": ["Supporting fact 1", "Supporting fact 2"],
            "uniqueness_score": 1-10
        }}
    ],
    "best_angle": "Which angle is most compelling and why",
    "newsletter_ready": true/false,
    "additional_research_needed": ["What else would make this a better story"]
}}

GUIDELINES:
- Headlines should be specific and intriguing, not generic
- Focus on what builders would find interesting, not just investors
- Be critical - not every company deserves a newsletter feature
- Higher uniqueness scores for genuinely novel angles

Return ONLY valid JSON."""


# Anti-Pattern Detection Prompt
ANTI_PATTERNS_PROMPT = """You are a critical analyst identifying warning signs and anti-patterns in {company_name}.

CONTENT FROM {company_name}:
{content}

ANALYSIS CONTEXT:
- Build Patterns: {patterns}
- Tech Stack: {tech_stack}
- Competitive Position: {competitive_info}

TASK: Identify any concerning patterns or red flags. Be critical but fair.

ANTI-PATTERNS TO DETECT:

1. **wrapper** - "Just a Wrapper"
   - Thin layer over OpenAI/Anthropic API
   - No proprietary technology
   - Features easily replicated by API provider

2. **feature_not_product** - "Feature, Not Product"
   - Could be absorbed by incumbents
   - Single feature that platforms will add
   - No clear path to broader product

3. **no_moat** - "No Clear Moat"
   - No data advantage
   - No technical differentiation
   - Easily replicable by competitors

4. **overclaiming** - "Overclaiming"
   - Marketing doesn't match technical reality
   - Buzzword-heavy with no substance
   - Claims "AI-powered" without specifics

5. **undifferentiated** - "Undifferentiated"
   - Me-too approach
   - Crowded market without clear positioning
   - No unique angle

Provide your analysis in JSON format:
{{
    "anti_patterns": [
        {{
            "pattern_type": "wrapper|feature_not_product|no_moat|overclaiming|undifferentiated",
            "description": "Specific description of the concern",
            "severity": "low|medium|high",
            "evidence": ["Supporting evidence"]
        }}
    ],
    "overall_risk_level": "low|medium|high",
    "mitigating_factors": ["Any factors that offset these concerns"],
    "critical_assessment": "Honest overall assessment of viability"
}}

Be objective. Not every company has anti-patterns, but be thorough in looking.

Return ONLY valid JSON."""


def get_competitive_analysis_prompt(
    company_name: str,
    content: str,
    description: str = "",
    industries: str = "",
    funding_info: str = ""
) -> str:
    """Get the competitive analysis prompt formatted with content."""
    return COMPETITIVE_ANALYSIS_PROMPT.format(
        company_name=company_name,
        content=content[:35000],
        description=description or "Not available",
        industries=industries or "Not specified",
        funding_info=funding_info or "Not disclosed"
    )


def get_genai_detection_prompt(company_name: str, content: str) -> str:
    """Get the GenAI detection prompt formatted with content."""
    return GENAI_DETECTION_PROMPT.format(
        company_name=company_name,
        content=content[:30000]  # Limit content length
    )


def get_build_patterns_prompt(company_name: str, content: str) -> str:
    """Get the build patterns prompt formatted with content."""
    return BUILD_PATTERNS_PROMPT.format(
        company_name=company_name,
        content=content[:30000]
    )


def get_insight_discovery_prompt(company_name: str, content: str, funding_info: str = "") -> str:
    """Get the insight discovery prompt formatted with content."""
    return INSIGHT_DISCOVERY_PROMPT.format(
        company_name=company_name,
        content=content[:30000],
        funding_info=funding_info or "No funding info available"
    )


def get_market_classification_prompt(
    company_name: str,
    content: str,
    description: str = "",
    industries: str = ""
) -> str:
    """Get the market classification prompt formatted with content."""
    return MARKET_CLASSIFICATION_PROMPT.format(
        company_name=company_name,
        content=content[:20000],
        description=description or "Not available",
        industries=industries or "Not specified"
    )


def get_cross_startup_prompt(startup_summaries: str) -> str:
    """Get the cross-startup analysis prompt."""
    return CROSS_STARTUP_ANALYSIS_PROMPT.format(
        startup_summaries=startup_summaries[:50000]
    )


def get_tech_stack_prompt(company_name: str, content: str) -> str:
    """Get the tech stack detection prompt."""
    return TECH_STACK_PROMPT.format(
        company_name=company_name,
        content=content[:30000]
    )


def get_engineering_quality_prompt(company_name: str, content: str) -> str:
    """Get the engineering quality assessment prompt."""
    return ENGINEERING_QUALITY_PROMPT.format(
        company_name=company_name,
        content=content[:30000]
    )


def get_vertical_analysis_prompt(
    company_name: str,
    content: str,
    description: str = "",
    industries: str = ""
) -> str:
    """Get the vertical analysis prompt."""
    return VERTICAL_ANALYSIS_PROMPT.format(
        company_name=company_name,
        content=content[:25000],
        description=description or "Not available",
        industries=industries or "Not specified"
    )


def get_story_angles_prompt(
    company_name: str,
    content: str,
    patterns: str = "",
    tech_stack: str = "",
    vertical: str = "",
    funding_info: str = "",
    eng_quality: str = ""
) -> str:
    """Get the story angles generation prompt."""
    return STORY_ANGLES_PROMPT.format(
        company_name=company_name,
        content=content[:25000],
        patterns=patterns or "Not analyzed",
        tech_stack=tech_stack or "Not detected",
        vertical=vertical or "Not classified",
        funding_info=funding_info or "Not disclosed",
        eng_quality=eng_quality or "Not assessed"
    )


def get_anti_patterns_prompt(
    company_name: str,
    content: str,
    patterns: str = "",
    tech_stack: str = "",
    competitive_info: str = ""
) -> str:
    """Get the anti-patterns detection prompt."""
    return ANTI_PATTERNS_PROMPT.format(
        company_name=company_name,
        content=content[:25000],
        patterns=patterns or "Not analyzed",
        tech_stack=tech_stack or "Not detected",
        competitive_info=competitive_info or "Not analyzed"
    )


def get_pattern_discovery_prompt(company_name: str, content: str) -> str:
    """Get the dynamic pattern discovery prompt formatted with content."""
    return PATTERN_DISCOVERY_PROMPT.format(
        company_name=company_name,
        content=content[:35000]  # Larger context for thorough analysis
    )


def get_team_analysis_prompt(company_name: str, content: str) -> str:
    """Get the team analysis prompt formatted with content."""
    return TEAM_ANALYSIS_PROMPT.format(
        company_name=company_name,
        content=content[:25000]
    )


def get_business_model_prompt(
    company_name: str,
    content: str,
    funding_info: str = ""
) -> str:
    """Get the business model analysis prompt formatted with content."""
    return BUSINESS_MODEL_PROMPT.format(
        company_name=company_name,
        content=content[:25000],
        funding_info=funding_info or "Not disclosed"
    )


def get_product_depth_prompt(company_name: str, content: str) -> str:
    """Get the product depth analysis prompt formatted with content."""
    return PRODUCT_DEPTH_PROMPT.format(
        company_name=company_name,
        content=content[:25000]
    )
