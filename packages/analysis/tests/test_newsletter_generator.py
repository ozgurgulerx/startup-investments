from pathlib import Path


def test_resolve_data_root_maps_turkey_to_tr(tmp_path: Path) -> None:
    from src.automation.newsletter_generator import _resolve_data_root

    project_root = tmp_path
    assert _resolve_data_root(project_root, "global") == project_root / "apps" / "web" / "data"
    assert _resolve_data_root(project_root, "turkey") == project_root / "apps" / "web" / "data" / "tr"
    assert _resolve_data_root(project_root, "tr") == project_root / "apps" / "web" / "data" / "tr"

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
    assert (tmp_path / "viral_newsletter_data.json").exists()
    assert not (tmp_path / "newsletter_data.json").exists()


def test_generate_viral_newsletter_filters_weak_micro_model_meshes(tmp_path: Path) -> None:
    from src.reports.newsletter_generator import generate_viral_newsletter

    analyses = [
        {
            "company_name": "ListenHub",
            "company_slug": "listenhub",
            "description": "Turns documents into voice, slides, and podcasts.",
            "newsletter_potential": "high",
            "technical_depth": "medium",
            "story_angles": [
                {
                    "angle_type": "architecture",
                    "headline": "Inside ListenHub's content transformation stack",
                    "summary": "The interesting part is packaging multiple content workflows into one product.",
                    "uniqueness_score": 7,
                }
            ],
            "build_patterns": [
                {
                    "name": "Micro-model Meshes",
                    "confidence": 0.9,
                    "evidence": ["Supports podcast, slides, and voice cloning workflows."],
                    "description": "Multiple workflows imply specialized models.",
                },
                {
                    "name": "Vertical Data Moats",
                    "confidence": 0.8,
                    "evidence": ["Proprietary creator workflow data."],
                    "description": "Owns creator workflow and feedback data.",
                },
            ],
            "discovered_patterns": [
                {
                    "pattern_name": "Micro-model Meshes",
                    "category": "Model Architecture",
                    "confidence": 0.9,
                    "evidence": ["Multiple content modalities."],
                    "description": "Likely specialized models per modality.",
                    "novelty_score": 7,
                    "why_notable": "",
                }
            ],
            "competitive_analysis": {
                "competitive_moat": "medium",
                "moat_explanation": "Defensibility depends on creator data loops.",
            },
            "unique_findings": ["Workflow unification matters more than raw model novelty."],
            "engineering_quality": {
                "score": 4,
                "signals": [],
            },
        }
    ]

    out = generate_viral_newsletter(analyses, tmp_path, newsletter_name="Build Patterns Monthly")
    content = out.read_text()

    assert "Vertical Data Moats" in content
    assert "Micro-model Meshes" not in content


def test_generate_viral_newsletter_accepts_explicit_markdown_path(tmp_path: Path) -> None:
    from src.reports.newsletter_generator import generate_viral_newsletter

    analyses = [
        {
            "company_name": "Acme AI",
            "company_slug": "acme-ai",
            "description": "AI tooling",
            "newsletter_potential": "high",
            "technical_depth": "medium",
            "build_patterns": [],
            "competitive_analysis": {
                "competitive_moat": "medium",
                "moat_explanation": "",
            },
            "unique_findings": ["Interesting workflow packaging."],
            "engineering_quality": {"score": 4, "signals": []},
        }
    ]

    markdown_path = tmp_path / "custom-newsletter.md"
    out = generate_viral_newsletter(analyses, markdown_path, newsletter_name="Build Patterns Monthly")

    assert out == markdown_path
    assert markdown_path.exists()
    assert (tmp_path / "viral_newsletter_data.json").exists()
    assert not (tmp_path / "newsletter_data.json").exists()


def test_generate_newsletter_data_clamps_remaining_count_for_small_batches(tmp_path: Path) -> None:
    from src.automation.newsletter_generator import generate_newsletter_data

    period = "2026-02"
    input_dir = tmp_path / period / "input"
    store_dir = tmp_path / period / "output" / "analysis_store"
    input_dir.mkdir(parents=True)
    store_dir.mkdir(parents=True)

    (input_dir / "startups.csv").write_text(
        "Transaction Name,Funding Type,Money Raised (in USD),Funding Stage,Organization Description,Organization Website,Organization Industries,Organization Location,Lead Investors\n"
        "Seed Round - SoloAI,Seed,1000000,Seed,Single company round,https://example.com,SaaS,\"Istanbul, Turkey, Asia\",Example VC\n",
        encoding="utf-8",
    )

    result = generate_newsletter_data(period, tmp_path)

    assert result["hero"]["total_rounds"] == 1
    assert result["top5_concentration"]["remaining_total"] == 0
    assert result["top5_concentration"]["remaining_count"] == 0
