"""Export completed deep-research notes as per-startup markdown artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterable, List

from src.crawler.engine import get_company_slug


def _coerce_payload(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _json_safe_scalar(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    return value


def format_deep_research_markdown(record: Dict[str, Any]) -> str:
    """Render a deep-research queue row as a local markdown artifact."""
    payload = _coerce_payload(record.get("research_output"))
    lines: List[str] = [
        f"# {record.get('startup_name') or 'Unknown Startup'}",
        "",
        "## Metadata",
        "",
    ]

    metadata_rows = [
        ("Period", record.get("period")),
        ("Region", record.get("dataset_region")),
        ("Depth", record.get("research_depth") or payload.get("depth")),
        ("Reason", record.get("reason")),
        ("Completed At", record.get("completed_at")),
        ("Model", payload.get("model")),
        ("Materialization Status", payload.get("materialization_status")),
        ("Human Context Used", payload.get("human_context_used")),
        ("Analysis Context Used", payload.get("analysis_context_used")),
        ("Recent Event Count", payload.get("recent_event_count")),
    ]
    for label, value in metadata_rows:
        if value in (None, "", [], {}):
            continue
        lines.append(f"- **{label}:** {value}")

    focus_areas = payload.get("focus_areas")
    if isinstance(focus_areas, list) and focus_areas:
        lines.append(f"- **Focus Areas:** {', '.join(str(item) for item in focus_areas if item)}")

    website = record.get("website")
    if website:
        lines.append(f"- **Website:** {website}")

    lines.extend(["", "## Analysis", ""])
    analysis_text = str(payload.get("analysis") or "").strip()
    if analysis_text:
        lines.append(analysis_text)
    else:
        lines.append("_No deep-research analysis text was stored for this startup._")

    return "\n".join(lines).strip() + "\n"


def write_deep_research_artifacts(
    records: Iterable[Dict[str, Any]],
    output_dir: Path,
) -> Dict[str, Any]:
    """Write latest deep-research markdown artifacts and a summary index."""
    deep_research_dir = Path(output_dir) / "deep_research"
    deep_research_dir.mkdir(parents=True, exist_ok=True)

    written: List[Dict[str, Any]] = []
    for record in records:
        startup_name = str(record.get("startup_name") or "").strip()
        if not startup_name:
            continue
        slug = str(record.get("slug") or "").strip() or get_company_slug(startup_name)
        markdown_path = deep_research_dir / f"{slug}.md"
        markdown_path.write_text(format_deep_research_markdown(record), encoding="utf-8")
        written.append(
            {
                "startup_name": startup_name,
                "slug": slug,
                "path": str(markdown_path),
                "completed_at": _json_safe_scalar(record.get("completed_at")),
                "research_depth": _json_safe_scalar(record.get("research_depth")),
            }
        )

    index_path = deep_research_dir / "index.json"
    index_path.write_text(
        json.dumps(
            {
                "count": len(written),
                "items": written,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    return {
        "output_dir": str(deep_research_dir),
        "index_path": str(index_path),
        "count": len(written),
    }


async def export_period_deep_research(
    conn,
    *,
    period: str,
    region: str,
    output_dir: Path,
) -> Dict[str, Any]:
    """Export the latest completed deep-research artifact for each startup in a period."""
    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (s.id)
            s.name AS startup_name,
            s.slug,
            s.website,
            s.period,
            s.dataset_region,
            q.reason,
            q.research_depth,
            q.completed_at,
            q.research_output
        FROM deep_research_queue q
        JOIN startups s ON s.id = q.startup_id
        WHERE q.status = 'completed'
          AND q.research_output IS NOT NULL
          AND s.period = $1
          AND s.dataset_region = $2
          AND COALESCE(s.onboarding_status, 'verified') NOT IN ('merged', 'rejected')
        ORDER BY s.id, q.completed_at DESC NULLS LAST, q.queued_at DESC
        """,
        period,
        region,
    )
    normalized_rows = [dict(row) for row in rows]
    return write_deep_research_artifacts(normalized_rows, output_dir)
