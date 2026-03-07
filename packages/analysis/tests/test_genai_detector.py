import asyncio
import threading

import pytest

from src.analysis.genai_detector import AnalysisStageTimeoutError, GenAIAnalyzer


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
