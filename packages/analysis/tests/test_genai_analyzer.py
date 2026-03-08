import asyncio

from src.analysis.genai_detector import GenAIAnalyzer
from src.data.models import StartupInput


class FakeCrawler:
    def get_all_cached_content(self, company_name: str) -> str:
        return "cached-content " * 100

    async def crawl_startup(self, startup: StartupInput):
        return []

    async def close(self):
        return None


def test_analyze_startup_runs_independent_stages_with_bounded_concurrency(monkeypatch):
    monkeypatch.setattr("src.analysis.genai_detector.StartupCrawler", FakeCrawler)
    analyzer = GenAIAnalyzer(stage_concurrency=2, stage_timeout_sec=5)

    active = 0
    observed_max = 0

    async def tracked(result):
        nonlocal active, observed_max
        active += 1
        observed_max = max(observed_max, active)
        await asyncio.sleep(0.01)
        active -= 1
        return result

    analyzer._detect_genai = lambda *args, **kwargs: tracked(
        {"uses_genai": True, "genai_intensity": "core", "confidence": 0.9, "models_mentioned": [], "evidence": []}
    )
    analyzer._detect_patterns = lambda *args, **kwargs: tracked(
        {"patterns_detected": [], "technical_depth": "surface", "novel_approaches": []}
    )
    analyzer._discover_insights = lambda *args, **kwargs: tracked(
        {"unique_findings": ["signal"], "newsletter_potential": "medium"}
    )
    analyzer._classify_market = lambda *args, **kwargs: tracked(
        {"market_type": "horizontal", "target_market": "b2b"}
    )
    analyzer._analyze_competitive = lambda *args, **kwargs: tracked(
        {"competitors": [], "differentiation": {}, "secret_sauce": {}, "competitive_moat": "unknown"}
    )
    analyzer._detect_tech_stack = lambda *args, **kwargs: tracked({})
    analyzer._assess_engineering_quality = lambda *args, **kwargs: tracked({"score": 5})
    analyzer._analyze_vertical = lambda *args, **kwargs: tracked({"vertical": "other"})
    analyzer._classify_vertical_taxonomy = lambda *args, **kwargs: tracked({})
    analyzer._discover_patterns = lambda *args, **kwargs: tracked(
        {"discovered_patterns": [], "model_details": {}, "novel_approaches": [], "implementation_maturity": "unknown"}
    )
    analyzer._analyze_team = lambda *args, **kwargs: tracked({})
    analyzer._analyze_business_model = lambda *args, **kwargs: tracked({})
    analyzer._analyze_product = lambda *args, **kwargs: tracked({})
    analyzer._generate_story_angles = lambda *args, **kwargs: tracked({"story_angles": []})
    analyzer._detect_anti_patterns = lambda *args, **kwargs: tracked({"anti_patterns": []})

    startup = StartupInput(name="Acme AI", website="https://acme.ai", description="AI tooling")
    analysis = asyncio.run(analyzer.analyze_startup(startup))
    asyncio.run(analyzer.close())

    assert observed_max == 2
    assert analysis.company_name == "Acme AI"
    assert analysis.uses_genai is True


def test_analyze_startup_times_out_single_stage_without_stalling(monkeypatch):
    monkeypatch.setattr("src.analysis.genai_detector.StartupCrawler", FakeCrawler)
    analyzer = GenAIAnalyzer(stage_concurrency=2, stage_timeout_sec=5)
    analyzer.stage_timeout_sec = 0.05

    async def fast(result):
        await asyncio.sleep(0.01)
        return result

    async def slow(*args, **kwargs):
        await asyncio.sleep(0.2)
        return {"product_confidence": 1.0}

    analyzer._detect_genai = lambda *args, **kwargs: fast(
        {"uses_genai": False, "genai_intensity": "unclear", "confidence": 0.1, "models_mentioned": [], "evidence": []}
    )
    analyzer._detect_patterns = lambda *args, **kwargs: fast(
        {"patterns_detected": [], "technical_depth": "surface", "novel_approaches": []}
    )
    analyzer._discover_insights = lambda *args, **kwargs: fast(
        {"unique_findings": [], "newsletter_potential": "low"}
    )
    analyzer._classify_market = lambda *args, **kwargs: fast(
        {"market_type": "horizontal", "target_market": "b2b"}
    )
    analyzer._analyze_competitive = lambda *args, **kwargs: fast(
        {"competitors": [], "differentiation": {}, "secret_sauce": {}, "competitive_moat": "unknown"}
    )
    analyzer._detect_tech_stack = lambda *args, **kwargs: fast({})
    analyzer._assess_engineering_quality = lambda *args, **kwargs: fast({"score": 5})
    analyzer._analyze_vertical = lambda *args, **kwargs: fast({"vertical": "other"})
    analyzer._classify_vertical_taxonomy = lambda *args, **kwargs: fast({})
    analyzer._discover_patterns = lambda *args, **kwargs: fast(
        {"discovered_patterns": [], "model_details": {}, "novel_approaches": [], "implementation_maturity": "unknown"}
    )
    analyzer._analyze_team = lambda *args, **kwargs: fast({})
    analyzer._analyze_business_model = lambda *args, **kwargs: fast({})
    analyzer._analyze_product = slow
    analyzer._generate_story_angles = lambda *args, **kwargs: fast({"story_angles": []})
    analyzer._detect_anti_patterns = lambda *args, **kwargs: fast({"anti_patterns": []})

    startup = StartupInput(name="Acme AI", website="https://acme.ai", description="AI tooling")
    analysis = asyncio.run(analyzer.analyze_startup(startup))
    asyncio.run(analyzer.close())

    assert analysis.company_name == "Acme AI"
    assert analysis.product_analysis.product_confidence == 0.0
