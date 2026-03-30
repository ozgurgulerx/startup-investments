"""Operational helpers for CSV onboarding and recovery."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Set

from src.config import settings
from src.automation.newsletter_generator import write_newsletter_data
from src.crawler.engine import get_company_slug
from src.data.ingestion import load_startups_from_csv, load_unique_startups_from_csv
from src.data.monthly_stats import MonthlyStatistics
from src.data.store import AnalysisStore
from src.reports.generator import create_analysis_only_csv, create_enriched_csv
from src.reports.newsletter_generator import generate_viral_newsletter


def normalize_startup_name(name: str) -> str:
    """Normalize startup names for deterministic allowlist matching."""
    return str(name or "").strip().lower()


def load_startup_allowlist(startup_file: Path) -> Set[str]:
    """Load a newline-delimited startup allowlist."""
    names: Set[str] = set()
    for raw_line in startup_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        names.add(normalize_startup_name(line))
    return names


def resolve_repo_dataset_paths(period: str, region: str = "global") -> Dict[str, Path]:
    """Resolve repo-level apps/web dataset paths for a period and region."""
    repo_root = Path(__file__).resolve().parents[4]
    data_root = repo_root / "apps" / "web" / "data"
    if region == "global":
        period_root = data_root / period
    else:
        period_root = data_root / region / period
    return {
        "period_root": period_root,
        "csv_path": period_root / "input" / "startups.csv",
        "output_path": period_root / "output",
    }


def regenerate_output_artifacts(
    csv_path: Path,
    output_path: Path,
    period: Optional[str] = None,
    store: Optional[AnalysisStore] = None,
) -> Dict[str, str]:
    """Refresh CSV and monthly stats artifacts from the analysis store."""
    resolved_store = store or AnalysisStore(output_path / "analysis_store")
    startups = load_startups_from_csv(csv_path)
    analyses = resolved_store.get_all_base_analyses()

    analysis_csv = create_analysis_only_csv(analyses, output_path)
    enriched_csv = create_enriched_csv(csv_path, analyses, output_path)

    stats_period = period or settings.extract_period_from_path(csv_path)
    monthly_stats_path = None
    monthly_summary_path = None
    newsletter_data_path = None
    viral_newsletter_path = None
    viral_sidecar_path = None
    if stats_period:
        monthly_stats = MonthlyStatistics(stats_period)
        monthly_stats.generate_full_stats(startups, analyses)
        monthly_stats_path = monthly_stats.save(output_path)
        monthly_summary_path = monthly_stats.generate_summary_report(output_path.parent)
        data_root = _resolve_data_root_from_csv(csv_path)
        newsletter_data_path = write_newsletter_data(
            stats_period,
            data_root,
            output_path / "newsletter_data.json",
        )
        if analyses:
            generate_viral_newsletter(
                [analysis.model_dump(mode="json") for analysis in analyses],
                output_path,
                newsletter_name="Build Patterns Monthly",
            )
            viral_newsletter_path = output_path / "viral_newsletter.md"
            viral_sidecar_path = output_path / "viral_newsletter_data.json"

    return {
        "analysis_results_csv": str(analysis_csv),
        "startups_enriched_csv": str(enriched_csv),
        "monthly_stats_json": str(monthly_stats_path) if monthly_stats_path else "",
        "monthly_summary_report": str(monthly_summary_path) if monthly_summary_path else "",
        "newsletter_data_json": str(newsletter_data_path) if newsletter_data_path else "",
        "viral_newsletter_md": str(viral_newsletter_path) if viral_newsletter_path else "",
        "viral_newsletter_data_json": str(viral_sidecar_path) if viral_sidecar_path else "",
        "base_analysis_count": str(len(analyses)),
    }


ONBOARDING_STAGE_ORDER = [
    "analysis",
    "artifact_refresh",
    "db_sync",
    "analysis_materialization",
    "state_backfill",
    "logos",
    "deep_dives",
    "monthly_outputs",
]


def _resolve_data_root_from_csv(csv_path: Path) -> Path:
    """Resolve the `apps/web/data` root from a period CSV path."""
    csv_path = Path(csv_path)
    if csv_path.parent.name != "input":
        raise ValueError(f"Expected startup CSV under an input/ directory, got: {csv_path}")

    period_root = csv_path.parent.parent
    if period_root.name == "tr":
        return period_root.parent
    if period_root.parent.name == "tr":
        return period_root.parent.parent
    return period_root.parent


def compute_onboarding_preflight(
    csv_path: Path,
    output_path: Path,
    region: str = "global",
) -> Dict[str, Any]:
    """Compute read-only diagnostics for a period-scoped onboarding pipeline."""
    startups = load_startups_from_csv(csv_path)
    store = AnalysisStore(output_path / "analysis_store")
    unique_names = sorted({startup.name for startup in startups if startup.name})
    analyzed_names: Set[str] = set()

    for name in unique_names:
        slug = get_company_slug(name)
        if (store.base_dir / f"{slug}.json").exists():
            analyzed_names.add(name)

    rows_with_base_analysis = sum(1 for startup in startups if startup.name in analyzed_names)
    rows_without_base_analysis = max(0, len(startups) - rows_with_base_analysis)

    hash_covered = sum(
        1
        for meta in store.index.get("startups", {}).values()
        if len(str(meta.get("hash") or "").strip()) >= 16
    )
    index_entries = len(store.index.get("startups", {}))
    hash_coverage_pct = (hash_covered * 100.0 / index_entries) if index_entries else 0.0

    cache_dir = Path(settings.crawler.cache_dir)
    cache_nonempty = 0
    cache_threshold = 0
    cache_threshold_chars = 500
    for name in unique_names:
        cached_chars = _get_cached_content_chars(cache_dir, name)
        if cached_chars > 0:
            cache_nonempty += 1
        if cached_chars >= cache_threshold_chars:
            cache_threshold += 1

    progress = _read_progress(output_path / "analysis_store" / "progress.json")
    db_counts = _load_db_counts(region=region, period=settings.extract_period_from_path(csv_path) or "")

    report = {
        "period": settings.extract_period_from_path(csv_path),
        "region": region,
        "paths": {
            "csv_path": str(csv_path),
            "output_path": str(output_path),
            "analysis_store_path": str(output_path / "analysis_store"),
        },
        "csv": {
            "rows": len(startups),
            "unique_startups": len(unique_names),
        },
        "analysis_store": {
            "base_analysis_files": store.count_base_analysis_files(),
            "index_entries": index_entries,
            "index_hash_covered": hash_covered,
            "index_hash_coverage_pct": round(hash_coverage_pct, 1),
            "analyzed_unique_startups": len(analyzed_names),
            "rows_with_base_analysis": rows_with_base_analysis,
            "rows_without_base_analysis": rows_without_base_analysis,
            "backlog_unique": max(0, len(unique_names) - len(analyzed_names)),
        },
        "crawler_cache": {
            "unique_startups_with_any_cache": cache_nonempty,
            "unique_startups_with_sufficient_cache": cache_threshold,
            "threshold_chars": cache_threshold_chars,
        },
        "progress": progress,
        "database": db_counts,
        "credentials": {
            "azure_openai_endpoint": bool(settings.azure_openai.endpoint),
            "azure_openai_api_key": bool(settings.azure_openai.api_key),
            "openai_api_key": bool(os.getenv("OPENAI_API_KEY")),
            "database_url": bool(os.getenv("DATABASE_URL")),
        },
    }
    report["health"] = evaluate_onboarding_health(report)
    return report


def compute_onboarding_resume_plan(
    csv_path: Path,
    output_path: Path,
    region: str = "global",
) -> Dict[str, Any]:
    """Determine the earliest onboarding stage that still needs to run."""
    startups = load_startups_from_csv(csv_path)
    unique_startups = load_unique_startups_from_csv(csv_path)
    unique_count = len(unique_startups)

    store = AnalysisStore(output_path / "analysis_store")
    analyzed_unique = {
        startup.name
        for startup in unique_startups
        if store.get_base_analysis(startup.name) is not None
    }
    analyzed_unique_count = len(analyzed_unique)
    progress = _read_progress(output_path / "analysis_store" / "progress.json")
    period = settings.extract_period_from_path(csv_path) or ""
    db_counts = _load_db_counts(region=region, period=period)

    output_files = {
        "analysis_results_csv": output_path / "analysis_results.csv",
        "startups_enriched_csv": output_path / "startups_enriched_with_analysis.csv",
        "monthly_stats_json": output_path / "monthly_stats.json",
        "newsletter_data_json": output_path / "newsletter_data.json",
        "viral_newsletter_md": output_path / "viral_newsletter.md",
        "deep_research_index_json": output_path / "deep_research" / "index.json",
    }
    output_exists = {key: path.exists() for key, path in output_files.items()}

    db_total = int(db_counts.get("total") or 0)
    with_analysis_data = int(db_counts.get("with_analysis_data") or 0)
    state_ready = int(db_counts.get("state_ready") or 0)

    monthly_outputs_complete = all(output_exists[key] for key in (
        "monthly_stats_json",
        "newsletter_data_json",
        "viral_newsletter_md",
        "deep_research_index_json",
    ))

    stage_status = {
        "analysis": {
            "complete": analyzed_unique_count >= unique_count and unique_count > 0,
            "detail": f"{analyzed_unique_count}/{unique_count} unique startups have base analyses",
        },
        "artifact_refresh": {
            "complete": (
                analyzed_unique_count >= unique_count
                and output_exists["analysis_results_csv"]
                and output_exists["startups_enriched_csv"]
            ),
            "detail": (
                f"analysis_results.csv={output_exists['analysis_results_csv']} "
                f"startups_enriched_with_analysis.csv={output_exists['startups_enriched_csv']}"
            ),
        },
        "db_sync": {
            "complete": bool(db_counts.get("available")) and db_total >= unique_count and unique_count > 0,
            "detail": (
                f"database_rows={db_total}/{unique_count}"
                if db_counts.get("available")
                else f"database unavailable: {db_counts.get('reason')}"
            ),
        },
        "analysis_materialization": {
            "complete": bool(db_counts.get("available")) and with_analysis_data >= analyzed_unique_count and analyzed_unique_count > 0,
            "detail": (
                f"analysis_data_rows={with_analysis_data}/{analyzed_unique_count}"
                if db_counts.get("available")
                else f"database unavailable: {db_counts.get('reason')}"
            ),
        },
        "state_backfill": {
            "complete": bool(db_counts.get("available")) and state_ready >= with_analysis_data and with_analysis_data > 0,
            "detail": (
                f"state_ready_rows={state_ready}/{with_analysis_data}"
                if db_counts.get("available")
                else f"database unavailable: {db_counts.get('reason')}"
            ),
        },
        "logos": {
            "complete": monthly_outputs_complete,
            "detail": "logos are treated as complete once later monthly outputs exist; otherwise rerun from this safe boundary",
        },
        "deep_dives": {
            "complete": monthly_outputs_complete,
            "detail": "deep dives are treated as complete once later monthly outputs exist; otherwise rerun from this safe boundary",
        },
        "monthly_outputs": {
            "complete": monthly_outputs_complete,
            "detail": (
                f"monthly_stats={output_exists['monthly_stats_json']} "
                f"newsletter_data={output_exists['newsletter_data_json']} "
                f"viral_newsletter={output_exists['viral_newsletter_md']} "
                f"deep_research_index={output_exists['deep_research_index_json']}"
            ),
        },
        "blob_publish": {
            "complete": False,
            "detail": "blob publish is treated as a final idempotent sync step",
        },
        "postflight": {
            "complete": False,
            "detail": "postflight is always safe to rerun",
        },
    }

    recommended_start_stage = "completed"
    reason = "All durable onboarding stages appear complete"
    for stage_name in ONBOARDING_STAGE_ORDER:
        if not stage_status[stage_name]["complete"]:
            recommended_start_stage = stage_name
            reason = stage_status[stage_name]["detail"]
            break

    return {
        "period": period,
        "region": region,
        "paths": {
            "csv_path": str(csv_path),
            "output_path": str(output_path),
        },
        "csv": {
            "rows": len(startups),
            "unique_startups": unique_count,
        },
        "analysis_store": {
            "base_analysis_files": store.count_base_analysis_files(),
            "analyzed_unique_startups": analyzed_unique_count,
        },
        "progress": progress,
        "database": db_counts,
        "output_files": output_exists,
        "stages": stage_status,
        "recommended_start_stage": recommended_start_stage,
        "reason": reason,
    }


def evaluate_onboarding_health(
    report: Dict[str, Any],
    backlog_warn: int = 25,
    backlog_fail: int = 100,
    progress_stale_warn_min: int = 45,
    progress_stale_fail_min: int = 120,
    hash_coverage_warn_pct: float = 50.0,
) -> Dict[str, Any]:
    """Evaluate onboarding lag/staleness from a preflight report."""
    alerts = []

    backlog_unique = int(report.get("analysis_store", {}).get("backlog_unique") or 0)
    if backlog_unique >= backlog_fail:
        alerts.append({"severity": "fail", "message": f"Backlog remains high ({backlog_unique} unique startups)"})
    elif backlog_unique >= backlog_warn:
        alerts.append({"severity": "warn", "message": f"Backlog remains elevated ({backlog_unique} unique startups)"})

    progress = report.get("progress") or {}
    stale_minutes = progress.get("stale_minutes")
    if progress.get("status") == "running" and stale_minutes is not None:
        stale_minutes = int(stale_minutes)
        if stale_minutes >= progress_stale_fail_min:
            alerts.append({"severity": "fail", "message": f"Progress checkpoint stale while running ({stale_minutes}m)"})
        elif stale_minutes >= progress_stale_warn_min:
            alerts.append({"severity": "warn", "message": f"Progress checkpoint aging while running ({stale_minutes}m)"})

    base_analysis_files = int(report.get("analysis_store", {}).get("base_analysis_files") or 0)
    hash_coverage_pct = float(report.get("analysis_store", {}).get("index_hash_coverage_pct") or 0.0)
    if base_analysis_files > 0 and hash_coverage_pct <= 0.0:
        alerts.append({"severity": "fail", "message": "Index hash coverage is zero despite existing base analyses"})
    elif base_analysis_files > 0 and hash_coverage_pct < hash_coverage_warn_pct:
        alerts.append({"severity": "warn", "message": f"Index hash coverage is low ({hash_coverage_pct:.1f}%)"})

    endpoint_present = bool(report.get("credentials", {}).get("azure_openai_endpoint"))
    auth_present = bool(report.get("credentials", {}).get("azure_openai_api_key")) or bool(
        report.get("credentials", {}).get("openai_api_key")
    )
    if not endpoint_present:
        alerts.append({"severity": "fail", "message": "Azure OpenAI endpoint is not configured"})
    elif not auth_present:
        alerts.append({"severity": "warn", "message": "No API-key LLM credential detected; relying on managed identity"})

    severity_rank = {"ok": 0, "warn": 1, "fail": 2}
    overall_status = "ok"
    for alert in alerts:
        if severity_rank[alert["severity"]] > severity_rank[overall_status]:
            overall_status = alert["severity"]

    return {
        "status": overall_status,
        "alerts": alerts,
    }


def _get_cached_content_chars(cache_dir: Path, company_name: str) -> int:
    """Approximate total cached crawl content for a startup."""
    slug = get_company_slug(company_name)
    total_chars = 0
    for cache_file in cache_dir.glob(f"{slug}_*.json"):
        try:
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        total_chars += len(payload.get("result", {}).get("content", "") or "")
    return total_chars


def _read_progress(progress_file: Path) -> Dict[str, Any]:
    """Read progress metadata with a computed staleness value."""
    if not progress_file.exists():
        return {
            "exists": False,
            "status": "missing",
            "stale_minutes": None,
        }

    try:
        payload = json.loads(progress_file.read_text(encoding="utf-8"))
    except Exception as exc:
        return {
            "exists": True,
            "status": "unreadable",
            "stale_minutes": None,
            "error": str(exc),
        }

    updated_at = payload.get("updated_at")
    stale_minutes = None
    if updated_at:
        try:
            updated = datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
            stale_minutes = int((datetime.now(timezone.utc) - updated).total_seconds() / 60)
        except Exception:
            stale_minutes = None

    return {
        "exists": True,
        "status": payload.get("status") or "unknown",
        "updated_at": updated_at,
        "stale_minutes": stale_minutes,
        "completed": payload.get("completed"),
        "delta_total": payload.get("delta_total"),
        "latest_startup": payload.get("latest_startup"),
        "latest_stage": payload.get("latest_stage") or payload.get("latest_status"),
        "latest_stage_started_at": payload.get("latest_stage_started_at"),
        "latest_stage_elapsed_sec": payload.get("latest_stage_elapsed_sec"),
        "error_count": payload.get("error_count"),
    }


def _load_db_counts(region: str, period: str) -> Dict[str, Any]:
    """Load startup counts from Postgres when available."""
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        return {
            "available": False,
            "reason": "DATABASE_URL missing",
        }

    try:
        import psycopg2
    except Exception as exc:
        return {
            "available": False,
            "reason": f"psycopg2 unavailable: {exc}",
        }

    try:
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'startups'
              AND column_name IN ('onboarding_status', 'status', 'materialization_status')
            """
        )
        available_columns = {row[0] for row in cur.fetchall()}
        status_column = "onboarding_status" if "onboarding_status" in available_columns else ("status" if "status" in available_columns else None)
        has_materialization = "materialization_status" in available_columns

        select_parts = [
            "COUNT(*) AS total",
            """COUNT(*) FILTER (
                WHERE analysis_data IS NOT NULL
                  AND analysis_data::text <> '{}'
            ) AS with_analysis_data""",
        ]
        if status_column:
            select_parts.extend([
                f"COUNT(*) FILTER (WHERE {status_column} = 'verified') AS verified",
                f"COUNT(*) FILTER (WHERE {status_column} = 'stub') AS stub",
            ])
        if has_materialization:
            select_parts.extend([
                """COUNT(*) FILTER (
                    WHERE COALESCE(materialization_status, 'unmaterialized') = 'analysis_ready'
                ) AS analysis_ready""",
                """COUNT(*) FILTER (
                    WHERE COALESCE(materialization_status, 'unmaterialized') = 'state_ready'
                ) AS state_ready""",
            ])

        cur.execute(
            f"""
            SELECT
                {', '.join(select_parts)}
            FROM startups
            WHERE dataset_region = %s
              AND period = %s
            """,
            (region, period),
        )

        row = cur.fetchone()
        cur.close()
        conn.close()
        total = row[0]
        with_analysis_data = row[1]
        verified = row[2] if status_column else None
        stub = row[3] if status_column else None
        analysis_ready = row[4] if status_column and has_materialization else (row[2] if has_materialization else None)
        state_ready = row[5] if status_column and has_materialization else (row[3] if has_materialization else None)
        return {
            "available": True,
            "total": int(total or 0),
            "with_analysis_data": int(with_analysis_data or 0),
            "verified": int(verified or 0) if verified is not None else None,
            "stub": int(stub or 0) if stub is not None else None,
            "analysis_ready": int(analysis_ready or 0) if analysis_ready is not None else None,
            "state_ready": int(state_ready or 0) if state_ready is not None else None,
            "status_column": status_column,
            "materialization_column": has_materialization,
        }
    except Exception as exc:
        return {
            "available": False,
            "reason": str(exc),
        }
