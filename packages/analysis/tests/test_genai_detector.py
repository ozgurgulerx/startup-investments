import asyncio
import json
import threading

import pytest

from src.analysis.genai_detector import AnalysisStageTimeoutError, GenAIAnalyzer
from src.data.models import AnalysisSectionState, CrawlCoverage, EvidencePacketItem, IntegrationEcosystem, StartupInput, TriState, Vertical
from src.pattern_validation import MICRO_MODEL_MESHES_NAME, pattern_is_allowed


class _TimeoutingCompletions:
    def __init__(self):
        self.last_kwargs = None

    def create(self, **kwargs):
        self.last_kwargs = kwargs
        raise TimeoutError("request timed out")


class _TimeoutingChat:
    def __init__(self):
        self.completions = _TimeoutingCompletions()


class _TimeoutingClient:
    def __init__(self):
        self.chat = _TimeoutingChat()


def _build_analyzer(timeout_sec: int = 42) -> GenAIAnalyzer:
    analyzer = GenAIAnalyzer.__new__(GenAIAnalyzer)
    analyzer._using_aad = False
    analyzer._aad_credential = None
    analyzer._aad_token_provider = None
    analyzer._client_lock = threading.Lock()
    analyzer.client = _TimeoutingClient()
    analyzer.fast_model = "gpt-5-nano"
    analyzer.reasoning_model = "gpt-5-nano"
    analyzer.stage_timeout_sec = timeout_sec
    analyzer.stage_concurrency = 1
    analyzer._stage_semaphore = asyncio.Semaphore(1)
    analyzer.crawler = None
    return analyzer


def test_call_llm_raises_stage_timeout_and_passes_request_timeout():
    analyzer = _build_analyzer(timeout_sec=37)

    with pytest.raises(AnalysisStageTimeoutError):
        asyncio.run(analyzer._call_llm("hello", use_reasoning=False))

    assert analyzer.client.chat.completions.last_kwargs["timeout"] == 37.0


def test_run_stage_degrades_timeout_failures_to_empty_payload():
    analyzer = _build_analyzer()

    async def timed_out_stage():
        raise AnalysisStageTimeoutError("LLM call timed out after 42s")

    parsed = asyncio.run(analyzer._run_stage("Acme AI", "genai", timed_out_stage))

    assert parsed == {}


def test_llm_model_coerces_boolean_list_fields_to_empty_lists():
    parsed = IntegrationEcosystem(marketplace_presence=False, sdk_availability=True)

    assert parsed.marketplace_presence == []
    assert parsed.sdk_availability == []


def test_parse_tech_stack_coerces_list_approach_to_string():
    analyzer = _build_analyzer()

    parsed = analyzer._parse_tech_stack({"approach": ["rag", "prompt_engineering"]})

    assert parsed.approach == "rag, prompt_engineering"


def test_parse_team_analysis_preserves_unknown_tri_state():
    analyzer = _build_analyzer()

    parsed = analyzer._parse_team_analysis(
        {
            "team_signals": {
                "engineering_heavy": "unknown",
                "has_ml_expertise": "yes",
                "has_domain_expertise": False,
                "remote_distributed": "unknown",
            }
        }
    )

    assert parsed.team_signals.engineering_heavy is False
    assert parsed.team_signals.engineering_heavy_status == TriState.UNKNOWN
    assert parsed.team_signals.has_ml_expertise is True
    assert parsed.team_signals.has_ml_expertise_status == TriState.YES
    assert parsed.team_signals.has_domain_expertise is False
    assert parsed.team_signals.has_domain_expertise_status == TriState.NO
    assert parsed.team_signals.remote_distributed is False
    assert parsed.team_signals.remote_distributed_status == TriState.UNKNOWN


def test_match_evidence_refs_returns_empty_on_no_match():
    analyzer = _build_analyzer()
    refs = analyzer._match_evidence_refs(
        ["claim that never appears"],
        [
            EvidencePacketItem(source_id="src_1", source_type="docs", url="https://acme.ai/docs", title="Docs", snippet=""),
        ],
        {"src_1": "completely different source text"},
        preferred_types=["docs"],
    )

    assert refs == []


def test_resolve_segmentation_maps_taxonomy_ids_to_legacy_verticals():
    analyzer = _build_analyzer()

    resolved = analyzer._resolve_segmentation(
        {"market_type": "vertical", "target_market": "b2b"},
        {"vertical": "other"},
        {
            "primary": {
                "vertical_id": "it_enterprise_software",
                "vertical_label": "IT Enterprise Software",
                "sub_vertical_label": "Enterprise Software",
                "leaf_label": "Workflow Automation",
            }
        },
    )

    assert resolved["vertical"] == Vertical.ENTERPRISE_SAAS
    assert resolved["sub_vertical"] == "Enterprise Software"
    assert resolved["sub_sub_vertical"] == "Workflow Automation"


def test_detect_source_type_and_crawl_coverage_include_youtube():
    analyzer = _build_analyzer()

    assert analyzer._detect_source_type("youtube://Acme AI") == "youtube"

    coverage = analyzer._build_crawl_coverage(
        [
            EvidencePacketItem(
                source_id="src_1",
                source_type="youtube",
                url="youtube://Acme AI",
                title="YouTube Videos",
                snippet="",
            )
        ]
    )

    assert isinstance(coverage, CrawlCoverage)
    assert coverage.pages_crawled == 1
    assert coverage.source_type_counts["youtube"] == 1
    assert coverage.enrichment_enabled["youtube"] is True


def test_micro_model_meshes_requires_explicit_strong_evidence():
    assert pattern_is_allowed(
        MICRO_MODEL_MESHES_NAME,
        0.9,
        ["The system uses a mixture of experts router to dispatch requests."],
        "Routes requests across an ensemble of models.",
    )
    assert not pattern_is_allowed(
        MICRO_MODEL_MESHES_NAME,
        0.9,
        ["Supports voice, video, and SMS workflows."],
        "Multiple modalities imply specialization.",
    )
    assert not pattern_is_allowed(
        MICRO_MODEL_MESHES_NAME,
        0.5,
        ["Uses a mixture of experts router."],
        "Explicit routing exists but confidence is too low.",
    )


class _FakeCrawler:
    def __init__(self, content: str):
        self._content = content

    def get_all_cached_content(self, _company_name: str) -> str:
        return self._content

    async def crawl_startup(self, startup: StartupInput):
        return []

    async def close(self):
        return None


def test_analyze_startup_filters_weak_micro_model_meshes_before_story_prompts(monkeypatch):
    content = "Supports voice, video, SMS, and workflow automation for recruiting teams."
    monkeypatch.setattr(
        "src.analysis.genai_detector.StartupCrawler",
        lambda: _FakeCrawler(content),
    )
    analyzer = GenAIAnalyzer(stage_concurrency=1, stage_timeout_sec=5)

    analyzer._detect_genai = lambda *args, **kwargs: asyncio.sleep(
        0, result={"uses_genai": True, "genai_intensity": "core", "confidence": 0.8, "models_mentioned": [], "evidence": []}
    )
    analyzer._detect_patterns = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={
            "patterns_detected": [
                {
                    "name": MICRO_MODEL_MESHES_NAME,
                    "confidence": 0.8,
                    "evidence": ["Voice, video, and SMS modalities."],
                    "description": "Multiple modalities imply specialized models.",
                },
                {
                    "name": "Vertical Data Moats",
                    "confidence": 0.9,
                    "evidence": ["Uses proprietary hiring data."],
                    "description": "Owns recruiter performance data.",
                },
            ],
            "technical_depth": "medium",
            "novel_approaches": [],
        },
    )
    analyzer._discover_insights = lambda *args, **kwargs: asyncio.sleep(
        0, result={"unique_findings": [], "newsletter_potential": "medium"}
    )
    analyzer._classify_market = lambda *args, **kwargs: asyncio.sleep(
        0, result={"market_type": "horizontal", "target_market": "b2b"}
    )
    analyzer._analyze_competitive = lambda *args, **kwargs: asyncio.sleep(
        0, result={"competitors": [], "differentiation": {}, "secret_sauce": {}, "competitive_moat": "unknown"}
    )
    analyzer._detect_tech_stack = lambda *args, **kwargs: asyncio.sleep(0, result={})
    analyzer._assess_engineering_quality = lambda *args, **kwargs: asyncio.sleep(0, result={"score": 5})
    analyzer._analyze_vertical = lambda *args, **kwargs: asyncio.sleep(0, result={"vertical": "other"})
    analyzer._classify_vertical_taxonomy = lambda *args, **kwargs: asyncio.sleep(0, result={})
    analyzer._discover_patterns = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={
            "discovered_patterns": [
                {
                    "pattern_name": MICRO_MODEL_MESHES_NAME,
                    "category": "Model Architecture",
                    "confidence": 0.9,
                    "evidence": ["Multiple workflows and communication channels."],
                    "description": "Likely specialized models for each workflow.",
                    "novelty_score": 5,
                    "why_notable": "",
                }
            ],
            "model_details": {},
            "novel_approaches": [],
            "implementation_maturity": "unknown",
        },
    )
    analyzer._analyze_team = lambda *args, **kwargs: asyncio.sleep(0, result={})
    analyzer._analyze_business_model = lambda *args, **kwargs: asyncio.sleep(0, result={})
    analyzer._analyze_product = lambda *args, **kwargs: asyncio.sleep(0, result={})

    captured = {}

    async def _story_angles(_company, _content, patterns, *_args):
        captured["story_patterns"] = patterns
        return {"story_angles": []}

    async def _anti_patterns(_company, _content, patterns, *_args):
        captured["anti_patterns"] = patterns
        return {"anti_patterns": []}

    analyzer._generate_story_angles = _story_angles
    analyzer._detect_anti_patterns = _anti_patterns

    analysis = asyncio.run(
        analyzer.analyze_startup(
            StartupInput(name="Meshless AI", website="https://meshless.ai", description="Recruiting automation")
        )
    )

    assert [pattern.name for pattern in analysis.build_patterns] == ["Vertical Data Moats"]
    assert not analysis.discovered_patterns
    assert MICRO_MODEL_MESHES_NAME not in captured["story_patterns"]
    assert MICRO_MODEL_MESHES_NAME not in captured["anti_patterns"]
    asyncio.run(analyzer.close())


def test_analyze_startup_populates_v2_metadata_without_breaking_legacy_fields(monkeypatch, tmp_path):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    cache_dir.joinpath("acme-ai_1.json").write_text(
        json.dumps(
            {
                "url": "https://acme.ai/docs/platform",
                "result": {
                    "title": "Platform Docs",
                    "content": (
                        "Acme AI uses GPT-4 to automate compliance workflows for banks. "
                        "Pricing starts with enterprise plans. Available for enterprise deployments."
                    ),
                },
            }
        ),
        encoding="utf-8",
    )

    class _CacheCrawler:
        def __init__(self):
            self.cache_dir = cache_dir

        def get_all_cached_content(self, _company_name: str) -> str:
            return (
                "Acme AI uses GPT-4 to automate compliance workflows for banks. "
                "Pricing starts with enterprise plans. Available for enterprise deployments."
            )

        async def crawl_startup(self, startup: StartupInput):
            return []

        async def close(self):
            return None

    monkeypatch.setattr("src.analysis.genai_detector.StartupCrawler", lambda: _CacheCrawler())
    analyzer = GenAIAnalyzer(stage_concurrency=1, stage_timeout_sec=5)

    analyzer._detect_genai = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={
            "uses_genai": True,
            "genai_intensity": "core",
            "confidence": 0.9,
            "models_mentioned": ["GPT-4"],
            "evidence": ["Acme AI uses GPT-4 to automate compliance workflows for banks"],
        },
    )
    analyzer._detect_patterns = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={
            "patterns_detected": [
                {
                    "name": "RAG",
                    "confidence": 0.8,
                    "evidence": ["compliance workflows for banks"],
                    "description": "Retrieval-backed compliance automation.",
                }
            ],
            "technical_depth": "high",
            "novel_approaches": [],
        },
    )
    analyzer._discover_insights = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={"unique_findings": ["Targets regulated financial workflows"], "newsletter_potential": "high"},
    )
    analyzer._classify_market = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={"market_type": "horizontal", "target_market": "b2b"},
    )
    analyzer._analyze_competitive = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={
            "competitors": [],
            "differentiation": {"primary": "Compliance-first workflow automation"},
            "secret_sauce": {
                "core_advantage": "Compliance workflow coverage",
                "defensibility": "Embedded in regulated processes",
                "evidence": ["compliance workflows for banks"],
            },
            "competitive_moat": "medium",
        },
    )
    analyzer._detect_tech_stack = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={"llm_models": ["GPT-4"], "frameworks": ["LangChain"], "approach": "rag"},
    )
    analyzer._assess_engineering_quality = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={"score": 7, "has_documentation": True},
    )
    analyzer._analyze_vertical = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={"vertical": "financial_services", "sub_vertical": "Compliance"},
    )
    analyzer._classify_vertical_taxonomy = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={
            "primary": {
                "vertical_id": "financial_services",
                "vertical_label": "Financial Services",
                "sub_vertical_id": "compliance",
                "sub_vertical_label": "Compliance",
                "leaf_id": "aml_monitoring",
                "leaf_label": "AML Monitoring",
            },
            "path": [
                {"id": "financial_services", "label": "Financial Services", "confidence": 0.85},
                {"id": "compliance", "label": "Compliance", "confidence": 0.8},
            ],
        },
    )
    analyzer._discover_patterns = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={
            "discovered_patterns": [],
            "model_details": {},
            "novel_approaches": [],
            "implementation_maturity": "production",
        },
    )
    analyzer._analyze_team = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={
            "team_signals": {
                "engineering_heavy": "unknown",
                "has_ml_expertise": True,
                "remote_distributed": "unknown",
            },
            "team_strengths": ["Team page lists ML engineers"],
            "team_confidence": 0.4,
        },
    )
    analyzer._analyze_business_model = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={
            "pricing_model": {
                "type": "enterprise_only",
                "pricing_evidence": ["Pricing starts with enterprise plans"],
            },
            "gtm_strategy": {
                "primary_channel": "sales_led",
                "evidence": ["Pricing starts with enterprise plans"],
                "target_segment": "enterprise",
            },
            "business_model_confidence": 0.7,
        },
    )
    analyzer._analyze_product = lambda *args, **kwargs: asyncio.sleep(
        0,
        result={
            "product_stage": "general_availability",
            "stage_evidence": ["Available for enterprise deployments"],
            "feature_depth": {"core_features": ["Workflow automation"]},
            "use_cases": {"primary_use_case": "Automate compliance workflows"},
            "product_confidence": 0.8,
        },
    )
    analyzer._generate_story_angles = lambda *args, **kwargs: asyncio.sleep(0, result={"story_angles": []})
    analyzer._detect_anti_patterns = lambda *args, **kwargs: asyncio.sleep(0, result={"anti_patterns": []})

    analysis = asyncio.run(
        analyzer.analyze_startup(
            StartupInput(name="Acme AI", website="https://acme.ai", description="Compliance workflow automation")
        )
    )
    asyncio.run(analyzer.close())

    assert analysis.analysis_version == "v2"
    assert analysis.team_analysis.team_signals.engineering_heavy is False
    assert analysis.team_analysis.team_signals.engineering_heavy_status == TriState.UNKNOWN
    assert analysis.vertical.value == "financial_services"
    assert analysis.sub_vertical == "Compliance"
    assert analysis.sub_sub_vertical == "AML Monitoring"
    assert analysis.evidence_packet
    assert analysis.evidence_packet[0].source_type == "docs"
    assert analysis.field_provenance["uses_genai"].source_count >= 1
    assert analysis.section_status["evidence"] == AnalysisSectionState.OK
    assert analysis.quality_metrics.contradiction_count == 1
    assert analysis.fact_ledger["segmentation"][0].label == "market_type"
