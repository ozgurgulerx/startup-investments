"""GenAI detection and analysis using Azure OpenAI."""

import asyncio
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Awaitable, Callable, List, Optional, Tuple
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
    TriState,
    AnalysisSectionState,
    EvidencePacketItem,
    FactLedgerEntry,
    FieldProvenance,
    AnalysisQualityMetrics,
    OpenQuestion,
    CrawlCoverage,
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
from src.pattern_validation import filter_pattern_items
from src.crawler.engine import StartupCrawler, get_company_slug


class AnalysisStageTimeoutError(RuntimeError):
    """Raised when an analysis stage exceeds the configured LLM timeout."""


class GenAIAnalyzer:
    """Analyzes startups for GenAI usage and build patterns."""

    def __init__(self, stage_concurrency: int = 0, stage_timeout_sec: int = 0):
        self._using_aad = False
        self._aad_credential = None
        self._aad_token_provider = None
        self._client_lock = threading.Lock()
        self.client = self._create_azure_client(prefer_key=True)
        self.fast_model = settings.azure_openai.fast_model
        self.reasoning_model = settings.azure_openai.reasoning_model
        self.crawler = StartupCrawler()
        self._vertical_taxonomy_ontology = self._load_vertical_taxonomy_ontology()
        configured_concurrency = stage_concurrency or int(os.getenv("GENAI_ANALYZER_STAGE_CONCURRENCY", "2"))
        configured_timeout = stage_timeout_sec or int(os.getenv("GENAI_ANALYZER_STAGE_TIMEOUT_SEC", "180"))
        self.stage_concurrency = max(1, configured_concurrency)
        self.stage_timeout_sec = max(1, configured_timeout)
        self._stage_semaphore = asyncio.Semaphore(self.stage_concurrency)

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

        evidence_packet, source_search_texts = self._load_evidence_packet(startup.name)
        crawl_coverage = self._build_crawl_coverage(evidence_packet)

        # Run all analyses
        funding_info = f"${startup.funding_amount:,.0f} {startup.funding_type}" if startup.funding_amount else ""
        industries_str = ", ".join(startup.industries)

        first_pass_stages: Dict[str, Callable[[], Awaitable[Dict[str, Any]]]] = {
            "genai": lambda: self._detect_genai(startup.name, content),
            "patterns": lambda: self._detect_patterns(startup.name, content),
            "insights": lambda: self._discover_insights(startup.name, content, funding_info),
            "market": lambda: self._classify_market(
                startup.name, content, startup.description or "", industries_str
            ),
            "competitive": lambda: self._analyze_competitive(
                startup.name, content, startup.description or "", industries_str, funding_info
            ),
            "tech_stack": lambda: self._detect_tech_stack(startup.name, content),
            "engineering": lambda: self._assess_engineering_quality(startup.name, content),
            "vertical": lambda: self._analyze_vertical(
                startup.name, content, startup.description or "", industries_str
            ),
            "vertical_taxonomy": lambda: self._classify_vertical_taxonomy(
                startup.name, content, startup.description or "", industries_str
            ),
            "pattern_discovery": lambda: self._discover_patterns(startup.name, content),
            "team": lambda: self._analyze_team(startup.name, content),
            "business_model": lambda: self._analyze_business_model(startup.name, content, funding_info),
            "product": lambda: self._analyze_product(startup.name, content),
        }

        first_pass_results = await asyncio.gather(
            *[
                self._run_stage(startup.name, stage_name, stage_factory)
                for stage_name, stage_factory in first_pass_stages.items()
            ]
        )
        stage_result_map = dict(zip(first_pass_stages.keys(), first_pass_results))

        genai_result = stage_result_map["genai"]
        patterns_result = stage_result_map["patterns"]
        insights_result = stage_result_map["insights"]
        market_result = stage_result_map["market"]
        competitive_result = stage_result_map["competitive"]
        tech_stack_result = stage_result_map["tech_stack"]
        engineering_result = stage_result_map["engineering"]
        vertical_result = stage_result_map["vertical"]
        vertical_taxonomy_result = stage_result_map["vertical_taxonomy"]
        pattern_discovery_result = stage_result_map["pattern_discovery"]
        team_result = stage_result_map["team"]
        business_model_result = stage_result_map["business_model"]
        product_result = stage_result_map["product"]

        validated_build_patterns = filter_pattern_items(
            patterns_result.get("patterns_detected", []),
            content=content,
        )
        validated_discovered_patterns = filter_pattern_items(
            pattern_discovery_result.get("discovered_patterns", []),
            content=content,
            name_key="pattern_name",
        )

        # Parse intermediate results for story angles
        patterns_str = ", ".join(
            p.get("name", "") for p in validated_build_patterns if p.get("name")
        )
        discovered_patterns_str = ", ".join(
            p.get("pattern_name", "") for p in validated_discovered_patterns if p.get("pattern_name")
        )
        all_patterns_str = f"{patterns_str}, {discovered_patterns_str}".strip(", ")
        tech_stack_str = f"LLMs: {tech_stack_result.get('llm_models', [])}, Approach: {tech_stack_result.get('approach', 'unknown')}"
        vertical_str = vertical_result.get("vertical", "other")
        eng_quality_str = f"Score: {engineering_result.get('score', 0)}/10"

        # Generate story angles based on all analyses
        story_angles_result = await self._run_stage(
            startup.name,
            "story_angles",
            lambda: self._generate_story_angles(
                startup.name,
                content,
                all_patterns_str,
                tech_stack_str,
                vertical_str,
                funding_info,
                eng_quality_str,
            ),
        )

        # Detect anti-patterns
        competitive_str = f"Moat: {competitive_result.get('competitive_moat', 'unknown')}"
        anti_patterns_result = await self._run_stage(
            startup.name,
            "anti_patterns",
            lambda: self._detect_anti_patterns(
                startup.name, content, all_patterns_str, tech_stack_str, competitive_str
            ),
        )

        segmentation = self._resolve_segmentation(
            market_result,
            vertical_result,
            vertical_taxonomy_result,
        )
        team_analysis = self._parse_team_analysis(team_result)
        business_model = self._parse_business_model(business_model_result)
        product_analysis = self._parse_product_analysis(product_result)
        evidence_quotes = self._dedupe_strings(
            genai_result.get("evidence", [])
            + [
                evidence
                for pattern in validated_build_patterns
                for evidence in pattern.get("evidence", [])
            ]
            + [
                evidence
                for pattern in validated_discovered_patterns
                for evidence in pattern.get("evidence", [])
            ]
            + business_model.pricing_model.pricing_evidence
            + business_model.gtm_strategy.evidence
            + product_analysis.stage_evidence
            + product_analysis.use_cases.customer_stories
            + team_analysis.team_strengths,
            limit=20,
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
            build_patterns=self._parse_patterns(validated_build_patterns),
            market_type=segmentation["market_type"],
            vertical=segmentation["vertical"],
            sub_vertical=segmentation["sub_vertical"],
            sub_sub_vertical=segmentation["sub_sub_vertical"],
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
            evidence_quotes=evidence_quotes,
            evidence_packet=evidence_packet,
            crawl_coverage=crawl_coverage,
            confidence_score=genai_result.get("confidence", 0.0),
            raw_content_analyzed=len(content),
            # NEW: Dynamic pattern discovery fields
            discovered_patterns=self._parse_discovered_patterns(
                validated_discovered_patterns
            ),
            model_details=self._parse_model_details(
                pattern_discovery_result.get("model_details", {})
            ),
            novel_approaches=self._parse_novel_approaches(
                pattern_discovery_result.get("novel_approaches", [])
            ),
            implementation_maturity=pattern_discovery_result.get("implementation_maturity", "unknown"),
            # NEW: Business analysis fields
            team_analysis=team_analysis,
            business_model=business_model,
            product_analysis=product_analysis,
        )

        field_provenance = self._build_field_provenance(
            analysis,
            genai_result,
            validated_build_patterns,
            validated_discovered_patterns,
            market_result,
            vertical_result,
            segmentation,
            evidence_packet,
            source_search_texts,
        )
        section_status = self._build_section_status(analysis, field_provenance)
        section_confidence = {
            "genai": genai_result.get("confidence", 0.0),
            "patterns": max(
                [pattern.get("confidence", 0.0) for pattern in validated_build_patterns + validated_discovered_patterns]
                or [0.0]
            ),
            "segmentation": max(
                [
                    path_item.get("confidence", 0.0)
                    for path_item in (vertical_taxonomy_result.get("path", []) if isinstance(vertical_taxonomy_result, dict) else [])
                ] or [0.0]
            ),
            "tech_stack": 0.7 if analysis.tech_stack.approach != "unknown" or analysis.tech_stack.llm_models else 0.0,
            "team": analysis.team_analysis.team_confidence,
            "business_model": analysis.business_model.business_model_confidence,
            "product": analysis.product_analysis.product_confidence,
            "competitive": 0.7 if analysis.competitive_analysis.competitive_moat != "unknown" else 0.0,
            "insights": 0.7 if analysis.unique_findings else 0.0,
            "evidence": 1.0 if evidence_packet else 0.0,
        }

        analysis.field_provenance = field_provenance
        analysis.section_status = section_status
        analysis.quality_metrics = self._build_quality_metrics(
            section_status,
            field_provenance,
            section_confidence,
            contradiction_count=segmentation.get("contradictions", 0),
        )
        analysis.open_questions = self._build_open_questions(analysis)
        analysis.fact_ledger = self._build_fact_ledger(analysis)

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

    async def _run_stage(
        self,
        startup_name: str,
        stage_name: str,
        stage_factory: Callable[[], Awaitable[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        """Run a single analysis stage with bounded concurrency and timeout."""
        stage_started_at = asyncio.get_running_loop().time()
        try:
            async with self._stage_semaphore:
                result = await asyncio.wait_for(
                    stage_factory(),
                    timeout=float(self.stage_timeout_sec),
                )
            elapsed = asyncio.get_running_loop().time() - stage_started_at
            print(
                f"[analysis-stage] startup={startup_name} stage={stage_name} status=ok duration_sec={elapsed:.1f}",
                flush=True,
            )
            return result if isinstance(result, dict) else {}
        except (AnalysisStageTimeoutError, asyncio.TimeoutError) as exc:
            elapsed = asyncio.get_running_loop().time() - stage_started_at
            print(
                f"[analysis-stage] startup={startup_name} stage={stage_name} status=timeout"
                f" category=timeout duration_sec={elapsed:.1f} error={exc}",
                flush=True,
            )
            return {}
        except Exception as exc:
            elapsed = asyncio.get_running_loop().time() - stage_started_at
            print(
                f"[analysis-stage] startup={startup_name} stage={stage_name} status=error"
                f" category=exception duration_sec={elapsed:.1f} error={exc}",
                flush=True,
            )
            return {}

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
                    timeout=float(self.stage_timeout_sec),
                    **llm_kwargs(model, max_tokens=2000, temperature=0.3),
                )
                content = r.choices[0].message.content
                if content:
                    return self._parse_json_response(content)
                return {}

            def _request_with_fallback() -> Dict[str, Any]:
                try:
                    return _do_request()
                except Exception as e:
                    msg = str(e)
                    # If the resource disables API keys, fall back to AAD automatically and retry once.
                    if ("AuthenticationTypeDisabled" in msg or "Key based authentication is disabled" in msg) and not self._using_aad:
                        with self._client_lock:
                            if not self._using_aad:
                                self._ensure_aad_client()
                        return _do_request()
                    raise

            return await asyncio.to_thread(_request_with_fallback)

        except Exception as e:
            if self._is_timeout_exception(e):
                raise AnalysisStageTimeoutError(
                    f"LLM call timed out after {self.stage_timeout_sec}s"
                ) from e
            print(f"LLM call failed: {e}")
            return {}

    async def close(self):
        await self.crawler.close()

    @staticmethod
    def _is_timeout_exception(exc: Exception) -> bool:
        """Best-effort timeout detection across OpenAI/httpx exception types."""
        current: Exception | None = exc
        while current is not None:
            if isinstance(current, (TimeoutError, asyncio.TimeoutError)):
                return True
            text = f"{type(current).__name__}: {current}".lower()
            if "timeout" in text or "timed out" in text:
                return True
            current = current.__cause__ if isinstance(current.__cause__, Exception) else None
        return False

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

    @staticmethod
    def _coerce_string_field(value: Any, default: str = "") -> str:
        """Normalize LLM scalar fields that occasionally come back as lists."""
        if value is None:
            return default
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or default
        if isinstance(value, list):
            parts = [str(item).strip() for item in value if str(item).strip()]
            return ", ".join(parts) if parts else default
        if isinstance(value, (bool, dict)):
            return default
        return str(value)

    @staticmethod
    def _normalize_text(value: Any) -> str:
        text = str(value or "").lower()
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    @staticmethod
    def _dedupe_strings(values: List[Any], limit: Optional[int] = None) -> List[str]:
        deduped: List[str] = []
        seen: set[str] = set()
        for value in values:
            text = str(value or "").strip()
            if not text:
                continue
            key = GenAIAnalyzer._normalize_text(text)
            if not key or key in seen:
                continue
            seen.add(key)
            deduped.append(text)
            if limit is not None and len(deduped) >= limit:
                break
        return deduped

    @staticmethod
    def _ensure_list(value: Any) -> List[Any]:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        if isinstance(value, (tuple, set)):
            return list(value)
        text = str(value).strip()
        return [text] if text else []

    @staticmethod
    def _coerce_confidence(value: Any, default: float = 0.0) -> float:
        try:
            confidence = float(value)
        except Exception:
            confidence = default
        return max(0.0, min(1.0, confidence))

    @staticmethod
    def _coerce_tri_state(value: Any) -> TriState:
        if isinstance(value, TriState):
            return value
        if isinstance(value, bool):
            return TriState.YES if value else TriState.NO
        if isinstance(value, (int, float)):
            return TriState.YES if value else TriState.NO
        normalized = GenAIAnalyzer._normalize_text(value)
        if normalized in {"true", "yes", "y", "1"}:
            return TriState.YES
        if normalized in {"false", "no", "n", "0"}:
            return TriState.NO
        return TriState.UNKNOWN

    @staticmethod
    def _bool_from_tri_state(value: TriState) -> bool:
        return value == TriState.YES

    @staticmethod
    def _detect_source_type(url: str) -> str:
        normalized = str(url or "").lower()
        if normalized.startswith("https://github.com") or "_github" in normalized:
            return "github"
        if normalized.startswith("websearch://") or "_websearch" in normalized:
            return "web_search"
        if normalized.startswith("youtube://") or "_youtube" in normalized:
            return "youtube"
        if normalized.startswith("news://") or "_news" in normalized:
            return "news"
        if "/blog" in normalized or "/engineering" in normalized:
            return "blog"
        if "/docs" in normalized or "/api" in normalized or "/developer" in normalized:
            return "docs"
        return "website"

    @staticmethod
    def _source_confidence(source_type: str) -> float:
        mapping = {
            "website": 0.9,
            "docs": 0.95,
            "github": 0.95,
            "youtube": 0.85,
            "blog": 0.8,
            "news": 0.7,
            "web_search": 0.65,
        }
        return mapping.get(source_type, 0.6)

    @staticmethod
    def _stringify_fact_value(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bool):
            return "yes" if value else "no"
        if hasattr(value, "value"):
            return str(getattr(value, "value"))
        if isinstance(value, list):
            return ", ".join(str(item) for item in value if str(item).strip())
        return str(value).strip()

    def _load_evidence_packet(
        self, company_name: str
    ) -> Tuple[List[EvidencePacketItem], Dict[str, str]]:
        cache_dir = getattr(self.crawler, "cache_dir", None)
        if not cache_dir:
            return [], {}

        cache_path = Path(cache_dir)
        if not cache_path.exists():
            return [], {}

        slug = get_company_slug(company_name)
        alt_slug = company_name.lower().replace(" ", "-")
        candidate_files: List[Path] = []
        for pattern in (f"{slug}_*.json", f"{slug}*.json", f"{alt_slug}_*.json"):
            candidate_files.extend(cache_path.glob(pattern))

        pages_by_url: Dict[str, Dict[str, Any]] = {}
        for cache_file in sorted({path.resolve() for path in candidate_files}):
            try:
                with cache_file.open("r", encoding="utf-8") as handle:
                    data = json.load(handle)
            except Exception:
                continue

            result = data.get("result", {}) if isinstance(data, dict) else {}
            url = str(data.get("url") or "").strip()
            content = str(result.get("content") or "").strip()
            if not url or not content:
                continue

            title = str(result.get("title") or "").strip()
            source_type = str(
                (data.get("source") or {}).get("source_type")
                or result.get("source_type")
                or self._detect_source_type(url)
            ).strip().lower() or "website"
            captured_at = datetime.fromtimestamp(cache_file.stat().st_mtime, tz=timezone.utc)
            existing = pages_by_url.get(url)
            current = {
                "url": url,
                "title": title,
                "content": content,
                "source_type": source_type,
                "captured_at": captured_at,
            }
            if existing is None or len(content) > len(existing["content"]):
                pages_by_url[url] = current

        priority = {"website": 0, "docs": 1, "github": 2, "blog": 3, "news": 4, "web_search": 5}
        ordered_pages = sorted(
            pages_by_url.values(),
            key=lambda page: (priority.get(page["source_type"], 9), page["url"]),
        )

        evidence_packet: List[EvidencePacketItem] = []
        source_search_texts: Dict[str, str] = {}
        for index, page in enumerate(ordered_pages, start=1):
            source_id = f"src_{index}"
            snippet = self._coerce_string_field(page["content"], "")[:600]
            evidence_packet.append(
                EvidencePacketItem(
                    source_id=source_id,
                    source_type=page["source_type"],
                    url=page["url"],
                    title=page["title"],
                    snippet=snippet,
                    captured_at=page["captured_at"],
                    confidence=self._source_confidence(page["source_type"]),
                )
            )
            source_search_texts[source_id] = self._normalize_text(
                f"{page['title']}\n{page['content']}"
            )

        return evidence_packet, source_search_texts

    def _match_evidence_refs(
        self,
        evidence_items: List[Any],
        evidence_packet: List[EvidencePacketItem],
        source_search_texts: Dict[str, str],
        preferred_types: Optional[List[str]] = None,
        limit: int = 3,
    ) -> List[str]:
        refs: List[str] = []
        for item in evidence_items:
            normalized = self._normalize_text(item)
            if len(normalized) < 12:
                continue
            for packet_item in evidence_packet:
                source_text = source_search_texts.get(packet_item.source_id, "")
                if normalized in source_text:
                    refs.append(packet_item.source_id)

        return self._dedupe_strings(refs, limit=limit)

    def _build_crawl_coverage(self, evidence_packet: List[EvidencePacketItem]) -> CrawlCoverage:
        source_type_counts: Dict[str, int] = {}
        for packet_item in evidence_packet:
            source_type_counts[packet_item.source_type] = source_type_counts.get(packet_item.source_type, 0) + 1

        enrichment_enabled = {
            "web_search": settings.crawler.enable_web_search,
            "github": settings.crawler.enable_github,
            "news": settings.crawler.enable_news,
            "youtube": settings.crawler.enable_youtube,
        }
        expected_types = ["website", "docs", "blog"]
        expected_types.extend(
            source_type
            for source_type, enabled in enrichment_enabled.items()
            if enabled and source_type not in expected_types
        )
        missing_source_types = [
            source_type
            for source_type in expected_types
            if source_type_counts.get(source_type, 0) == 0
        ]

        return CrawlCoverage(
            pages_crawled=len(evidence_packet),
            source_type_counts=source_type_counts,
            seen_source_types=sorted(source_type_counts.keys()),
            missing_source_types=missing_source_types,
            enrichment_enabled=enrichment_enabled,
            website_available=source_type_counts.get("website", 0) > 0,
            docs_available=source_type_counts.get("docs", 0) > 0,
            blog_available=source_type_counts.get("blog", 0) > 0,
            github_available=source_type_counts.get("github", 0) > 0,
        )

    def _resolve_segmentation(
        self,
        market_result: Dict[str, Any],
        vertical_result: Dict[str, Any],
        vertical_taxonomy_result: Dict[str, Any],
    ) -> Dict[str, Any]:
        taxonomy_primary = vertical_taxonomy_result.get("primary", {}) if isinstance(vertical_taxonomy_result, dict) else {}
        taxonomy_vertical = taxonomy_primary.get("vertical_id") or taxonomy_primary.get("vertical_label")
        taxonomy_sub_vertical = taxonomy_primary.get("sub_vertical_label")
        taxonomy_leaf = taxonomy_primary.get("leaf_label")

        fallback_vertical = self._parse_vertical(str(vertical_result.get("vertical", "other")))
        taxonomy_vertical_enum = self._parse_vertical_taxonomy_value(taxonomy_vertical)
        canonical_vertical = taxonomy_vertical_enum or fallback_vertical

        vertical_from_stage = self._normalize_text(vertical_result.get("vertical"))
        vertical_from_taxonomy = self._normalize_text(taxonomy_vertical)

        contradictions = 0
        if taxonomy_vertical_enum and vertical_from_stage and vertical_from_taxonomy and vertical_from_stage != vertical_from_taxonomy:
            contradictions += 1

        market_type = self._parse_market_type(market_result.get("market_type", "horizontal"))
        if taxonomy_primary.get("vertical_id") and canonical_vertical != Vertical.OTHER:
            market_type = MarketType.VERTICAL

        market_signal = self._normalize_text(market_result.get("market_type"))
        if market_signal == "horizontal" and taxonomy_primary.get("vertical_id"):
            contradictions += 1

        sub_vertical = self._coerce_string_field(
            taxonomy_sub_vertical
            or vertical_result.get("sub_vertical")
            or market_result.get("sub_vertical"),
            "",
        ) or None
        sub_sub_vertical = self._coerce_string_field(
            taxonomy_leaf
            or vertical_result.get("sub_sub_vertical")
            or market_result.get("sub_sub_vertical"),
            "",
        ) or None
        if sub_sub_vertical and sub_sub_vertical == sub_vertical:
            sub_sub_vertical = None

        return {
            "market_type": market_type,
            "vertical": canonical_vertical,
            "sub_vertical": sub_vertical,
            "sub_sub_vertical": sub_sub_vertical,
            "contradictions": contradictions,
            "taxonomy_override": bool(taxonomy_primary.get("vertical_id")),
        }

    @staticmethod
    def _normalize_vertical_taxonomy_key(value: Any) -> str:
        normalized = GenAIAnalyzer._normalize_text(value)
        normalized = re.sub(r"[^a-z0-9]+", "_", normalized)
        return normalized.strip("_")

    def _parse_vertical_taxonomy_value(self, value: Any) -> Optional[Vertical]:
        key = self._normalize_vertical_taxonomy_key(value)
        if not key:
            return None

        alias_mapping = {
            "it_enterprise_software": Vertical.ENTERPRISE_SAAS,
            "enterprise_software": Vertical.ENTERPRISE_SAAS,
            "healthcare_life_sciences": Vertical.HEALTHCARE,
            "healthcare": Vertical.HEALTHCARE,
            "industrial_manufacturing": Vertical.INDUSTRIAL,
            "industrial": Vertical.INDUSTRIAL,
            "developer_tools": Vertical.DEVELOPER_TOOLS,
            "developer_tooling": Vertical.DEVELOPER_TOOLS,
            "financial_services": Vertical.FINANCIAL_SERVICES,
            "fintech": Vertical.FINANCIAL_SERVICES,
            "hr_recruiting": Vertical.HR_RECRUITING,
            "hr": Vertical.HR_RECRUITING,
            "education": Vertical.EDUCATION,
            "marketing": Vertical.MARKETING,
            "cybersecurity": Vertical.CYBERSECURITY,
            "ecommerce": Vertical.ECOMMERCE,
            "consumer": Vertical.CONSUMER,
            "media_content": Vertical.MEDIA_CONTENT,
            "enterprise_saas": Vertical.ENTERPRISE_SAAS,
        }
        if key in alias_mapping:
            return alias_mapping[key]

        return self._parse_vertical(key)

    @staticmethod
    def _section_state(has_data: bool, has_evidence: bool) -> AnalysisSectionState:
        if has_data and has_evidence:
            return AnalysisSectionState.OK
        if has_data:
            return AnalysisSectionState.PARTIAL
        return AnalysisSectionState.MISSING

    def _build_field_provenance(
        self,
        analysis: StartupAnalysis,
        genai_result: Dict[str, Any],
        validated_build_patterns: List[Dict[str, Any]],
        validated_discovered_patterns: List[Dict[str, Any]],
        market_result: Dict[str, Any],
        vertical_result: Dict[str, Any],
        segmentation: Dict[str, Any],
        evidence_packet: List[EvidencePacketItem],
        source_search_texts: Dict[str, str],
    ) -> Dict[str, FieldProvenance]:
        pattern_evidence = [
            evidence
            for pattern in validated_build_patterns
            for evidence in pattern.get("evidence", [])
        ]
        discovered_pattern_evidence = [
            evidence
            for pattern in validated_discovered_patterns
            for evidence in pattern.get("evidence", [])
        ]

        def make_provenance(
            evidence_items: Any,
            *,
            confidence: Any,
            preferred_types: Optional[List[str]] = None,
            notes: str = "",
        ) -> FieldProvenance:
            evidence_list = self._ensure_list(evidence_items)
            refs = self._match_evidence_refs(
                evidence_list,
                evidence_packet,
                source_search_texts,
                preferred_types=preferred_types,
            ) if evidence_packet else []
            return FieldProvenance(
                evidence_refs=refs,
                source_count=len(refs),
                confidence=self._coerce_confidence(confidence),
                notes=notes,
            )

        taxonomy_note = "taxonomy-derived" if segmentation.get("taxonomy_override") else ""

        return {
            "uses_genai": make_provenance(
                genai_result.get("evidence", []),
                confidence=genai_result.get("confidence", 0.0),
                preferred_types=["website", "docs", "github"],
            ),
            "genai_intensity": make_provenance(
                genai_result.get("evidence", []),
                confidence=genai_result.get("confidence", 0.0),
                preferred_types=["website", "docs", "github"],
            ),
            "build_patterns": make_provenance(
                pattern_evidence + discovered_pattern_evidence,
                confidence=max(
                    [pattern.get("confidence", 0.0) for pattern in validated_build_patterns + validated_discovered_patterns]
                    or [0.0]
                ),
                preferred_types=["docs", "github", "website"],
            ),
            "market_type": make_provenance(
                market_result.get("evidence", []),
                confidence=0.7 if analysis.market_type != MarketType.HORIZONTAL else 0.5,
                preferred_types=["website", "docs"],
                notes=taxonomy_note,
            ),
            "vertical": make_provenance(
                vertical_result.get("evidence", []),
                confidence=0.8 if analysis.vertical != Vertical.OTHER else 0.4,
                preferred_types=["website", "docs"],
                notes=taxonomy_note,
            ),
            "target_market": make_provenance(
                market_result.get("evidence", []),
                confidence=0.6 if analysis.target_market != TargetMarket.UNKNOWN else 0.0,
                preferred_types=["website", "docs"],
            ),
            "tech_stack": make_provenance(
                analysis.tech_stack.llm_models
                + analysis.tech_stack.frameworks
                + analysis.tech_stack.vector_databases,
                confidence=0.7 if analysis.tech_stack.approach != "unknown" else 0.0,
                preferred_types=["docs", "github", "website"],
            ),
            "competitive_moat": make_provenance(
                analysis.competitive_analysis.secret_sauce.evidence,
                confidence=0.7 if analysis.competitive_analysis.competitive_moat != "unknown" else 0.3,
                preferred_types=["website", "blog", "docs"],
            ),
            "team_analysis": make_provenance(
                analysis.team_analysis.team_strengths
                + analysis.team_analysis.team_red_flags
                + analysis.team_analysis.team_signals.hiring_signals,
                confidence=analysis.team_analysis.team_confidence,
                preferred_types=["website", "blog", "github"],
            ),
            "pricing_model": make_provenance(
                analysis.business_model.pricing_model.pricing_evidence,
                confidence=analysis.business_model.business_model_confidence,
                preferred_types=["website", "docs"],
            ),
            "product_stage": make_provenance(
                analysis.product_analysis.stage_evidence,
                confidence=analysis.product_analysis.product_confidence,
                preferred_types=["website", "docs", "blog"],
            ),
            "primary_use_case": make_provenance(
                analysis.product_analysis.use_cases.customer_stories
                + analysis.product_analysis.feature_depth.differentiating_features,
                confidence=analysis.product_analysis.product_confidence,
                preferred_types=["website", "docs"],
            ),
            "insights": make_provenance(
                analysis.unique_findings + analysis.evidence_quotes,
                confidence=0.7 if analysis.unique_findings else 0.0,
                preferred_types=["website", "docs", "blog"],
            ),
        }

    def _build_section_status(
        self,
        analysis: StartupAnalysis,
        field_provenance: Dict[str, FieldProvenance],
    ) -> Dict[str, AnalysisSectionState]:
        return {
            "genai": self._section_state(
                analysis.genai_intensity != GenAIIntensity.UNCLEAR
                or bool(analysis.models_mentioned),
                bool(field_provenance["uses_genai"].evidence_refs),
            ),
            "patterns": self._section_state(
                bool(analysis.build_patterns or analysis.discovered_patterns or analysis.novel_approaches),
                bool(field_provenance["build_patterns"].evidence_refs),
            ),
            "segmentation": self._section_state(
                analysis.vertical != Vertical.OTHER
                or bool(analysis.sub_vertical)
                or analysis.target_market != TargetMarket.UNKNOWN,
                bool(
                    field_provenance["vertical"].evidence_refs
                    or field_provenance["market_type"].evidence_refs
                ),
            ),
            "tech_stack": self._section_state(
                bool(
                    analysis.tech_stack.llm_models
                    or analysis.tech_stack.frameworks
                    or analysis.tech_stack.vector_databases
                    or analysis.tech_stack.approach != "unknown"
                ),
                analysis.crawl_coverage.docs_available or analysis.crawl_coverage.github_available,
            ),
            "team": self._section_state(
                bool(
                    analysis.team_analysis.founders
                    or analysis.team_analysis.team_strengths
                    or analysis.team_analysis.team_signals.hiring_signals
                ),
                bool(field_provenance["team_analysis"].evidence_refs),
            ),
            "business_model": self._section_state(
                bool(
                    analysis.business_model.pricing_model.type != "unknown"
                    or analysis.business_model.gtm_strategy.primary_channel != "unknown"
                    or analysis.business_model.revenue_model.monetization_approach
                ),
                bool(field_provenance["pricing_model"].evidence_refs),
            ),
            "product": self._section_state(
                bool(
                    analysis.product_analysis.use_cases.primary_use_case
                    or analysis.product_analysis.feature_depth.core_features
                    or analysis.product_analysis.product_stage != "unknown"
                ),
                bool(
                    field_provenance["product_stage"].evidence_refs
                    or field_provenance["primary_use_case"].evidence_refs
                ),
            ),
            "competitive": self._section_state(
                bool(
                    analysis.competitive_analysis.competitors
                    or analysis.competitive_analysis.differentiation.primary
                    or analysis.competitive_analysis.competitive_moat != "unknown"
                ),
                bool(field_provenance["competitive_moat"].evidence_refs),
            ),
            "insights": self._section_state(
                bool(analysis.unique_findings or analysis.story_angles or analysis.anti_patterns),
                bool(analysis.evidence_quotes),
            ),
            "evidence": self._section_state(
                bool(analysis.evidence_packet),
                bool(analysis.evidence_packet),
            ),
        }

    def _build_quality_metrics(
        self,
        section_status: Dict[str, AnalysisSectionState],
        field_provenance: Dict[str, FieldProvenance],
        section_confidence: Dict[str, float],
        contradiction_count: int,
    ) -> AnalysisQualityMetrics:
        section_field_map = {
            "genai": ["uses_genai", "genai_intensity"],
            "patterns": ["build_patterns"],
            "segmentation": ["market_type", "vertical", "target_market"],
            "tech_stack": ["tech_stack"],
            "team": ["team_analysis"],
            "business_model": ["pricing_model"],
            "product": ["product_stage", "primary_use_case"],
            "competitive": ["competitive_moat"],
            "insights": ["insights"],
            "evidence": [],
        }
        sections_total = len(section_status)
        ok_count = sum(1 for status in section_status.values() if status == AnalysisSectionState.OK)
        partial_count = sum(1 for status in section_status.values() if status == AnalysisSectionState.PARTIAL)
        sections_with_evidence = sum(
            1
            for section, fields in section_field_map.items()
            if any(field_provenance.get(field, FieldProvenance()).source_count > 0 for field in fields)
        )
        total_refs = sum(len(provenance.evidence_refs) for provenance in field_provenance.values())
        low_evidence_sections = [
            section
            for section, status in section_status.items()
            if status != AnalysisSectionState.MISSING and section_confidence.get(section, 0.0) >= 0.5
            and not any(field_provenance.get(field, FieldProvenance()).source_count > 0 for field in section_field_map.get(section, []))
        ]

        return AnalysisQualityMetrics(
            coverage_score=round((ok_count + (0.5 * partial_count)) / max(sections_total, 1), 3),
            evidence_density=round(total_refs / max(sections_total, 1), 3),
            contradiction_count=contradiction_count,
            confidence_by_section={
                key: self._coerce_confidence(value)
                for key, value in section_confidence.items()
            },
            sections_with_evidence=sections_with_evidence,
            sections_total=sections_total,
            low_evidence_sections=low_evidence_sections,
        )

    def _build_open_questions(self, analysis: StartupAnalysis) -> List[OpenQuestion]:
        questions: List[OpenQuestion] = []

        def add(section: str, question: str, reason: str) -> None:
            if len(questions) >= 8:
                return
            questions.append(OpenQuestion(section=section, question=question, reason=reason))

        if analysis.crawl_coverage.pages_crawled < 3:
            add("evidence", "Can we expand crawl coverage beyond the primary marketing site?", "Low page count reduces evidence depth.")
        if not analysis.crawl_coverage.docs_available:
            add("tech_stack", "Is there technical documentation or API evidence available?", "Docs coverage is missing.")
        if not analysis.team_analysis.founders:
            add("team", "Who are the founders and what is their prior operating history?", "Founder identity was not established from the crawl.")
        if not analysis.business_model.pricing_model.pricing_evidence:
            add("business_model", "What pricing or packaging evidence exists for this startup?", "Pricing model lacks direct evidence.")
        if analysis.product_analysis.product_stage == "unknown" or not analysis.product_analysis.stage_evidence:
            add("product", "What evidence confirms product maturity and rollout stage?", "Product stage is weakly supported.")
        if analysis.uses_genai and not analysis.field_provenance.get("uses_genai", FieldProvenance()).source_count:
            add("genai", "Which source directly confirms the GenAI implementation claim?", "GenAI claim lacks matched evidence refs.")
        if analysis.vertical == Vertical.OTHER and not analysis.sub_vertical:
            add("segmentation", "What source best anchors the vertical classification?", "Taxonomy and heuristic classification remain weak.")

        return questions

    def _build_fact_ledger(self, analysis: StartupAnalysis) -> Dict[str, List[FactLedgerEntry]]:
        ledger: Dict[str, List[FactLedgerEntry]] = {}

        def add(topic: str, label: str, value: Any, provenance_key: str, confidence: float = 0.0) -> None:
            string_value = self._stringify_fact_value(value)
            if not string_value:
                return
            provenance = analysis.field_provenance.get(provenance_key, FieldProvenance())
            ledger.setdefault(topic, []).append(
                FactLedgerEntry(
                    topic=topic,
                    label=label,
                    value=string_value,
                    evidence_refs=provenance.evidence_refs,
                    source_count=provenance.source_count,
                    confidence=self._coerce_confidence(confidence or provenance.confidence),
                )
            )

        add("company", "name", analysis.company_name, "team_analysis", confidence=1.0)
        add("company", "website", analysis.website, "team_analysis", confidence=1.0)
        add("company", "description", analysis.description, "team_analysis", confidence=0.8)
        add("genai", "uses_genai", analysis.uses_genai, "uses_genai", confidence=analysis.confidence_score)
        add("genai", "genai_intensity", analysis.genai_intensity, "genai_intensity", confidence=analysis.confidence_score)
        add("genai", "models_mentioned", analysis.models_mentioned, "uses_genai", confidence=analysis.confidence_score)
        add("segmentation", "market_type", analysis.market_type, "market_type", confidence=0.7)
        add("segmentation", "vertical", analysis.vertical, "vertical", confidence=0.8)
        add("segmentation", "sub_vertical", analysis.sub_vertical, "vertical", confidence=0.8)
        add("segmentation", "target_market", analysis.target_market, "target_market", confidence=0.6)
        add("team", "founders", [founder.name for founder in analysis.team_analysis.founders], "team_analysis", confidence=analysis.team_analysis.team_confidence)
        add("team", "founder_market_fit", analysis.team_analysis.founder_market_fit, "team_analysis", confidence=analysis.team_analysis.team_confidence)
        add("business_model", "pricing_type", analysis.business_model.pricing_model.type, "pricing_model", confidence=analysis.business_model.business_model_confidence)
        add("business_model", "gtm_channel", analysis.business_model.gtm_strategy.primary_channel, "pricing_model", confidence=analysis.business_model.business_model_confidence)
        add("business_model", "target_segment", analysis.business_model.gtm_strategy.target_segment, "pricing_model", confidence=analysis.business_model.business_model_confidence)
        add("product", "product_stage", analysis.product_analysis.product_stage, "product_stage", confidence=analysis.product_analysis.product_confidence)
        add("product", "primary_use_case", analysis.product_analysis.use_cases.primary_use_case, "primary_use_case", confidence=analysis.product_analysis.product_confidence)
        add("product", "core_features", analysis.product_analysis.feature_depth.core_features, "primary_use_case", confidence=analysis.product_analysis.product_confidence)
        add("competition", "competitive_moat", analysis.competitive_analysis.competitive_moat, "competitive_moat", confidence=0.7)
        add("competition", "core_advantage", analysis.competitive_analysis.secret_sauce.core_advantage, "competitive_moat", confidence=0.7)
        add("risks", "anti_patterns", [pattern.description for pattern in analysis.anti_patterns], "build_patterns", confidence=0.5)
        add("risks", "product_risks", analysis.product_analysis.product_risks, "product_stage", confidence=analysis.product_analysis.product_confidence)
        add("risks", "team_red_flags", analysis.team_analysis.team_red_flags, "team_analysis", confidence=analysis.team_analysis.team_confidence)

        return ledger

    def _parse_tech_stack(self, data: Dict[str, Any]) -> TechStack:
        """Parse tech stack result to TechStack model."""
        return TechStack(
            llm_providers=data.get("llm_providers", []),
            llm_models=data.get("llm_models", []),
            vector_databases=data.get("vector_databases", []),
            frameworks=data.get("frameworks", []),
            hosting=data.get("hosting", []),
            approach=self._coerce_string_field(data.get("approach"), "unknown"),
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
        engineering_heavy_status = self._coerce_tri_state(
            team_signals_data.get("engineering_heavy_status", team_signals_data.get("engineering_heavy"))
        )
        has_ml_expertise_status = self._coerce_tri_state(
            team_signals_data.get("has_ml_expertise_status", team_signals_data.get("has_ml_expertise"))
        )
        has_domain_expertise_status = self._coerce_tri_state(
            team_signals_data.get("has_domain_expertise_status", team_signals_data.get("has_domain_expertise"))
        )
        remote_distributed_status = self._coerce_tri_state(
            team_signals_data.get("remote_distributed_status", team_signals_data.get("remote_distributed"))
        )
        team_signals = TeamSignals(
            engineering_heavy=self._bool_from_tri_state(engineering_heavy_status),
            engineering_heavy_status=engineering_heavy_status,
            has_ml_expertise=self._bool_from_tri_state(has_ml_expertise_status),
            has_ml_expertise_status=has_ml_expertise_status,
            has_domain_expertise=self._bool_from_tri_state(has_domain_expertise_status),
            has_domain_expertise_status=has_domain_expertise_status,
            hiring_signals=team_signals_data.get("hiring_signals", []),
            team_size_indicators=team_signals_data.get("team_size_indicators", "unknown"),
            remote_distributed=self._bool_from_tri_state(remote_distributed_status),
            remote_distributed_status=remote_distributed_status,
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
