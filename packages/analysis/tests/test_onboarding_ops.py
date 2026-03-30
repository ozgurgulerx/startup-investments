import json
from pathlib import Path

from src.analysis.onboarding_ops import (
    _resolve_data_root_from_csv,
    compute_onboarding_resume_plan,
    evaluate_onboarding_health,
    resolve_repo_dataset_paths,
    regenerate_output_artifacts,
)
from src.data.ingestion import load_startups_from_csv, load_unique_startups_from_csv
from src.data.models import GenAIIntensity, StartupAnalysis, StartupInput
from src.data.store import AnalysisStore


CSV_HEADERS = [
    "Transaction Name",
    "Transaction Name URL",
    "Announced Date",
    "Funding Stage",
    "Organization Website",
    "Organization Description",
    "Organization Industries",
    "Organization Location",
    "Money Raised (in USD)",
    "Funding Type",
    "Lead Investors",
]


def test_regenerate_output_artifacts_refreshes_csvs_and_stats(tmp_path):
    period_dir = tmp_path / "data" / "2026-02"
    input_dir = period_dir / "input"
    output_dir = period_dir / "output"
    input_dir.mkdir(parents=True)
    output_dir.mkdir(parents=True)

    csv_path = input_dir / "startups.csv"
    csv_path.write_text(
        ",".join(CSV_HEADERS) + "\n"
        + ",".join(
            [
                "Acme Round - Acme AI",
                "https://example.com/acme",
                "",
                "",
                "https://acme.ai",
                "AI tooling",
                "\"AI, SaaS\"",
                "San Francisco",
                "1000000",
                "Seed",
                "Example Capital",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    store = AnalysisStore(output_dir / "analysis_store")
    startup = StartupInput(
        name="Acme AI",
        website="https://acme.ai",
        description="AI tooling",
        industries=["AI", "SaaS"],
    )
    analysis = StartupAnalysis(
        company_name="Acme AI",
        company_slug="acme-ai",
        website="https://acme.ai",
        description="AI tooling",
        funding_amount=1_000_000,
        funding_stage=startup.funding_stage,
        uses_genai=True,
        genai_intensity=GenAIIntensity.CORE,
        newsletter_potential="medium",
    )
    store.save_base_analysis(analysis, startup)

    artifacts = regenerate_output_artifacts(csv_path=csv_path, output_path=output_dir, period="2026-02", store=store)

    assert output_dir.joinpath("analysis_results.csv").exists()
    assert output_dir.joinpath("startups_enriched_with_analysis.csv").exists()
    assert output_dir.joinpath("monthly_stats.json").exists()
    assert output_dir.joinpath("newsletter_data.json").exists()
    assert output_dir.joinpath("viral_newsletter.md").exists()
    assert output_dir.joinpath("viral_newsletter_data.json").exists()
    assert output_dir.joinpath("briefs", "acme-ai_brief.md").exists()
    assert output_dir.joinpath("briefs", "index.json").exists()
    assert artifacts["base_analysis_count"] == "1"
    assert artifacts["brief_count"] == "1"

    monthly_stats = json.loads(output_dir.joinpath("monthly_stats.json").read_text(encoding="utf-8"))
    assert monthly_stats["deal_summary"]["total_deals"] == 1
    assert monthly_stats["genai_analysis"]["total_analyzed"] == 1

    newsletter_data = json.loads(output_dir.joinpath("newsletter_data.json").read_text(encoding="utf-8"))
    assert newsletter_data["meta"]["period_label"] == "February 2026"
    assert newsletter_data["hero"]["total_rounds"] == 1
    brief_index = json.loads(output_dir.joinpath("briefs", "index.json").read_text(encoding="utf-8"))
    assert brief_index["count"] == 1
    assert brief_index["items"][0]["slug"] == "acme-ai"


def test_resolve_repo_dataset_paths_maps_turkey_to_tr():
    global_paths = resolve_repo_dataset_paths("2026-02", "global")
    turkey_paths = resolve_repo_dataset_paths("2026-02", "turkey")
    legacy_paths = resolve_repo_dataset_paths("2026-02", "tr")

    assert global_paths["period_root"].as_posix().endswith("apps/web/data/2026-02")
    assert turkey_paths["period_root"].as_posix().endswith("apps/web/data/tr/2026-02")
    assert legacy_paths["period_root"] == turkey_paths["period_root"]


def test_resolve_data_root_from_csv_preserves_region_scoped_dataset_root():
    assert _resolve_data_root_from_csv(Path("apps/web/data/2026-02/input/startups.csv")) == Path("apps/web/data")
    assert _resolve_data_root_from_csv(Path("apps/web/data/tr/2026-02/input/startups.csv")) == Path("apps/web/data/tr")


def test_evaluate_onboarding_health_flags_backlog_stale_progress_and_hash_gaps():
    report = {
        "analysis_store": {
            "backlog_unique": 120,
            "base_analysis_files": 10,
            "index_hash_coverage_pct": 0.0,
        },
        "progress": {
            "status": "running",
            "stale_minutes": 180,
        },
        "credentials": {
            "azure_openai_endpoint": True,
            "azure_openai_api_key": False,
            "openai_api_key": False,
        },
    }

    health = evaluate_onboarding_health(report)

    assert health["status"] == "fail"
    messages = [alert["message"] for alert in health["alerts"]]
    assert any("Backlog remains high" in message for message in messages)
    assert any("Progress checkpoint stale" in message for message in messages)
    assert any("Index hash coverage is zero" in message for message in messages)


def test_load_unique_startups_from_csv_deduplicates_duplicate_companies(tmp_path):
    csv_path = tmp_path / "startups.csv"
    csv_path.write_text(
        ",".join(CSV_HEADERS) + "\n"
        + "\n".join(
            [
                ",".join(
                    [
                        "Seed Round - Acme AI",
                        "",
                        "2026-03-01",
                        "Seed",
                        "https://acme.ai",
                        "",
                        "AI",
                        "",
                        "1000000",
                        "Seed",
                        "",
                    ]
                ),
                ",".join(
                    [
                        "Series A - Acme AI",
                        "https://example.com/acme",
                        "2026-03-05",
                        "Early Stage Venture",
                        "https://acme.ai",
                        "Better description",
                        "\"AI, SaaS\"",
                        "\"San Francisco, California, United States, North America\"",
                        "500000",
                        "Series A",
                        "Alpha Ventures",
                    ]
                ),
                ",".join(
                    [
                        "Seed Round - Beta AI",
                        "https://example.com/beta-seed",
                        "2026-03-02",
                        "Seed",
                        "https://beta.ai",
                        "Beta description",
                        "AI",
                        "\"New York, New York, United States, North America\"",
                        "100000",
                        "Seed",
                        "Seed Capital",
                    ]
                ),
                ",".join(
                    [
                        "Series A - Beta AI",
                        "https://example.com/beta-series-a",
                        "2026-03-12",
                        "Early Stage Venture",
                        "https://beta.ai",
                        "Beta description",
                        "AI",
                        "\"New York, New York, United States, North America\"",
                        "200000",
                        "Series A",
                        "Growth Capital",
                    ]
                ),
                ",".join(
                    [
                        "Seed Round - Gamma AI",
                        "https://example.com/gamma-seed",
                        "2026-03-03",
                        "Seed",
                        "https://gamma.ai",
                        "Gamma description",
                        "AI",
                        "\"London, England, United Kingdom, Europe\"",
                        "300000",
                        "Seed",
                        "North Fund",
                    ]
                ),
                ",".join(
                    [
                        "Series A - Gamma AI",
                        "https://example.com/gamma-series-a",
                        "2026-03-03",
                        "Early Stage Venture",
                        "https://gamma.ai",
                        "Gamma description",
                        "AI",
                        "\"London, England, United Kingdom, Europe\"",
                        "300000",
                        "Series A",
                        "North Fund",
                    ]
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    raw_startups = load_startups_from_csv(csv_path)
    unique_startups = load_unique_startups_from_csv(csv_path)

    assert len(raw_startups) == 6
    assert len(unique_startups) == 3

    by_name = {startup.name: startup for startup in unique_startups}

    assert by_name["Acme AI"].description == "Better description"
    assert by_name["Acme AI"].funding_type == "Series A"
    assert by_name["Acme AI"].funding_amount == 500000
    assert by_name["Acme AI"].lead_investors == ["Alpha Ventures"]

    assert by_name["Beta AI"].funding_type == "Series A"
    assert by_name["Beta AI"].funding_amount == 200000
    assert by_name["Beta AI"].lead_investors == ["Growth Capital"]

    assert by_name["Gamma AI"].funding_type == "Seed"
    assert by_name["Gamma AI"].funding_amount == 300000


def test_analysis_store_roundtrips_v2_analysis_metadata(tmp_path):
    store = AnalysisStore(tmp_path / "analysis_store")
    startup = StartupInput(
        name="Acme AI",
        website="https://acme.ai",
        description="AI tooling",
    )
    analysis = StartupAnalysis(
        company_name="Acme AI",
        company_slug="acme-ai",
        website="https://acme.ai",
        description="AI tooling",
        funding_stage=startup.funding_stage,
        uses_genai=True,
        genai_intensity=GenAIIntensity.CORE,
        newsletter_potential="medium",
        analysis_version="v2",
        section_status={"genai": "ok", "evidence": "partial"},
        field_provenance={
            "uses_genai": {
                "evidence_refs": ["src_1"],
                "source_count": 1,
                "confidence": 0.9,
                "notes": "docs match",
            }
        },
        evidence_packet=[
            {
                "source_id": "src_1",
                "source_type": "docs",
                "url": "https://acme.ai/docs",
                "title": "Docs",
                "snippet": "Acme AI uses GPT-4.",
                "confidence": 0.95,
            }
        ],
        fact_ledger={
            "genai": [
                {
                    "topic": "genai",
                    "label": "uses_genai",
                    "value": "yes",
                    "evidence_refs": ["src_1"],
                    "source_count": 1,
                    "confidence": 0.9,
                }
            ]
        },
        quality_metrics={
            "coverage_score": 0.75,
            "evidence_density": 0.5,
            "contradiction_count": 0,
            "confidence_by_section": {"genai": 0.9},
            "sections_with_evidence": 1,
            "sections_total": 2,
        },
        open_questions=[
            {
                "section": "team",
                "question": "Who are the founders?",
                "reason": "Founder identity missing",
            }
        ],
        crawl_coverage={
            "pages_crawled": 1,
            "source_type_counts": {"docs": 1},
            "seen_source_types": ["docs"],
            "missing_source_types": ["website"],
            "docs_available": True,
        },
    )

    store.save_base_analysis(analysis, startup)
    loaded = store.get_base_analysis("Acme AI")

    assert loaded is not None
    assert loaded.analysis_version == "v2"
    assert loaded.field_provenance["uses_genai"].source_count == 1
    assert loaded.evidence_packet[0].source_type == "docs"
    assert loaded.fact_ledger["genai"][0].label == "uses_genai"
    assert loaded.open_questions[0].section == "team"
    assert loaded.section_status["genai"] == "ok"


def _write_resume_csv(csv_path: Path, names: list[str]) -> None:
    rows = []
    for index, name in enumerate(names, start=1):
        rows.append(
            ",".join(
                [
                    f"Seed Round - {name}",
                    f"https://example.com/{name.lower().replace(' ', '-')}",
                    f"2026-03-{index:02d}",
                    "Seed",
                    f"https://{name.lower().replace(' ', '')}.ai",
                    f"{name} description",
                    '"AI, SaaS"',
                    '"San Francisco, California, United States, North America"',
                    str(index * 1000000),
                    "Seed",
                    "Example Capital",
                ]
            )
        )
    csv_path.write_text(",".join(CSV_HEADERS) + "\n" + "\n".join(rows) + "\n", encoding="utf-8")


def _save_resume_analysis(store: AnalysisStore, name: str) -> None:
    startup = StartupInput(
        name=name,
        website=f"https://{name.lower().replace(' ', '')}.ai",
        description=f"{name} description",
    )
    analysis = StartupAnalysis(
        company_name=name,
        company_slug=StartupAnalysis.to_slug(name),
        website=startup.website,
        description=startup.description,
        funding_stage=startup.funding_stage,
        uses_genai=True,
        genai_intensity=GenAIIntensity.CORE,
        newsletter_potential="medium",
    )
    store.save_base_analysis(analysis, startup)


def test_compute_onboarding_resume_plan_restarts_from_analysis_when_store_incomplete(tmp_path, monkeypatch):
    period_dir = tmp_path / "data" / "2026-03"
    input_dir = period_dir / "input"
    output_dir = period_dir / "output"
    input_dir.mkdir(parents=True)
    output_dir.mkdir(parents=True)
    csv_path = input_dir / "startups.csv"
    _write_resume_csv(csv_path, ["Acme AI", "Beta AI"])

    store = AnalysisStore(output_dir / "analysis_store")
    _save_resume_analysis(store, "Acme AI")

    monkeypatch.setattr(
        "src.analysis.onboarding_ops._load_db_counts",
        lambda region, period: {"available": True, "total": 0, "with_analysis_data": 0, "state_ready": 0},
    )

    plan = compute_onboarding_resume_plan(csv_path=csv_path, output_path=output_dir, region="global")

    assert plan["recommended_start_stage"] == "analysis"
    assert plan["stages"]["analysis"]["complete"] is False


def test_compute_onboarding_resume_plan_starts_db_sync_after_analysis_complete(tmp_path, monkeypatch):
    period_dir = tmp_path / "data" / "2026-03"
    input_dir = period_dir / "input"
    output_dir = period_dir / "output"
    input_dir.mkdir(parents=True)
    output_dir.mkdir(parents=True)
    csv_path = input_dir / "startups.csv"
    _write_resume_csv(csv_path, ["Acme AI", "Beta AI"])

    store = AnalysisStore(output_dir / "analysis_store")
    _save_resume_analysis(store, "Acme AI")
    _save_resume_analysis(store, "Beta AI")
    output_dir.joinpath("analysis_results.csv").write_text("ok\n", encoding="utf-8")
    output_dir.joinpath("startups_enriched_with_analysis.csv").write_text("ok\n", encoding="utf-8")

    monkeypatch.setattr(
        "src.analysis.onboarding_ops._load_db_counts",
        lambda region, period: {"available": True, "total": 1, "with_analysis_data": 0, "state_ready": 0},
    )

    plan = compute_onboarding_resume_plan(csv_path=csv_path, output_path=output_dir, region="global")

    assert plan["recommended_start_stage"] == "db_sync"
    assert plan["stages"]["artifact_refresh"]["complete"] is True


def test_compute_onboarding_resume_plan_starts_state_backfill_after_materialization(tmp_path, monkeypatch):
    period_dir = tmp_path / "data" / "2026-03"
    input_dir = period_dir / "input"
    output_dir = period_dir / "output"
    input_dir.mkdir(parents=True)
    output_dir.mkdir(parents=True)
    csv_path = input_dir / "startups.csv"
    _write_resume_csv(csv_path, ["Acme AI", "Beta AI"])

    store = AnalysisStore(output_dir / "analysis_store")
    _save_resume_analysis(store, "Acme AI")
    _save_resume_analysis(store, "Beta AI")
    output_dir.joinpath("analysis_results.csv").write_text("ok\n", encoding="utf-8")
    output_dir.joinpath("startups_enriched_with_analysis.csv").write_text("ok\n", encoding="utf-8")

    monkeypatch.setattr(
        "src.analysis.onboarding_ops._load_db_counts",
        lambda region, period: {"available": True, "total": 2, "with_analysis_data": 2, "state_ready": 1},
    )

    plan = compute_onboarding_resume_plan(csv_path=csv_path, output_path=output_dir, region="global")

    assert plan["recommended_start_stage"] == "state_backfill"


def test_compute_onboarding_resume_plan_reports_completed_when_outputs_exist(tmp_path, monkeypatch):
    period_dir = tmp_path / "data" / "2026-03"
    input_dir = period_dir / "input"
    output_dir = period_dir / "output"
    input_dir.mkdir(parents=True)
    (output_dir / "deep_research").mkdir(parents=True)
    csv_path = input_dir / "startups.csv"
    _write_resume_csv(csv_path, ["Acme AI"])

    store = AnalysisStore(output_dir / "analysis_store")
    _save_resume_analysis(store, "Acme AI")
    output_dir.joinpath("analysis_results.csv").write_text("ok\n", encoding="utf-8")
    output_dir.joinpath("startups_enriched_with_analysis.csv").write_text("ok\n", encoding="utf-8")
    output_dir.joinpath("monthly_stats.json").write_text("{}\n", encoding="utf-8")
    output_dir.joinpath("newsletter_data.json").write_text("{}\n", encoding="utf-8")
    output_dir.joinpath("viral_newsletter.md").write_text("# ok\n", encoding="utf-8")
    output_dir.joinpath("deep_research", "index.json").write_text("{}\n", encoding="utf-8")

    monkeypatch.setattr(
        "src.analysis.onboarding_ops._load_db_counts",
        lambda region, period: {"available": True, "total": 1, "with_analysis_data": 1, "state_ready": 1},
    )

    plan = compute_onboarding_resume_plan(csv_path=csv_path, output_path=output_dir, region="global")

    assert plan["recommended_start_stage"] == "completed"
