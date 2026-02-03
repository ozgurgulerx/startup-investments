"""Data ingestion from CSV files."""

import csv
from pathlib import Path
from typing import List, Optional

from src.data.models import StartupInput


def load_startups_from_csv(csv_path: Path, limit: Optional[int] = None) -> List[StartupInput]:
    """Load startups from a CSV file.

    Args:
        csv_path: Path to the CSV file
        limit: Optional limit on number of startups to load

    Returns:
        List of StartupInput objects
    """
    startups = []

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            if limit and i >= limit:
                break

            try:
                startup = StartupInput.from_csv_row(row)
                if startup.name:  # Only add if we have a name
                    startups.append(startup)
            except Exception as e:
                print(f"Error parsing row {i}: {e}")

    return startups


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
