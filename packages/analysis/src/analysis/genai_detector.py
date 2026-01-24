"""GenAI detection and analysis using Azure OpenAI."""

import json
import re
from typing import Dict, Any, List
from openai import AzureOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from src.config import settings
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
)
from src.crawler.engine import StartupCrawler


class GenAIAnalyzer:
    """Analyzes startups for GenAI usage and build patterns."""

    def __init__(self):
        self.client = AzureOpenAI(
            api_key=settings.azure_openai.api_key,
            api_version=settings.azure_openai.api_version,
            azure_endpoint=settings.azure_openai.endpoint,
        )
        self.fast_model = settings.azure_openai.fast_model
        self.reasoning_model = settings.azure_openai.reasoning_model
        self.crawler = StartupCrawler()

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

        # Enhanced analyses (new)
        tech_stack_result = await self._detect_tech_stack(startup.name, content)
        engineering_result = await self._assess_engineering_quality(startup.name, content)
        vertical_result = await self._analyze_vertical(
            startup.name, content, startup.description or "", industries_str
        )

        # Parse intermediate results for story angles
        patterns_str = ", ".join([p.get("name", "") for p in patterns_result.get("patterns_detected", [])])
        tech_stack_str = f"LLMs: {tech_stack_result.get('llm_models', [])}, Approach: {tech_stack_result.get('approach', 'unknown')}"
        vertical_str = vertical_result.get("vertical", "other")
        eng_quality_str = f"Score: {engineering_result.get('score', 0)}/10"

        # Generate story angles based on all analyses
        story_angles_result = await self._generate_story_angles(
            startup.name, content, patterns_str, tech_stack_str, vertical_str, funding_info, eng_quality_str
        )

        # Detect anti-patterns
        competitive_str = f"Moat: {competitive_result.get('competitive_moat', 'unknown')}"
        anti_patterns_result = await self._detect_anti_patterns(
            startup.name, content, patterns_str, tech_stack_str, competitive_str
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

    async def _call_llm(self, prompt: str, use_reasoning: bool = False) -> Dict[str, Any]:
        """Call Azure OpenAI and parse JSON response."""
        model = self.reasoning_model if use_reasoning else self.fast_model

        try:
            response = self.client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a technical analyst. Always respond with valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=2000,
            )

            content = response.choices[0].message.content
            if content:
                # Try to extract JSON from response
                return self._parse_json_response(content)
            return {}

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
