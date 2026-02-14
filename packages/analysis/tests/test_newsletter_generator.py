from pathlib import Path


def test_generate_viral_newsletter_base_analysis_fallback(tmp_path: Path) -> None:
    # Base analysis objects (no viral_hooks / contrarian_analysis) should still
    # produce non-empty Deep Dive + Builder Lessons sections.
    from src.reports.newsletter_generator import generate_viral_newsletter

    analyses = [
        {
            "company_name": "CloudForge",
            "company_slug": "cloudforge",
            "description": "AI prospecting, CRM, and procurement for the metals supply chain.",
            "newsletter_potential": "high",
            "technical_depth": "deep",
            "uses_genai": False,
            "story_angles": [
                {
                    "angle_type": "architecture",
                    "headline": "Inside the stack that turns metals procurement into an AI-first workflow",
                    "summary": "CloudForge looks interesting because it likely blends vertical data, retrieval, and workflow automation into one system.",
                    "uniqueness_score": 8,
                }
            ],
            "build_patterns": [
                {
                    "name": "Vertical Data Moats",
                    "confidence": 0.9,
                    "description": "Domain-specific data creating defensibility.",
                }
            ],
            "competitive_analysis": {
                "competitive_moat": "medium",
                "moat_explanation": "Defensibility depends on accumulating proprietary supply-chain signals.",
            },
            "unique_findings": [
                "Verticalization on the metals supply chain: end-to-end workflow focus is unusual vs split-stack incumbents."
            ],
            "engineering_quality": {
                "score": 4,
                "signals": ["Limited public documentation is visible."],
            },
        }
    ]

    out = generate_viral_newsletter(analyses, tmp_path, newsletter_name="Build Patterns Monthly")
    assert out.exists()

    content = out.read_text()
    assert "## Deep Dive" in content
    assert "### Inside the stack that turns metals procurement into an AI-first workflow" in content
    assert "#### The Core Insight" in content
    assert "CloudForge looks interesting because it likely blends vertical data" in content
    assert "## Builder Lessons" in content
    assert "Verticalization on the metals supply chain" in content

