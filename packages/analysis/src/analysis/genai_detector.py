"""GenAI detection and analysis using Azure OpenAI."""

import json
import re
from pathlib import Path
from typing import Dict, Any, List
from openai import AzureOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

from src.config import settings, llm_kwargs
from src.data.models import (
    StartupInput,
    StartupAnalysis,
    BuildPattern,
    GenAIIntensity,
    MarketType,
    TargetMarket,
    Vertical,
    MoatType,
    CompetitiveAnalysis,
    Competitor,
    Differentiation,
    SecretSauce,
    TechStack,
    EngineeringQuality,
    StoryAngle,
    AntiPattern,
    # New models for enhanced analysis
    DiscoveredPattern,
    NovelApproach,
    ModelDetails,
    FineTuningDetails,
    ModelRouting,
    CompoundAIDetails,
    TeamAnalysis,
    FounderInfo,
    TeamSignals,
    BusinessModel,
    PricingModel,
    GTMStrategy,
    RevenueModel,
    CustomerAcquisition,
    ProductAnalysis,
    FeatureDepth,
    IntegrationEcosystem,
    UseCases,
)
from src.analysis.prompts import (
    get_genai_detection_prompt,
    get_build_patterns_prompt,
    get_insight_discovery_prompt,
    get_market_classification_prompt,
    get_competitive_analysis_prompt,
    get_tech_stack_prompt,
    get_engineering_quality_prompt,
    get_vertical_analysis_prompt,
    get_story_angles_prompt,
    get_anti_patterns_prompt,
    # New prompts for enhanced analysis
    get_pattern_discovery_prompt,
    get_team_analysis_prompt,
    get_business_model_prompt,
    get_product_depth_prompt,
)
from src.crawler.engine import StartupCrawler


class GenAIAnalyzer:
    """Analyzes startups for GenAI usage and build patterns."""

    def __init__(self):
        self._using_aad = False
        self._aad_credential = None
        self._aad_token_provider = None
        self.client = self._create_azure_client(prefer_key=True)
        self.fast_model = settings.azure_openai.fast_model
        self.reasoning_model = settings.azure_openai.reasoning_model
        self.crawler = StartupCrawler()
        self._vertical_taxonomy_ontology = self._load_vertical_taxonomy_ontology()

    def _create_azure_client(self, prefer_key: bool) -> AzureOpenAI:
        """
        Create an AzureOpenAI client.

        Some Azure OpenAI resources disable key-based authentication (AAD-only).
        We default to API key when available, but can fall back to AAD.
        """
        if prefer_key and settings.azure_openai.api_key:
            return AzureOpenAI(
                api_key=settings.azure_openai.api_key,
                api_version=settings.azure_openai.api_version,
                azure_endpoint=settings.azure_openai.endpoint,
            )

        # AAD token via DefaultAzureCredential (uses Azure CLI / managed identity / env creds).
        self._aad_credential = DefaultAzureCredential()
        self._aad_token_provider = get_bearer_token_provider(
            self._aad_credential, "https://cognitiveservices.azure.com/.default"
        )
        self._using_aad = True
        return AzureOpenAI(
            api_version=settings.azure_openai.api_version,
            azure_endpoint=settings.azure_openai.endpoint,
            azure_ad_token_provider=self._aad_token_provider,
        )

    def _ensure_aad_client(self) -> None:
        if self._using_aad:
            return
        self.client = self._create_azure_client(prefer_key=False)

    def _load_vertical_taxonomy_ontology(self) -> Dict[str, Any]:
        """Load the versioned vertical taxonomy ontology JSON."""
        # genai_detector.py lives at src/analysis; ontology is at src/ontology.
        ontology_path = Path(__file__).resolve().parents[1] / "ontology" / "startup_vertical_ontology_v1.json"
        try:
            with ontology_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict) or not isinstance(data.get("vertical_tree"), list):
                return {}
            return data
        except Exception as e:
            print(f"Failed to load vertical taxonomy ontology ({ontology_path}): {e}")
            return {}

    async def _classify_vertical_taxonomy(
        self, company_name: str, content: str, description: str, industries: str
    ) -> Dict[str, Any]:
        """
        Classify a startup into a flexible, hierarchical vertical taxonomy.

        Notes:
        - Content may be Turkish; the model should translate internally and pick canonical IDs/labels.
        - We classify stepwise (root -> child -> ...), to avoid stuffing the entire ontology into one prompt.
        """
        ontology = self._vertical_taxonomy_ontology or {}
        vertical_tree = ontology.get("vertical_tree") or []
        if not isinstance(vertical_tree, list) or not vertical_tree:
            return {}

        # Keep context small but informative; we call the model multiple times.
        excerpt = (content or "")[:4000]
        context = (
            f"COMPANY: {company_name}\n"
            f"DESCRIPTION: {description}\n"
            f"INDUSTRIES: {industries}\n"
            f"CONTENT_EXCERPT (may be Turkish):\n{excerpt}"
        ).strip()

        def candidates_payload(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
            payload: List[Dict[str, Any]] = []
            for n in nodes:
                if not isinstance(n, dict):
                    continue
                synonyms = n.get("synonyms") if isinstance(n.get("synonyms"), list) else []
                payload.append(
                    {
                        "id": n.get("id"),
                        "label": n.get("label"),
                        "synonyms": [s for s in synonyms if isinstance(s, str)][:6],
                    }
                )
            return payload

        async def pick(nodes: List[Dict[str, Any]], allow_none: bool) -> Dict[str, Any]:
            options = candidates_payload(nodes)
            allowed_ids = [o["id"] for o in options if isinstance(o.get("id"), str)]
            if allow_none:
                allowed_ids.append("none")

            prompt = f"""You are a startup classification assistant.

The content may be in Turkish. If so, translate internally. Always pick from the allowed IDs.

CONTEXT:
{context}

TASK:
- Choose the single best matching category ID from the list below.
- If none are a good fit, choose "none" (only allowed when present).

ALLOWED_OPTIONS (JSON):
{json.dumps(options, ensure_ascii=False)}

OUTPUT (JSON only):
{{
  "id": "one of: {', '.join(allowed_ids)}",
  "confidence": 0.0-1.0,
  "notes": "short justification"
}}
"""
            result = await self._call_llm(prompt, use_reasoning=False)
            chosen = result.get("id") if isinstance(result, dict) else None
            if chosen not in set(allowed_ids):
                # Never fall back to the first option (that silently misclassifies on connection failures).
                # Prefer an explicit stop marker, or fail fast so callers can retry.
                if allow_none:
                    return {"id": "none", "confidence": 0.0, "notes": "no_valid_choice"}
                raise RuntimeError("Vertical taxonomy LLM returned no valid choice")
            conf = result.get("confidence", 0.0)
            try:
                conf = float(conf)
            except Exception:
                conf = 0.0
            return {"id": chosen, "confidence": max(0.0, min(1.0, conf)), "notes": str(result.get("notes", ""))[:240]}

        # Walk the ontology tree.
        path: List[Dict[str, Any]] = []
        current_nodes: List[Dict[str, Any]] = vertical_tree
        max_depth = 4  # vertical -> sub -> leaf -> (optional deeper)

        for depth in range(max_depth):
            allow_none = True  # allow stopping at any level; better to return {} than misclassify
            choice = await pick(current_nodes, allow_none=allow_none)
            chosen_id = choice.get("id")
            if chosen_id == "none":
                break

            node = next((n for n in current_nodes if isinstance(n, dict) and n.get("id") == chosen_id), None)
            if not node:
                break

            path.append(
                {
                    "id": node.get("id"),
                    "label": node.get("label"),
                    "confidence": choice.get("confidence", 0.0),
                }
            )

            children = node.get("children") if isinstance(node.get("children"), list) else []
            if not children:
                break
            current_nodes = children

        if not path:
            return {}

        primary_vertical = path[0]
        primary_sub = path[1] if len(path) > 1 else None
        primary_leaf = path[-1]

        return {
            "ontology_id": ontology.get("ontology_id", "startup-vertical-taxonomy"),
            "ontology_version": ontology.get("version", ""),
            "primary": {
                "vertical_id": primary_vertical.get("id"),
                "vertical_label": primary_vertical.get("label"),
                "sub_vertical_id": primary_sub.get("id") if primary_sub else None,
                "sub_vertical_label": primary_sub.get("label") if primary_sub else None,
                "leaf_id": primary_leaf.get("id"),
                "leaf_label": primary_leaf.get("label"),
            },
            "path": path,
        }

    async def analyze_startup(self, startup: StartupInput) -> StartupAnalysis:
        """Perform complete analysis of a startup."""
        # Get content from crawler
        content = self.crawler.get_all_cached_content(startup.name)

        if not content:
            # Need to crawl first
            _ = await self.crawler.crawl_startup(startup)  # Crawl to populate cache
            content = self.crawler.get_all_cached_content(startup.name)

        if not content:
            # Still no content, return minimal analysis
            return StartupAnalysis(
                company_name=startup.name,
                company_slug=StartupAnalysis.to_slug(startup.name),
                website=startup.website,
                description=startup.description,
                funding_amount=startup.funding_amount,
                funding_stage=startup.funding_stage,
                uses_genai=False,
                genai_intensity=GenAIIntensity.UNCLEAR,
                newsletter_potential="low",
            )

        # Run all analyses
        funding_info = f"${startup.funding_amount:,.0f} {startup.funding_type}" if startup.funding_amount else ""
        industries_str = ", ".join(startup.industries)

        # Core analyses
        genai_result = await self._detect_genai(startup.name, content)
        patterns_result = await self._detect_patterns(startup.name, content)
        insights_result = await self._discover_insights(startup.name, content, funding_info)
        market_result = await self._classify_market(
            startup.name, content, startup.description or "", industries_str
        )
        competitive_result = await self._analyze_competitive(
            startup.name, content, startup.description or "", industries_str, funding_info
        )

        # Enhanced analyses
        tech_stack_result = await self._detect_tech_stack(startup.name, content)
        engineering_result = await self._assess_engineering_quality(startup.name, content)
        vertical_result = await self._analyze_vertical(
            startup.name, content, startup.description or "", industries_str
        )
        try:
            vertical_taxonomy_result = await self._classify_vertical_taxonomy(
                startup.name, content, startup.description or "", industries_str
            )
        except Exception as e:
            print(f"Vertical taxonomy classification failed for {startup.name}: {e}")
            vertical_taxonomy_result = {}

        # NEW: Dynamic pattern discovery and business analysis
        pattern_discovery_result = await self._discover_patterns(startup.name, content)
        team_result = await self._analyze_team(startup.name, content)
        business_model_result = await self._analyze_business_model(startup.name, content, funding_info)
        product_result = await self._analyze_product(startup.name, content)

        # Parse intermediate results for story angles
        patterns_str = ", ".join([p.get("name", "") for p in patterns_result.get("patterns_detected", [])])
        discovered_patterns_str = ", ".join([
            p.get("pattern_name", "") for p in pattern_discovery_result.get("discovered_patterns", [])
        ])
        all_patterns_str = f"{patterns_str}, {discovered_patterns_str}".strip(", ")
        tech_stack_str = f"LLMs: {tech_stack_result.get('llm_models', [])}, Approach: {tech_stack_result.get('approach', 'unknown')}"
        vertical_str = vertical_result.get("vertical", "other")
        eng_quality_str = f"Score: {engineering_result.get('score', 0)}/10"

        # Generate story angles based on all analyses
        story_angles_result = await self._generate_story_angles(
            startup.name, content, all_patterns_str, tech_stack_str, vertical_str, funding_info, eng_quality_str
        )

        # Detect anti-patterns
        competitive_str = f"Moat: {competitive_result.get('competitive_moat', 'unknown')}"
        anti_patterns_result = await self._detect_anti_patterns(
            startup.name, content, all_patterns_str, tech_stack_str, competitive_str
        )

        # Build the analysis result
        analysis = StartupAnalysis(
            company_name=startup.name,
            company_slug=StartupAnalysis.to_slug(startup.name),
            website=startup.website,
            description=startup.description,
            funding_amount=startup.funding_amount,
            funding_stage=startup.funding_stage,
            uses_genai=genai_result.get("uses_genai", False),
            genai_intensity=self._parse_intensity(genai_result.get("genai_intensity", "unclear")),
            models_mentioned=genai_result.get("models_mentioned", []),
            build_patterns=self._parse_patterns(patterns_result.get("patterns_detected", [])),
            market_type=self._parse_market_type(market_result.get("market_type", "horizontal")),
            vertical=self._parse_vertical(vertical_result.get("vertical", "other")),
            sub_vertical=vertical_result.get("sub_vertical") or market_result.get("sub_vertical"),
            sub_sub_vertical=vertical_result.get("sub_sub_vertical") or market_result.get("sub_sub_vertical"),
            vertical_taxonomy=vertical_taxonomy_result or {},
            target_market=self._parse_target_market(market_result.get("target_market", "unknown")),
            tech_stack=self._parse_tech_stack(tech_stack_result),
            engineering_quality=self._parse_engineering_quality(engineering_result),
            unique_findings=insights_result.get("unique_findings", []),
            technical_depth=patterns_result.get("technical_depth", "unknown"),
            newsletter_potential=insights_result.get("newsletter_potential", "unknown"),
            story_angles=self._parse_story_angles(story_angles_result.get("story_angles", [])),
            anti_patterns=self._parse_anti_patterns(anti_patterns_result.get("anti_patterns", [])),
            competitive_analysis=self._parse_competitive_analysis(competitive_result),
            evidence_quotes=genai_result.get("evidence", []) + patterns_result.get("novel_approaches", []),
            confidence_score=genai_result.get("confidence", 0.0),
            raw_content_analyzed=len(content),
            # NEW: Dynamic pattern discovery fields
            discovered_patterns=self._parse_discovered_patterns(
                pattern_discovery_result.get("discovered_patterns", [])
            ),
            model_details=self._parse_model_details(
                pattern_discovery_result.get("model_details", {})
            ),
            novel_approaches=self._parse_novel_approaches(
                pattern_discovery_result.get("novel_approaches", [])
            ),
            implementation_maturity=pattern_discovery_result.get("implementation_maturity", "unknown"),
            # NEW: Business analysis fields
            team_analysis=self._parse_team_analysis(team_result),
            business_model=self._parse_business_model(business_model_result),
            product_analysis=self._parse_product_analysis(product_result),
        )

        return analysis

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _detect_genai(self, company_name: str, content: str) -> Dict[str, Any]:
        """Detect GenAI usage in content."""
        prompt = get_genai_detection_prompt(company_name, content)
        return await self._call_llm(prompt, use_reasoning=False)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _detect_patterns(self, company_name: str, content: str) -> Dict[str, Any]:
        """Detect build patterns in content."""
        prompt = get_build_patterns_prompt(company_name, content)
        return await self._call_llm(prompt, use_reasoning=True)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _discover_insights(self, company_name: str, content: str, funding_info: str) -> Dict[str, Any]:
        """Discover unique insights."""
        prompt = get_insight_discovery_prompt(company_name, content, funding_info)
        return await self._call_llm(prompt, use_reasoning=True)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _classify_market(
        self,
        company_name: str,
        content: str,
        description: str,
        industries: str
    ) -> Dict[str, Any]:
        """Classify market position."""
        prompt = get_market_classification_prompt(company_name, content, description, industries)
        return await self._call_llm(prompt, use_reasoning=False)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _analyze_competitive(
        self,
        company_name: str,
        content: str,
        description: str,
        industries: str,
        funding_info: str
    ) -> Dict[str, Any]:
        """Analyze competitive landscape and differentiation."""
        prompt = get_competitive_analysis_prompt(
            company_name, content, description, industries, funding_info
        )
        return await self._call_llm(prompt, use_reasoning=True)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _detect_tech_stack(self, company_name: str, content: str) -> Dict[str, Any]:
        """Detect technology stack components."""
        prompt = get_tech_stack_prompt(company_name, content)
        return await self._call_llm(prompt, use_reasoning=False)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _assess_engineering_quality(self, company_name: str, content: str) -> Dict[str, Any]:
        """Assess engineering quality and maturity."""
        prompt = get_engineering_quality_prompt(company_name, content)
        return await self._call_llm(prompt, use_reasoning=False)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _analyze_vertical(
        self, company_name: str, content: str, description: str, industries: str
    ) -> Dict[str, Any]:
        """Analyze vertical classification and context."""
        prompt = get_vertical_analysis_prompt(company_name, content, description, industries)
        return await self._call_llm(prompt, use_reasoning=False)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _generate_story_angles(
        self, company_name: str, content: str,
        patterns: str, tech_stack: str, vertical: str, funding_info: str, eng_quality: str
    ) -> Dict[str, Any]:
        """Generate newsletter story angles."""
        prompt = get_story_angles_prompt(
            company_name, content, patterns, tech_stack, vertical, funding_info, eng_quality
        )
        return await self._call_llm(prompt, use_reasoning=True)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _detect_anti_patterns(
        self, company_name: str, content: str, patterns: str, tech_stack: str, competitive_info: str
    ) -> Dict[str, Any]:
        """Detect warning signs and anti-patterns."""
        prompt = get_anti_patterns_prompt(company_name, content, patterns, tech_stack, competitive_info)
        return await self._call_llm(prompt, use_reasoning=True)

    # =========================================================================
    # NEW: Enhanced Analysis Methods
    # =========================================================================

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _discover_patterns(self, company_name: str, content: str) -> Dict[str, Any]:
        """Dynamically discover build patterns without predefined list."""
        prompt = get_pattern_discovery_prompt(company_name, content)
        return await self._call_llm(prompt, use_reasoning=True)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _analyze_team(self, company_name: str, content: str) -> Dict[str, Any]:
        """Analyze team and leadership."""
        prompt = get_team_analysis_prompt(company_name, content)
        return await self._call_llm(prompt, use_reasoning=False)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _analyze_business_model(
        self, company_name: str, content: str, funding_info: str
    ) -> Dict[str, Any]:
        """Analyze business model and GTM strategy."""
        prompt = get_business_model_prompt(company_name, content, funding_info)
        return await self._call_llm(prompt, use_reasoning=False)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _analyze_product(self, company_name: str, content: str) -> Dict[str, Any]:
        """Analyze product depth and maturity."""
        prompt = get_product_depth_prompt(company_name, content)
        return await self._call_llm(prompt, use_reasoning=False)

    async def _call_llm(self, prompt: str, use_reasoning: bool = False) -> Dict[str, Any]:
        """Call Azure OpenAI and parse JSON response."""
        model = self.reasoning_model if use_reasoning else self.fast_model

        try:
            def _do_request() -> Dict[str, Any]:
                r = self.client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "You are a technical analyst. Always respond with valid JSON only."},
                        {"role": "user", "content": prompt}
                    ],
                    **llm_kwargs(model, max_tokens=2000, temperature=0.3),
                )
                content = r.choices[0].message.content
                if content:
                    return self._parse_json_response(content)
                return {}

            try:
                return _do_request()
            except Exception as e:
                msg = str(e)
                # If the resource disables API keys, fall back to AAD automatically and retry once.
                if ("AuthenticationTypeDisabled" in msg or "Key based authentication is disabled" in msg) and not self._using_aad:
                    self._ensure_aad_client()
                    return _do_request()
                raise

        except Exception as e:
            print(f"LLM call failed: {e}")
            return {}

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """Parse JSON from LLM response, handling markdown code blocks."""
        content = content.strip()

        # Remove markdown code blocks if present
        if content.startswith("```"):
            lines = content.split("\n")
            # Remove first and last lines (```json and ```)
            content = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

        try:
            return json.loads(content)
        except json.JSONDecodeError:
            # Try to find JSON in the content
            import re
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                try:
                    return json.loads(json_match.group())
                except json.JSONDecodeError:
                    pass
            return {}

    def _parse_intensity(self, intensity: str) -> GenAIIntensity:
        """Parse GenAI intensity string to enum."""
        mapping = {
            "core": GenAIIntensity.CORE,
            "enhancement": GenAIIntensity.ENHANCEMENT,
            "tooling": GenAIIntensity.TOOLING,
            "none": GenAIIntensity.NONE,
            "unclear": GenAIIntensity.UNCLEAR,
        }
        return mapping.get(intensity.lower(), GenAIIntensity.UNCLEAR)

    def _parse_market_type(self, market_type: str) -> MarketType:
        """Parse market type string to enum."""
        if market_type.lower() == "vertical":
            return MarketType.VERTICAL
        return MarketType.HORIZONTAL

    def _parse_target_market(self, target: str) -> TargetMarket:
        """Parse target market string to enum."""
        mapping = {
            "b2b": TargetMarket.B2B,
            "b2c": TargetMarket.B2C,
            "b2b2c": TargetMarket.B2B2C,
        }
        return mapping.get(target.lower(), TargetMarket.UNKNOWN)

    def _parse_patterns(self, patterns: List[Dict[str, Any]]) -> List[BuildPattern]:
        """Parse pattern dicts to BuildPattern models."""
        result = []
        for p in patterns:
            try:
                result.append(BuildPattern(
                    name=p.get("name", "unknown"),
                    confidence=float(p.get("confidence", 0.5)),
                    evidence=p.get("evidence", []),
                    description=p.get("description"),
                ))
            except Exception:
                pass
        return result

    def _parse_vertical(self, vertical: str) -> Vertical:
        """Parse vertical string to enum."""
        mapping = {
            "healthcare": Vertical.HEALTHCARE,
            "legal": Vertical.LEGAL,
            "financial_services": Vertical.FINANCIAL_SERVICES,
            "developer_tools": Vertical.DEVELOPER_TOOLS,
            "enterprise_saas": Vertical.ENTERPRISE_SAAS,
            "consumer": Vertical.CONSUMER,
            "industrial": Vertical.INDUSTRIAL,
            "education": Vertical.EDUCATION,
            "marketing": Vertical.MARKETING,
            "hr_recruiting": Vertical.HR_RECRUITING,
            "cybersecurity": Vertical.CYBERSECURITY,
            "ecommerce": Vertical.ECOMMERCE,
            "media_content": Vertical.MEDIA_CONTENT,
        }
        return mapping.get(vertical.lower(), Vertical.OTHER)

    def _parse_tech_stack(self, data: Dict[str, Any]) -> TechStack:
        """Parse tech stack result to TechStack model."""
        return TechStack(
            llm_providers=data.get("llm_providers", []),
            llm_models=data.get("llm_models", []),
            vector_databases=data.get("vector_databases", []),
            frameworks=data.get("frameworks", []),
            hosting=data.get("hosting", []),
            approach=data.get("approach", "unknown"),
            uses_open_source_models=data.get("uses_open_source_models", False),
            has_custom_models=data.get("has_custom_models", False),
        )

    def _parse_engineering_quality(self, data: Dict[str, Any]) -> EngineeringQuality:
        """Parse engineering quality result to EngineeringQuality model."""
        return EngineeringQuality(
            score=data.get("score", 0),
            has_public_api=data.get("has_public_api", False),
            has_sdk=data.get("has_sdk", False),
            has_documentation=data.get("has_documentation", False),
            has_engineering_blog=data.get("has_engineering_blog", False),
            signals=data.get("signals", []),
        )

    def _parse_story_angles(self, angles: List[Dict[str, Any]]) -> List[StoryAngle]:
        """Parse story angles result to StoryAngle models."""
        result = []
        for angle in angles:
            try:
                result.append(StoryAngle(
                    angle_type=angle.get("angle_type", "architecture"),
                    headline=angle.get("headline", ""),
                    summary=angle.get("summary", ""),
                    evidence=angle.get("evidence", []),
                    uniqueness_score=angle.get("uniqueness_score", 5),
                ))
            except Exception:
                pass
        return result

    def _parse_anti_patterns(self, patterns: List[Dict[str, Any]]) -> List[AntiPattern]:
        """Parse anti-patterns result to AntiPattern models."""
        result = []
        for p in patterns:
            try:
                result.append(AntiPattern(
                    pattern_type=p.get("pattern_type", "unknown"),
                    description=p.get("description", ""),
                    severity=p.get("severity", "medium"),
                    evidence=p.get("evidence", []),
                ))
            except Exception:
                pass
        return result

    def _parse_competitive_analysis(self, data: Dict[str, Any]) -> CompetitiveAnalysis:
        """Parse competitive analysis result to CompetitiveAnalysis model."""
        # Parse competitors
        competitors = []
        for c in data.get("competitors", []):
            try:
                competitors.append(Competitor(
                    name=c.get("name", ""),
                    similarity=c.get("similarity", ""),
                    how_different=c.get("how_different", ""),
                ))
            except Exception:
                pass

        # Parse differentiation
        diff_data = data.get("differentiation", {})
        differentiation = Differentiation(
            primary=diff_data.get("primary", ""),
            technical=diff_data.get("technical", ""),
            business=diff_data.get("business", ""),
            positioning=diff_data.get("positioning", ""),
        )

        # Parse secret sauce
        sauce_data = data.get("secret_sauce", {})
        secret_sauce = SecretSauce(
            core_advantage=sauce_data.get("core_advantage", ""),
            defensibility=sauce_data.get("defensibility", ""),
            evidence=sauce_data.get("evidence", []),
        )

        return CompetitiveAnalysis(
            competitors=competitors,
            differentiation=differentiation,
            secret_sauce=secret_sauce,
            competitive_moat=data.get("competitive_moat", "unknown"),
            moat_explanation=data.get("moat_explanation", ""),
        )

    # =========================================================================
    # NEW: Parser Methods for Enhanced Analysis
    # =========================================================================

    def _parse_discovered_patterns(self, patterns: List[Dict[str, Any]]) -> List[DiscoveredPattern]:
        """Parse discovered patterns from dynamic pattern discovery."""
        result = []
        for p in patterns:
            try:
                result.append(DiscoveredPattern(
                    category=p.get("category", "Other"),
                    pattern_name=p.get("pattern_name", "unknown"),
                    confidence=float(p.get("confidence", 0.5)),
                    evidence=p.get("evidence", []),
                    description=p.get("description", ""),
                    novelty_score=int(p.get("novelty_score", 5)),
                    why_notable=p.get("why_notable", ""),
                ))
            except Exception:
                pass
        return result

    def _parse_novel_approaches(self, approaches: List[Dict[str, Any]]) -> List[NovelApproach]:
        """Parse novel approaches from pattern discovery."""
        result = []
        for a in approaches:
            try:
                result.append(NovelApproach(
                    approach=a.get("approach", ""),
                    why_novel=a.get("why_novel", ""),
                    potential_impact=a.get("potential_impact", ""),
                ))
            except Exception:
                pass
        return result

    def _parse_model_details(self, data: Dict[str, Any]) -> ModelDetails:
        """Parse model details from pattern discovery."""
        fine_tuning_data = data.get("fine_tuning", {})
        routing_data = data.get("model_routing", {})
        compound_data = data.get("compound_ai", {})

        return ModelDetails(
            primary_models=data.get("primary_models", []),
            fine_tuning=FineTuningDetails(
                uses_fine_tuning=fine_tuning_data.get("uses_fine_tuning", False),
                fine_tuning_approach=fine_tuning_data.get("fine_tuning_approach", ""),
                training_data_source=fine_tuning_data.get("training_data_source", ""),
            ),
            inference_optimization=data.get("inference_optimization", []),
            model_routing=ModelRouting(
                uses_routing=routing_data.get("uses_routing", False),
                routing_strategy=routing_data.get("routing_strategy", ""),
            ),
            compound_ai=CompoundAIDetails(
                is_compound_system=compound_data.get("is_compound_system", False),
                orchestration_pattern=compound_data.get("orchestration_pattern", ""),
            ),
        )

    def _parse_team_analysis(self, data: Dict[str, Any]) -> TeamAnalysis:
        """Parse team analysis result."""
        founders = []
        for f in data.get("founders", []):
            try:
                founders.append(FounderInfo(
                    name=f.get("name", ""),
                    role=f.get("role", ""),
                    background=f.get("background", ""),
                    previous_companies=f.get("previous_companies", []),
                    technical_depth=f.get("technical_depth", "unknown"),
                    domain_expertise=f.get("domain_expertise", ""),
                ))
            except Exception:
                pass

        team_signals_data = data.get("team_signals", {})
        team_signals = TeamSignals(
            engineering_heavy=team_signals_data.get("engineering_heavy", False),
            has_ml_expertise=team_signals_data.get("has_ml_expertise", False),
            has_domain_expertise=team_signals_data.get("has_domain_expertise", False),
            hiring_signals=team_signals_data.get("hiring_signals", []),
            team_size_indicators=team_signals_data.get("team_size_indicators", "unknown"),
            remote_distributed=team_signals_data.get("remote_distributed", False),
        )

        return TeamAnalysis(
            founders=founders,
            team_signals=team_signals,
            founder_market_fit=data.get("founder_market_fit", ""),
            team_strengths=data.get("team_strengths", []),
            team_red_flags=data.get("team_red_flags", []),
            team_confidence=data.get("team_confidence", 0.0),
        )

    def _parse_business_model(self, data: Dict[str, Any]) -> BusinessModel:
        """Parse business model analysis result."""
        pricing_data = data.get("pricing_model", {})
        gtm_data = data.get("gtm_strategy", {})
        revenue_data = data.get("revenue_model", {})
        acquisition_data = data.get("customer_acquisition", {})

        return BusinessModel(
            pricing_model=PricingModel(
                type=pricing_data.get("type", "unknown"),
                pricing_evidence=pricing_data.get("pricing_evidence", []),
                free_tier_available=pricing_data.get("free_tier_available", False),
                enterprise_focus=pricing_data.get("enterprise_focus", False),
                price_points=pricing_data.get("price_points", []),
            ),
            gtm_strategy=GTMStrategy(
                primary_channel=gtm_data.get("primary_channel", "unknown"),
                evidence=gtm_data.get("evidence", []),
                target_segment=gtm_data.get("target_segment", "unknown"),
                sales_motion=gtm_data.get("sales_motion", "unknown"),
            ),
            revenue_model=RevenueModel(
                monetization_approach=revenue_data.get("monetization_approach", ""),
                unit_economics_signals=revenue_data.get("unit_economics_signals", []),
                recurring_revenue=revenue_data.get("recurring_revenue", False),
            ),
            distribution_advantages=data.get("distribution_advantages", []),
            customer_acquisition=CustomerAcquisition(
                acquisition_channels=acquisition_data.get("acquisition_channels", []),
                customer_proof_points=acquisition_data.get("customer_proof_points", []),
            ),
            business_model_clarity=data.get("business_model_clarity", "unclear"),
            business_model_confidence=data.get("business_model_confidence", 0.0),
        )

    def _parse_product_analysis(self, data: Dict[str, Any]) -> ProductAnalysis:
        """Parse product analysis result."""
        feature_data = data.get("feature_depth", {})
        integration_data = data.get("integration_ecosystem", {})
        use_case_data = data.get("use_cases", {})

        return ProductAnalysis(
            product_stage=data.get("product_stage", "unknown"),
            stage_evidence=data.get("stage_evidence", []),
            feature_depth=FeatureDepth(
                core_features=feature_data.get("core_features", []),
                differentiating_features=feature_data.get("differentiating_features", []),
                roadmap_signals=feature_data.get("roadmap_signals", []),
                feature_completeness=feature_data.get("feature_completeness", "unknown"),
            ),
            integration_ecosystem=IntegrationEcosystem(
                integrations_mentioned=integration_data.get("integrations_mentioned", []),
                api_maturity=integration_data.get("api_maturity", "none"),
                sdk_availability=integration_data.get("sdk_availability", []),
                webhook_support=integration_data.get("webhook_support", False),
                marketplace_presence=integration_data.get("marketplace_presence", []),
            ),
            use_cases=UseCases(
                primary_use_case=use_case_data.get("primary_use_case", ""),
                secondary_use_cases=use_case_data.get("secondary_use_cases", []),
                customer_stories=use_case_data.get("customer_stories", []),
                industry_focus=use_case_data.get("industry_focus", []),
            ),
            product_risks=data.get("product_risks", []),
            product_strengths=data.get("product_strengths", []),
            product_confidence=data.get("product_confidence", 0.0),
        )


async def analyze_startup_batch(startups: List[StartupInput]) -> List[StartupAnalysis]:
    """Analyze multiple startups."""
    analyzer = GenAIAnalyzer()
    results = []

    for startup in startups:
        print(f"Analyzing {startup.name}...")
        try:
            analysis = await analyzer.analyze_startup(startup)
            results.append(analysis)
            print(f"  -> GenAI: {analysis.uses_genai}, Intensity: {analysis.genai_intensity.value}")
            print(f"  -> Patterns: {[p.name for p in analysis.build_patterns]}")
            print(f"  -> Newsletter potential: {analysis.newsletter_potential}")
        except Exception as e:
            print(f"  -> Failed: {e}")

    return results
