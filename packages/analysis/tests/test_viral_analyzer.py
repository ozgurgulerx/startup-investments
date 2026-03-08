import asyncio

from src.analysis.viral_analyzer import ViralContentAnalyzer
from src.data.models import BuildPattern, StartupAnalysis, StartupInput


def test_generate_viral_hooks_omits_rejected_micro_model_meshes_from_prompt():
    analyzer = ViralContentAnalyzer.__new__(ViralContentAnalyzer)

    captured = {}

    async def _capture(prompt):
        captured["prompt"] = prompt
        return {"headlines": []}

    analyzer._call_llm = _capture

    startup = StartupInput(name="PatternCo", website="https://pattern.co", description="AI recruiting stack")
    analysis = StartupAnalysis(
        company_name="PatternCo",
        company_slug="patternco",
        build_patterns=[
            BuildPattern(
                name="Micro-model Meshes",
                confidence=0.9,
                evidence=["Supports voice, video, and SMS workflows."],
                description="Multiple modalities imply specialization.",
            ),
            BuildPattern(
                name="Vertical Data Moats",
                confidence=0.8,
                evidence=["Uses proprietary recruiter benchmark data."],
                description="Domain-specific data creates defensibility.",
            ),
        ],
        unique_findings=["Owns recruiter benchmark data."],
    )

    asyncio.run(
        analyzer._generate_viral_hooks(
            startup,
            analysis,
            {"honest_take": "Interesting but unproven."},
        )
    )

    assert "Vertical Data Moats" in captured["prompt"]
    assert "Micro-model Meshes" not in captured["prompt"]
