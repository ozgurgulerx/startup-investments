#!/usr/bin/env python3
"""Run a synthetic onboarding canary for field coverage, research citations, and resume behavior."""

from __future__ import annotations

import argparse
import csv
import json
import sys
import tempfile
import time
from contextlib import nullcontext
from pathlib import Path
from typing import Sequence

REPO_ROOT = Path(__file__).resolve().parent.parent
ANALYSIS_ROOT = REPO_ROOT / "packages" / "analysis"
if str(ANALYSIS_ROOT) not in sys.path:
    sys.path.insert(0, str(ANALYSIS_ROOT))

from src.analysis.onboarding_ops import compute_onboarding_resume_plan
from src.data.models import GenAIIntensity, StartupAnalysis, StartupInput
from src.data.store import AnalysisStore
from src.intelligence.evidence_pipeline import build_intelligence_page_profile, build_startup_evidence_bundle
from src.intelligence.promotion import evaluate_promotion
from src.intelligence.research_workflow import build_structured_research_output, validate_structured_research_output
from src.reports.generator import export_brief_artifacts


def _startup_from_payload(payload: dict) -> StartupInput:
    return StartupInput(
        name=payload["name"],
        website=payload.get("website"),
        description=payload.get("description"),
        industries=payload.get("industries") or [],
        location=payload.get("location"),
        funding_amount=payload.get("funding_amount"),
        funding_type=payload.get("funding_type"),
        lead_investors=payload.get("lead_investors") or [],
    )


def _write_cache_doc(cache_dir: Path, company_name: str, document: dict) -> None:
    slug = company_name.lower().replace(" ", "-").replace(".", "").replace(",", "").replace("&", "and")
    payload = {
        "url": document["url"],
        "result": {
            "url": document["url"],
            "title": document.get("title") or "",
            "content": document.get("content") or "",
            "source_type": document.get("source_type") or "website",
            "content_hash": document.get("content_hash") or f"{document['suffix']}-hash",
            "crawled_at": "2026-03-30T00:00:00+00:00",
        },
    }
    (cache_dir / f"{slug}_{document['suffix']}.json").write_text(json.dumps(payload), encoding="utf-8")


def _write_csv(csv_path: Path, startups: list[StartupInput]) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
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
        )
        for startup in startups:
            writer.writerow(
                [
                    f"Round - {startup.name}",
                    "",
                    "2026-03-30",
                    getattr(startup.funding_stage, "value", startup.funding_stage),
                    startup.website or "",
                    startup.description or "",
                    ", ".join(startup.industries),
                    startup.location or "",
                    startup.funding_amount or "",
                    startup.funding_type or "",
                    ", ".join(startup.lead_investors),
                ]
            )


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fixture",
        default="packages/analysis/tests/fixtures/onboarding_canary/scenarios.json",
        help="Path to the synthetic canary fixture JSON.",
    )
    parser.add_argument(
        "--output-dir",
        default="",
        help="Persist canary artifacts and metrics under this directory instead of a temporary directory.",
    )
    return parser.parse_args(list(argv) if argv is not None else None)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    fixture_path = Path(args.fixture)
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    thresholds = fixture["thresholds"]
    scenarios = fixture["scenarios"]

    started = time.perf_counter()
    uncaught = []
    persisted_output_dir = Path(args.output_dir).resolve() if args.output_dir else None
    if persisted_output_dir is not None:
        persisted_output_dir.mkdir(parents=True, exist_ok=True)
        root_context = nullcontext(str(persisted_output_dir))
    else:
        root_context = tempfile.TemporaryDirectory(prefix="buildatlas-canary-")

    with root_context as tmp_dir:
        root = Path(tmp_dir)
        cache_dir = root / "cache"
        data_dir = root / "apps" / "web" / "data" / "2026-03"
        output_dir = data_dir / "output"
        csv_path = data_dir / "input" / "startups.csv"
        output_dir.mkdir(parents=True, exist_ok=True)
        cache_dir.mkdir(parents=True, exist_ok=True)

        startups: list[StartupInput] = []
        coverage_scores = []
        coverage_improvements = []
        research_outputs = []
        promotion_actions = []

        for scenario in scenarios:
            startup = _startup_from_payload(scenario["startup"])
            startups.append(startup)
            for document in scenario["documents"]:
                _write_cache_doc(cache_dir, startup.name, document)

            try:
                baseline_bundle = build_startup_evidence_bundle(startup, cache_dir=root / "empty-cache", threshold=0.72)
                bundle = build_startup_evidence_bundle(startup, cache_dir=cache_dir, threshold=0.72)
                coverage_scores.append(bundle.coverage.coverage_score)
                coverage_improvements.append(bundle.coverage.coverage_score - baseline_bundle.coverage.coverage_score)

                evidence_context = {
                    "available": True,
                    "documents": [
                        {
                            "source_url": doc.source_url,
                            "source_type": doc.source_type,
                            "page_type": doc.page_type,
                            "snippet": doc.snippet,
                        }
                        for doc in bundle.documents
                    ],
                    "claims": [
                        {
                            "claim_type": claim.claim_type,
                            "claim_value_json": claim.value,
                            "confidence": claim.confidence,
                            "contradiction_state": claim.contradiction_state,
                            "citations": [
                                {
                                    "source_url": citation.source_url,
                                    "source_type": citation.source_type,
                                    "page_type": citation.page_type,
                                    "snippet": citation.snippet,
                                }
                                for citation in claim.evidence
                            ],
                        }
                        for claim in bundle.claims
                    ],
                }
                research_output = build_structured_research_output(
                    startup_name=startup.name,
                    focus_areas=["product", "coverage"],
                    evidence_context=evidence_context,
                    research_context={"materialization_status": "analysis_ready", "recent_events": []},
                )
                validate_structured_research_output(research_output)
                research_outputs.append(research_output)

                profile = build_intelligence_page_profile(startup, bundle)
                decision = evaluate_promotion(
                    {
                        "id": startup.name,
                        "onboarding_status": "stub" if scenario["scenario_id"] == "live_news_discovery" else "verified",
                        "materialization_status": "unmaterialized",
                        "required_field_coverage": profile["coverage"]["coverage_score"],
                        "website": startup.website,
                        "has_analysis_data": True,
                        "has_state_snapshot": scenario["scenario_id"] != "live_news_discovery",
                    }
                )
                promotion_actions.append(decision.action)
            except Exception as exc:  # pragma: no cover - surfaced in metrics + nonzero exit
                uncaught.append({"scenario_id": scenario["scenario_id"], "error": str(exc)})

        _write_csv(csv_path, startups)
        fresh_plan = compute_onboarding_resume_plan(csv_path=csv_path, output_path=output_dir, region="global")
        store = AnalysisStore(output_dir / "analysis_store")
        startup_inputs_by_name = {startup.name: startup for startup in startups}
        for startup in startups:
            analysis = StartupAnalysis(
                company_name=startup.name,
                company_slug=StartupAnalysis.to_slug(startup.name),
                website=startup.website,
                description=startup.description,
                funding_amount=startup.funding_amount,
                funding_stage=startup.funding_stage,
                uses_genai=True,
                genai_intensity=GenAIIntensity.CORE,
                intelligence_page={"coverage": {"coverage_score": 0.95}},
            )
            store.save_base_analysis(analysis, startup)
        export_brief_artifacts(
            analyses=store.get_all_base_analyses(),
            startup_inputs=startup_inputs_by_name,
            output_dir=output_dir,
        )

        artifact_plan = compute_onboarding_resume_plan(csv_path=csv_path, output_path=output_dir, region="global")
        runtime_sec = round(time.perf_counter() - started, 3)

        metrics = {
            "duplicate_startup_rows": len(startups) - len({startup.name for startup in startups}),
            "uncaught_exceptions": uncaught,
            "coverage": {
                "scores": coverage_scores,
                "average": round(sum(coverage_scores) / max(len(coverage_scores), 1), 3),
                "min": round(min(coverage_scores or [0.0]), 3),
                "average_improvement": round(sum(coverage_improvements) / max(len(coverage_improvements), 1), 3),
            },
            "research": {
                "count": len(research_outputs),
                "all_have_citations": all(output.citations for output in research_outputs),
            },
            "resume": {
                "fresh_start_stage": fresh_plan["recommended_start_stage"],
                "artifact_start_stage": artifact_plan["recommended_start_stage"],
            },
            "promotion": {
                "actions": promotion_actions,
                "all_promoted_or_skipped_safely": all(action in {"promote", "skip"} for action in promotion_actions),
            },
            "runtime_sec": runtime_sec,
            "cost_usd": 0.0,
        }

        passes = {
            "no_duplicate_startup_rows": metrics["duplicate_startup_rows"] == 0,
            "no_uncaught_exceptions": not uncaught,
            "coverage_threshold": (
                metrics["coverage"]["min"] >= thresholds["coverage_min"]
                or metrics["coverage"]["average_improvement"] >= thresholds["coverage_improvement_min"]
            ),
            "research_citations": metrics["research"]["all_have_citations"],
            "resume": metrics["resume"]["fresh_start_stage"] == "analysis" and metrics["resume"]["artifact_start_stage"] != "analysis",
            "promotion": metrics["promotion"]["all_promoted_or_skipped_safely"],
            "runtime_regression": metrics["runtime_sec"] <= thresholds["runtime_regression_max_sec"],
            "cost_regression": metrics["cost_usd"] <= thresholds["cost_regression_max_usd"],
        }
        metrics["passes"] = passes
        metrics_path = output_dir / "onboarding_canary_metrics.json"
        metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

        print("Onboarding canary summary")
        print(f"  scenarios={len(scenarios)} coverage_min={metrics['coverage']['min']} avg_improvement={metrics['coverage']['average_improvement']}")
        print(f"  research_outputs={metrics['research']['count']} citations_ok={metrics['research']['all_have_citations']}")
        print(f"  resume=fresh:{metrics['resume']['fresh_start_stage']} artifact:{metrics['resume']['artifact_start_stage']}")
        print(f"  runtime_sec={metrics['runtime_sec']} metrics={metrics_path}")

        return 0 if all(passes.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
