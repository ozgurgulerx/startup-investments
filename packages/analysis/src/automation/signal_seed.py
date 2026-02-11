"""
Seed script for Signal Intelligence Engine tables.

Seeds event_registry (32 canonical event types across 5 domains) and
pattern_registry (20 architecture patterns + 6 GTM clusters) using
authoritative data from memory_gate.py keyword maps.

Usage:
    python -m src.automation.signal_seed
    # or via CLI: python main.py seed-signals
"""

import asyncio
import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Event Registry seed data — 32 canonical event types across 5 domains
# ---------------------------------------------------------------------------

EVENT_REGISTRY: List[Dict[str, str]] = [
    # Architecture events (10)
    {"domain": "architecture", "event_type": "arch_pattern_adopted", "display_name": "Pattern Adopted", "description": "A startup adopts or implements a recognized build pattern", "extraction_method": "heuristic"},
    {"domain": "architecture", "event_type": "arch_pattern_abandoned", "display_name": "Pattern Abandoned", "description": "A startup moves away from a previously adopted pattern", "extraction_method": "llm"},
    {"domain": "architecture", "event_type": "arch_framework_released", "display_name": "Framework Released", "description": "Open-source or commercial framework/tool released", "extraction_method": "heuristic"},
    {"domain": "architecture", "event_type": "arch_migration_announced", "display_name": "Architecture Migration", "description": "A startup announces migration to a new architecture approach", "extraction_method": "hybrid"},
    {"domain": "architecture", "event_type": "arch_benchmark_published", "display_name": "Benchmark Published", "description": "Performance benchmark or evaluation results published", "extraction_method": "heuristic"},
    {"domain": "architecture", "event_type": "arch_model_released", "display_name": "Model Released", "description": "A new AI model or model version released", "extraction_method": "heuristic"},
    {"domain": "architecture", "event_type": "arch_infrastructure_launched", "display_name": "Infrastructure Launched", "description": "New AI infrastructure service or platform launched", "extraction_method": "heuristic"},
    {"domain": "architecture", "event_type": "arch_integration_added", "display_name": "Integration Added", "description": "New integration with major platform or service", "extraction_method": "heuristic"},
    {"domain": "architecture", "event_type": "arch_standard_proposed", "display_name": "Standard Proposed", "description": "Industry standard or specification proposed for AI systems", "extraction_method": "hybrid"},
    {"domain": "architecture", "event_type": "arch_open_sourced", "display_name": "Open Sourced", "description": "Previously proprietary technology open-sourced", "extraction_method": "heuristic"},

    # GTM events (8)
    {"domain": "gtm", "event_type": "gtm_pricing_changed", "display_name": "Pricing Changed", "description": "Pricing model or pricing tiers changed", "extraction_method": "heuristic"},
    {"domain": "gtm", "event_type": "gtm_channel_launched", "display_name": "Channel Launched", "description": "New distribution channel or marketplace listing", "extraction_method": "heuristic"},
    {"domain": "gtm", "event_type": "gtm_market_entered", "display_name": "Market Entered", "description": "Entered a new geographic or vertical market", "extraction_method": "hybrid"},
    {"domain": "gtm", "event_type": "gtm_customer_signed", "display_name": "Customer Signed", "description": "Notable customer win or partnership signed", "extraction_method": "heuristic"},
    {"domain": "gtm", "event_type": "gtm_partnership_announced", "display_name": "Partnership Announced", "description": "Strategic partnership with major company/hyperscaler", "extraction_method": "heuristic"},
    {"domain": "gtm", "event_type": "gtm_vertical_expansion", "display_name": "Vertical Expansion", "description": "Expansion into new vertical or industry segment", "extraction_method": "hybrid"},
    {"domain": "gtm", "event_type": "gtm_open_source_strategy", "display_name": "Open Source Strategy", "description": "Open-source GTM strategy adoption (open-core, community-led)", "extraction_method": "heuristic"},
    {"domain": "gtm", "event_type": "gtm_enterprise_tier_launched", "display_name": "Enterprise Tier Launched", "description": "Enterprise tier, security features, or compliance certifications added", "extraction_method": "heuristic"},

    # Capital events (5)
    {"domain": "capital", "event_type": "cap_funding_raised", "display_name": "Funding Raised", "description": "Startup raises a funding round", "extraction_method": "heuristic"},
    {"domain": "capital", "event_type": "cap_acquisition_announced", "display_name": "Acquisition Announced", "description": "M&A deal announced (acquirer or target)", "extraction_method": "heuristic"},
    {"domain": "capital", "event_type": "cap_ipo_filed", "display_name": "IPO Filed", "description": "IPO or direct listing filing announced", "extraction_method": "heuristic"},
    {"domain": "capital", "event_type": "cap_down_round", "display_name": "Down Round", "description": "Funding round at lower valuation than previous", "extraction_method": "llm"},
    {"domain": "capital", "event_type": "cap_fund_raised_by_vc", "display_name": "VC Fund Raised", "description": "VC firm raises a new fund (affects ecosystem)", "extraction_method": "heuristic"},

    # Org events (4)
    {"domain": "org", "event_type": "org_key_hire", "display_name": "Key Hire", "description": "Notable executive or key technical hire", "extraction_method": "heuristic"},
    {"domain": "org", "event_type": "org_layoff", "display_name": "Layoff", "description": "Significant workforce reduction", "extraction_method": "heuristic"},
    {"domain": "org", "event_type": "org_office_opened", "display_name": "Office Opened", "description": "New office or geographic expansion", "extraction_method": "hybrid"},
    {"domain": "org", "event_type": "org_team_restructure", "display_name": "Team Restructure", "description": "Major organizational restructuring", "extraction_method": "llm"},

    # Product events (5)
    {"domain": "product", "event_type": "prod_launched", "display_name": "Product Launched", "description": "New product or major feature launched", "extraction_method": "heuristic"},
    {"domain": "product", "event_type": "prod_pivoted", "display_name": "Product Pivoted", "description": "Significant product direction change", "extraction_method": "llm"},
    {"domain": "product", "event_type": "prod_sunset", "display_name": "Product Sunset", "description": "Product or service discontinued", "extraction_method": "hybrid"},
    {"domain": "product", "event_type": "prod_major_update", "display_name": "Major Update", "description": "Significant product update or version release", "extraction_method": "heuristic"},
    {"domain": "product", "event_type": "prod_waitlist_opened", "display_name": "Waitlist Opened", "description": "New product waitlist or early access program", "extraction_method": "heuristic"},
]

# ---------------------------------------------------------------------------
# Pattern Registry seed data — from memory_gate.py _PATTERN_KEYWORDS + _GTM_PARENT
# ---------------------------------------------------------------------------
# Imported at seed time to ensure we match the authoritative source.

def _get_architecture_patterns() -> List[Dict[str, Any]]:
    """Build architecture pattern entries from memory_gate.py keyword maps."""
    from src.automation.memory_gate import _PATTERN_KEYWORDS, _PATTERN_CATEGORIES

    patterns = []
    for pattern_name, keywords in _PATTERN_KEYWORDS.items():
        category = _PATTERN_CATEGORIES.get(pattern_name, "Other")
        patterns.append({
            "domain": "architecture",
            "cluster_name": category,
            "pattern_name": pattern_name,
            "keywords": list(keywords),
            "aliases": [],
            "category": category,
            "description": f"Architecture pattern: {pattern_name}",
        })
    return patterns


def _get_gtm_patterns() -> List[Dict[str, Any]]:
    """Build GTM pattern entries from memory_gate.py _GTM_PARENT map."""
    from src.automation.memory_gate import _GTM_PARENT

    # Invert to get parent -> children mapping
    parent_children: Dict[str, List[str]] = {}
    for child, parent in _GTM_PARENT.items():
        parent_children.setdefault(parent, []).append(child)

    patterns = []
    for parent_name, children in parent_children.items():
        patterns.append({
            "domain": "gtm",
            "cluster_name": "GTM Strategy",
            "pattern_name": parent_name,
            "keywords": children,  # Child tags serve as keyword indicators
            "aliases": [],
            "category": "GTM Strategy",
            "description": f"GTM cluster: {parent_name} (sub-tags: {', '.join(children)})",
        })
    return patterns


# ---------------------------------------------------------------------------
# Seed execution
# ---------------------------------------------------------------------------

async def seed_event_registry(conn: "asyncpg.Connection") -> int:
    """Insert canonical event types, skip duplicates."""
    inserted = 0
    for evt in EVENT_REGISTRY:
        result = await conn.execute(
            """INSERT INTO event_registry (domain, event_type, display_name, description, extraction_method)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (event_type) DO NOTHING""",
            evt["domain"], evt["event_type"], evt["display_name"],
            evt["description"], evt["extraction_method"],
        )
        if result == "INSERT 0 1":
            inserted += 1
    return inserted


async def seed_pattern_registry(conn: "asyncpg.Connection") -> int:
    """Insert canonical patterns from memory_gate.py keyword maps, skip duplicates."""
    arch_patterns = _get_architecture_patterns()
    gtm_patterns = _get_gtm_patterns()
    all_patterns = arch_patterns + gtm_patterns

    inserted = 0
    for pat in all_patterns:
        result = await conn.execute(
            """INSERT INTO pattern_registry
                   (domain, cluster_name, pattern_name, keywords, aliases, category, description)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (domain, pattern_name) DO UPDATE SET
                   keywords = EXCLUDED.keywords,
                   cluster_name = EXCLUDED.cluster_name,
                   category = EXCLUDED.category,
                   updated_at = NOW()""",
            pat["domain"], pat["cluster_name"], pat["pattern_name"],
            pat["keywords"], pat["aliases"], pat["category"], pat["description"],
        )
        if "INSERT" in result or "UPDATE" in result:
            inserted += 1
    return inserted


async def seed_all(conn: "asyncpg.Connection") -> Dict[str, int]:
    """Run all seed operations. Returns counts."""
    evt_count = await seed_event_registry(conn)
    pat_count = await seed_pattern_registry(conn)
    logger.info("Seeded %d event types, %d patterns", evt_count, pat_count)
    return {"event_types": evt_count, "patterns": pat_count}


async def run_seed() -> None:
    """Standalone entry point."""
    import asyncpg
    import os

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for signal seeding")
    conn = await asyncpg.connect(database_url)
    try:
        counts = await seed_all(conn)
        print(f"Seeded: {counts['event_types']} event types, {counts['patterns']} patterns")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_seed())
