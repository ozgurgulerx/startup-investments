import asyncio
import threading

import pytest

from src.analysis.genai_detector import AnalysisStageTimeoutError, GenAIAnalyzer
from src.data.models import StartupInput
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


def test_run_stage_propagates_timeout_failures():
    analyzer = _build_analyzer()

    async def timed_out_stage():
        raise AnalysisStageTimeoutError("LLM call timed out after 42s")

    with pytest.raises(AnalysisStageTimeoutError):
        asyncio.run(analyzer._run_stage("Acme AI", "genai", timed_out_stage))


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
        0,
        result={
            "uses_genai": True,
            "genai_intensity": "core",
            "confidence": 0.8,
            "models_mentioned": [],
            "evidence": [],
        },
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
        0,
        result={
            "competitors": [],
            "differentiation": {},
            "secret_sauce": {},
            "competitive_moat": "unknown",
        },
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
