"""Data ingestion from CSV files."""

import csv
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from src.data.models import StartupInput


def _normalize_startup_name(name: str) -> str:
    return str(name or "").strip().lower()


def _has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def _candidate_rank(startup: StartupInput, row: Dict[str, str], row_index: int) -> Tuple[int, float, int]:
    completeness = sum(
        1
        for value in [
            startup.website,
            startup.description,
            startup.location,
            startup.industries,
            startup.lead_investors,
            startup.crunchbase_url,
            row.get("Announced Date"),
            row.get("Funding Stage"),
        ]
        if _has_value(value)
    )
    return completeness, float(startup.funding_amount or 0.0), -row_index


def _read_startups_from_csv(
    csv_path: Path,
    limit: Optional[int] = None,
) -> List[Tuple[StartupInput, Dict[str, str], int]]:
    parsed_startups: List[Tuple[StartupInput, Dict[str, str], int]] = []

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            if limit and i >= limit:
                break

            try:
                startup = StartupInput.from_csv_row(row)
                if startup.name:
                    parsed_startups.append((startup, row, i))
            except Exception as e:
                print(f"Error parsing row {i}: {e}")

    return parsed_startups


def load_startups_from_csv(csv_path: Path, limit: Optional[int] = None) -> List[StartupInput]:
    """Load startups from a CSV file.

    Args:
        csv_path: Path to the CSV file
        limit: Optional limit on number of startups to load

    Returns:
        List of StartupInput objects
    """
    return [startup for startup, _, _ in _read_startups_from_csv(csv_path, limit=limit)]


def load_unique_startups_from_csv(csv_path: Path, limit: Optional[int] = None) -> List[StartupInput]:
    """Load one canonical startup row per company for analysis-time onboarding.

    This keeps the raw CSV unchanged for funding-round sync while ensuring the
    analysis store only processes one row for companies that appear multiple
    times in the monthly dataset.
    """
    selected_by_name: Dict[str, Tuple[Tuple[int, float, int], StartupInput, int]] = {}

    for startup, row, row_index in _read_startups_from_csv(csv_path, limit=limit):
        normalized_name = _normalize_startup_name(startup.name)
        rank = _candidate_rank(startup, row, row_index)
        current = selected_by_name.get(normalized_name)
        if current is None or rank > current[0]:
            selected_by_name[normalized_name] = (rank, startup, row_index)

    ranked_startups = sorted(selected_by_name.values(), key=lambda item: item[2])
    return [startup for _, startup, _ in ranked_startups]


def filter_startups(
    startups: List[StartupInput],
    min_funding: Optional[float] = None,
    has_website: bool = True,
    industries_contain: Optional[List[str]] = None,
) -> List[StartupInput]:
    """Filter startups based on criteria.

    Args:
        startups: List of startups to filter
        min_funding: Minimum funding amount
        has_website: Only include startups with websites
        industries_contain: Only include startups in these industries

    Returns:
        Filtered list of startups
    """
    filtered = startups

    if has_website:
        filtered = [s for s in filtered if s.website]

    if min_funding:
        filtered = [s for s in filtered if s.funding_amount and s.funding_amount >= min_funding]

    if industries_contain:
        industries_lower = [i.lower() for i in industries_contain]
        filtered = [
            s for s in filtered
            if any(ind.lower() in industries_lower for ind in s.industries)
            or any(i in " ".join(s.industries).lower() for i in industries_lower)
        ]

    return filtered


def get_pilot_startups(csv_path: Path) -> List[StartupInput]:
    """Get the curated list of pilot startups for initial analysis.

    These are selected for their potential to reveal interesting GenAI patterns.
    """
    all_startups = load_startups_from_csv(csv_path)

    # Target companies for pilot (from the plan)
    # Start with 5 high-signal companies for initial pilot
    pilot_names = [
        "Parloa",         # $350M - AI agent management for contact centers
        "Deepgram",       # $143M - Voice AI platform
        "WitnessAI",      # $58M - AI guardrails/safety
        "Articul8",       # $35M - Enterprise GenAI platform
        "Listen Labs",    # $69M - AI-first customer research
    ]

    pilot_names_lower = [n.lower() for n in pilot_names]

    # Find matching startups
    pilot = [
        s for s in all_startups
        if s.name.lower() in pilot_names_lower
    ]

    # If we didn't find all, also try partial matching
    found_names = [s.name.lower() for s in pilot]
    for startup in all_startups:
        if len(pilot) >= 15:
            break
        if startup.name.lower() not in found_names:
            for target in pilot_names_lower:
                if target in startup.name.lower() or startup.name.lower() in target:
                    pilot.append(startup)
                    found_names.append(startup.name.lower())
                    break

    return pilot


def summarize_startups(startups: List[StartupInput]) -> str:
    """Create a summary of startups for cross-analysis."""
    lines = []
    for s in startups:
        funding_str = f"${s.funding_amount:,.0f}" if s.funding_amount else "Unknown"
        lines.append(f"- {s.name} ({s.funding_stage.value}, {funding_str}): {s.description or 'No description'}")

    return "\n".join(lines)
