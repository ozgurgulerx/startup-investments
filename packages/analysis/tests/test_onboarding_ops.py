import json

from src.analysis.onboarding_ops import evaluate_onboarding_health, regenerate_output_artifacts
from src.data.models import GenAIIntensity, StartupAnalysis, StartupInput
from src.data.store import AnalysisStore


CSV_HEADERS = [
    "Transaction Name",
    "Organization Website",
    "Organization Description",
    "Organization Industries",
    "Organization Location",
    "Money Raised (in USD)",
    "Funding Type",
    "Lead Investors",
    "Transaction Name URL",
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
                "https://acme.ai",
                "AI tooling",
                "\"AI, SaaS\"",
                "San Francisco",
                "1000000",
                "Seed",
                "Example Capital",
                "https://example.com/acme",
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
    assert artifacts["base_analysis_count"] == "1"

    monthly_stats = json.loads(output_dir.joinpath("monthly_stats.json").read_text(encoding="utf-8"))
    assert monthly_stats["deal_summary"]["total_deals"] == 1
    assert monthly_stats["genai_analysis"]["total_analyzed"] == 1


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
