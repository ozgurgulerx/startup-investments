import asyncio

from src.analysis.incremental_processor import IncrementalProcessor
from src.data.models import GenAIIntensity, StartupAnalysis, StartupInput
from src.data.store import AnalysisStore


class FakeCrawler:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def get_all_cached_content(self, company_name: str) -> str:
        return "cached-content " * 100

    async def crawl_startup(self, startup: StartupInput):
        return []

    def save_raw_content(self, company_name: str):
        return None

    async def close(self):
        return None


class HangingCrawler(FakeCrawler):
    """Simulates a crawler that hangs indefinitely on crawl_startup."""

    def get_all_cached_content(self, company_name: str) -> str:
        return ""  # Force crawl

    async def crawl_startup(self, startup: StartupInput):
        await asyncio.sleep(3600)  # Hang for 1 hour


class FakeAnalyzer:
    async def analyze_startup(self, startup: StartupInput) -> StartupAnalysis:
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

    async def close(self):
        return None


class FailingAnalyzer(FakeAnalyzer):
    async def analyze_startup(self, startup: StartupInput) -> StartupAnalysis:
        raise RuntimeError("analysis failed")


class CapturingStore(AnalysisStore):
    def __init__(self, store_dir):
        super().__init__(store_dir)
        self.snapshots = []

    def write_progress_checkpoint(self, payload):
        self.snapshots.append(dict(payload))
        super().write_progress_checkpoint(payload)


def _startup(name: str) -> StartupInput:
    return StartupInput(
        name=name,
        website=f"https://{name.lower().replace(' ', '')}.ai",
        description=f"{name} description",
    )


def test_incremental_respects_allowlist_and_max_startups(tmp_path):
    store = AnalysisStore(tmp_path / "analysis_store")
    processor = IncrementalProcessor(
        store=store,
        crawler_factory=FakeCrawler,
        analyzer_factory=FakeAnalyzer,
    )
    startups = [_startup("Acme AI"), _startup("Beta Labs"), _startup("Gamma Systems")]

    results = asyncio.run(
        processor.process_incremental(
            startups,
            run_base=True,
            run_viral=False,
            max_concurrent=2,
            max_startups=1,
            startup_allowlist={"acme ai", "beta labs"},
        )
    )

    assert results["delta_total"] == 1
    assert results["delta_processed"] == 1
    assert results["filtered_out"] == 2
    assert store.count_base_analysis_files() == 1
    assert store.get_base_analysis("Acme AI") is not None
    assert store.get_base_analysis("Beta Labs") is None


def test_incremental_progress_checkpoints_record_stage_and_error(tmp_path):
    store = CapturingStore(tmp_path / "analysis_store")
    processor = IncrementalProcessor(
        store=store,
        crawler_factory=FakeCrawler,
        analyzer_factory=FailingAnalyzer,
    )

    asyncio.run(
        processor.process_incremental(
            [_startup("Acme AI")],
            run_base=True,
            run_viral=False,
            max_concurrent=1,
        )
    )

    latest_stages = [snapshot.get("latest_stage") for snapshot in store.snapshots]

    assert "claiming" in latest_stages
    assert "crawling" in latest_stages
    assert "analyzing" in latest_stages
    assert "error" in latest_stages
    error_snapshot = next(snapshot for snapshot in store.snapshots if snapshot.get("latest_stage") == "error")
    assert error_snapshot["error_count"] == 1
    assert error_snapshot["latest_startup"] == "Acme AI"


def test_incremental_timeout_prevents_hang(tmp_path, monkeypatch):
    """A hanging crawl should be killed by the per-startup timeout."""
    store = CapturingStore(tmp_path / "analysis_store")
    processor = IncrementalProcessor(
        store=store,
        crawler_factory=HangingCrawler,
        analyzer_factory=FakeAnalyzer,
    )

    # Patch asyncio.wait_for to use a 1s timeout so the test finishes quickly
    original_wait_for = asyncio.wait_for
    captured_timeouts = []

    async def short_wait_for(coro, timeout=None):
        captured_timeouts.append(timeout)
        return await original_wait_for(coro, timeout=1)

    monkeypatch.setattr(asyncio, "wait_for", short_wait_for)

    results = asyncio.run(
        processor.process_incremental(
            [_startup("Staller Inc")],
            run_base=True,
            run_viral=False,
            max_concurrent=1,
        )
    )

    assert results["completed"] == 1
    assert results["delta_processed"] == 0
    assert len(results["errors"]) == 1
    assert "Timed out" in results["errors"][0]["error"]

    # Verify checkpoint recorded the timeout error
    error_snapshots = [
        s for s in store.snapshots
        if s.get("latest_stage") == "error" and s.get("latest_error", "").startswith("Timed out")
    ]
    assert len(error_snapshots) >= 1

    # Verify production code passes the correct timeout value (600s)
    assert 600 in captured_timeouts


def test_incremental_timeout_can_be_overridden_by_env(tmp_path, monkeypatch):
    store = CapturingStore(tmp_path / "analysis_store")
    processor = IncrementalProcessor(
        store=store,
        crawler_factory=HangingCrawler,
        analyzer_factory=FakeAnalyzer,
    )

    monkeypatch.setenv("INCREMENTAL_STARTUP_TIMEOUT_SEC", "1200")

    original_wait_for = asyncio.wait_for
    captured_timeouts = []

    async def short_wait_for(coro, timeout=None):
        captured_timeouts.append(timeout)
        return await original_wait_for(coro, timeout=1)

    monkeypatch.setattr(asyncio, "wait_for", short_wait_for)

    asyncio.run(
        processor.process_incremental(
            [_startup("Long Runner")],
            run_base=True,
            run_viral=False,
            max_concurrent=1,
        )
    )

    assert 1200 in captured_timeouts
