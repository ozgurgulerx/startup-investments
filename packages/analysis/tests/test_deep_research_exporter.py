import json

from src.reports.deep_research_exporter import (
    format_deep_research_markdown,
    write_deep_research_artifacts,
)


def test_format_deep_research_markdown_includes_metadata_and_analysis():
    markdown = format_deep_research_markdown(
        {
            "startup_name": "Acme AI",
            "period": "2026-03",
            "dataset_region": "global",
            "research_depth": "quick",
            "reason": "monthly_onboarding",
            "completed_at": "2026-03-30T06:00:00Z",
            "website": "https://acme.ai",
            "research_output": {
                "analysis": "Acme AI appears to have strong GTM signals.",
                "model": "gpt-5-nano",
                "materialization_status": "analysis_ready",
                "human_context_used": 2,
                "analysis_context_used": True,
                "recent_event_count": 1,
                "focus_areas": ["gtm", "technical moat"],
            },
        }
    )

    assert "# Acme AI" in markdown
    assert "**Depth:** quick" in markdown
    assert "**Model:** gpt-5-nano" in markdown
    assert "**Focus Areas:** gtm, technical moat" in markdown
    assert "## Analysis" in markdown
    assert "strong GTM signals" in markdown


def test_write_deep_research_artifacts_writes_markdown_and_index(tmp_path):
    stats = write_deep_research_artifacts(
        [
            {
                "startup_name": "Acme AI",
                "slug": "acme-ai",
                "period": "2026-03",
                "dataset_region": "global",
                "research_depth": "deep",
                "completed_at": "2026-03-30T06:00:00Z",
                "research_output": {
                    "analysis": "Detailed note",
                    "model": "gpt-5-nano",
                },
            }
        ],
        tmp_path,
    )

    artifact_path = tmp_path / "deep_research" / "acme-ai.md"
    index_path = tmp_path / "deep_research" / "index.json"

    assert stats["count"] == 1
    assert artifact_path.exists()
    assert "Detailed note" in artifact_path.read_text(encoding="utf-8")
    assert index_path.exists()

    index_payload = json.loads(index_path.read_text(encoding="utf-8"))
    assert index_payload["count"] == 1
    assert index_payload["items"][0]["slug"] == "acme-ai"
