"""
Monthly newsletter data aggregator for BuildAtlas.

Reads startups.csv and analysis_store to produce newsletter_data.json
with all pre-computed stats for the web/email newsletter.
"""

import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import median
from typing import Any


# Category classification based on industries and description keywords
CATEGORY_RULES: list[tuple[str, list[str], list[str]]] = [
    # (category_name, industry_keywords, description_keywords)
    ("Robotics & Physical AI", ["Robotics", "Autonomous Vehicles", "Automotive", "Drone"], ["robot", "autonomous driv", "self-driving", "humanoid", "physical ai"]),
    ("Generative AI / Foundation Models", [], ["foundation model", "large language model", "generative ai", "llm", "text generation", "image generation"]),
    ("AI Infrastructure", ["Semiconductor", "AI Infrastructure"], ["chip", "compute", "gpu", "silicon", "inference", "wafer", "optical", "data center"]),
    ("Fintech AI", ["Fintech", "Financial Services", "Banking", "Payments", "Insurance"], ["fintech", "banking", "payment", "insurance", "lending", "credit"]),
    ("Security AI", ["Cyber Security", "Information Security", "Network Security"], ["security", "cybersecurity", "threat", "vulnerability", "compliance"]),
    ("Healthcare AI", ["Health Care", "Biotechnology", "Medical", "Pharmaceutical"], ["health", "medical", "clinical", "patient", "diagnostic", "pharma", "biotech"]),
    ("Agentic AI", [], ["agent", "agentic", "autonomous workflow", "multi-step"]),
    ("Enterprise SaaS + AI", ["SaaS", "Enterprise Software", "Information Technology", "Software"], []),
]

# Big 5 companies by name for special highlighting
BIG_5_NAMES = ["Anthropic", "Waymo", "Wayve", "World Labs", "Cerebras"]

# Region mapping from location string
REGION_MAP = {
    "North America": "North America",
    "Europe": "Europe",
    "Asia": "Asia",
    "Oceania": "Oceania",
    "South America": "Other",
    "Africa": "Other",
    "Middle East": "Other",
}

# Funding stage normalization
STAGE_MAP = {
    "Seed": "Seed",
    "Pre-Seed": "Pre-Seed",
    "Early Stage Venture": "Series A",
    "Late Stage Venture": "Series C+",
    "Growth Equity": "Series C+",
    "Private Equity": "Series C+",
    "Venture - Unknown": "Seed",
    "Angel": "Pre-Seed",
    "Undisclosed": "Seed",
}


def _classify_category(industries: str, description: str, name: str) -> str:
    """Classify a startup into a newsletter category."""
    ind_lower = industries.lower()
    desc_lower = description.lower()
    name_lower = name.lower()

    # Special cases for known companies
    if any(n.lower() in name_lower for n in ["anthropic", "openai", "mistral", "cohere", "ai21"]):
        return "Generative AI / Foundation Models"

    for category, ind_keywords, desc_keywords in CATEGORY_RULES:
        for kw in ind_keywords:
            if kw.lower() in ind_lower:
                return category
        for kw in desc_keywords:
            if kw in desc_lower:
                return category

    return "Enterprise SaaS + AI"  # default bucket


def _normalize_stage(funding_type: str, funding_stage: str) -> str:
    """Normalize funding stage to newsletter categories."""
    ft = funding_type.strip()

    # Direct mapping from funding type
    if "Pre-Seed" in ft or "Angel" in ft:
        return "Pre-Seed"
    if "Seed" in ft and "Pre" not in ft:
        return "Seed"
    if "Series A" in ft:
        return "Series A"
    if "Series B" in ft:
        return "Series B"
    if any(s in ft for s in ["Series C", "Series D", "Series E", "Series F", "Series G", "Series H"]):
        return "Series C+"

    # Fall back to funding_stage field
    return STAGE_MAP.get(funding_stage.strip(), "Seed")


def _extract_region(location: str) -> str:
    """Extract region from location string."""
    for region_key, region_val in REGION_MAP.items():
        if region_key in location:
            return region_val
    return "Other"


def _extract_country(location: str) -> str:
    """Extract country from location string."""
    parts = [p.strip() for p in location.split(",")]
    if len(parts) >= 3:
        return parts[-2]  # second-to-last is usually country
    if len(parts) >= 2:
        return parts[-1]
    return location


def _format_currency(amount: float) -> str:
    """Format amount as human-readable currency."""
    if amount >= 1_000_000_000:
        return f"${amount / 1_000_000_000:.1f}B"
    if amount >= 1_000_000:
        return f"${amount / 1_000_000:.0f}M"
    if amount >= 1_000:
        return f"${amount / 1_000:.0f}K"
    return f"${amount:.0f}"


def _format_period_label(period: str) -> str:
    """Format YYYY-MM period strings as Month YYYY."""
    try:
        year, month = str(period).split("-", 1)
        month_names = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ]
        month_index = int(month) - 1
        if 0 <= month_index < len(month_names):
            return f"{month_names[month_index]} {year}"
    except Exception:
        pass
    return str(period)


def load_csv_data(csv_path: Path) -> list[dict[str, Any]]:
    """Load and parse the startups CSV."""
    rows = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            funding_usd = row.get("Money Raised (in USD)", "0")
            try:
                amount = float(funding_usd) if funding_usd else 0
            except ValueError:
                amount = 0

            # Extract company name from transaction name
            tx_name = row.get("Transaction Name", "")
            # Pattern: "Series X - CompanyName" or "Seed Round - CompanyName"
            name_match = re.match(r"^[^-]+-\s*(.+)$", tx_name)
            company_name = name_match.group(1).strip() if name_match else tx_name

            rows.append({
                "transaction_name": tx_name,
                "company_name": company_name,
                "funding_type": row.get("Funding Type", ""),
                "funding_usd": amount,
                "funding_stage": row.get("Funding Stage", ""),
                "description": row.get("Organization Description", ""),
                "website": row.get("Organization Website", ""),
                "industries": row.get("Organization Industries", ""),
                "location": row.get("Organization Location", ""),
                "lead_investors": row.get("Lead Investors", ""),
            })
    return rows


def load_analyses(store_path: Path) -> dict[str, dict[str, Any]]:
    """Load all base analyses from the analysis store."""
    analyses = {}
    base_dir = store_path / "base_analyses"
    if not base_dir.exists():
        return analyses

    for f in base_dir.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            slug = data.get("company_slug", f.stem)
            analyses[slug] = data
        except (json.JSONDecodeError, KeyError):
            continue
    return analyses


def generate_newsletter_data(period: str, data_root: Path) -> dict[str, Any]:
    """Generate all newsletter data for a given period."""
    csv_path = data_root / period / "input" / "startups.csv"
    store_path = data_root / period / "output" / "analysis_store"

    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    # Load data
    rows = load_csv_data(csv_path)
    analyses = load_analyses(store_path)

    total_funding = sum(r["funding_usd"] for r in rows)
    total_rounds = len(rows)
    amounts = [r["funding_usd"] for r in rows if r["funding_usd"] > 0]
    median_round = median(amounts) if amounts else 0
    avg_round = total_funding / total_rounds if total_rounds else 0

    # --- Section 1: Hero ---
    hero = {
        "total_funding": total_funding,
        "total_funding_formatted": _format_currency(total_funding),
        "total_rounds": total_rounds,
        "median_round": median_round,
        "median_round_formatted": _format_currency(median_round),
        "avg_round": avg_round,
        "avg_round_formatted": _format_currency(avg_round),
    }

    # --- Section 2: Capital Flow by Category ---
    cat_data: dict[str, dict[str, Any]] = defaultdict(lambda: {"rounds": 0, "total_funding": 0, "companies": []})
    for r in rows:
        cat = _classify_category(r["industries"], r["description"], r["company_name"])
        cat_data[cat]["rounds"] += 1
        cat_data[cat]["total_funding"] += r["funding_usd"]
        cat_data[cat]["companies"].append(r["company_name"])

    capital_flow = []
    for cat_name, data in sorted(cat_data.items(), key=lambda x: -x[1]["total_funding"]):
        avg = data["total_funding"] / data["rounds"] if data["rounds"] else 0
        capital_flow.append({
            "category": cat_name,
            "rounds": data["rounds"],
            "total_funding": data["total_funding"],
            "total_funding_formatted": _format_currency(data["total_funding"]),
            "avg_round": avg,
            "avg_round_formatted": _format_currency(avg),
        })

    # --- Section 3: Big 5 ---
    big5 = []
    for r in sorted(rows, key=lambda x: -x["funding_usd"])[:5]:
        big5.append({
            "company": r["company_name"],
            "amount": r["funding_usd"],
            "amount_formatted": _format_currency(r["funding_usd"]),
            "stage": r["funding_type"].split(" - ")[0].strip() if " - " in r["funding_type"] else r["funding_type"],
            "description": r["description"][:200],
        })

    # Top 5 concentration
    top5_total = sum(r["funding_usd"] for r in sorted(rows, key=lambda x: -x["funding_usd"])[:5])
    remaining_total = total_funding - top5_total
    remaining_count = total_rounds - 5

    # --- Section 4: Build Pattern Prevalence (from analyses) ---
    # Normalize pattern names to handle variant labels
    PATTERN_CANONICAL: dict[str, str] = {}
    # Build canonical map: any pattern name containing these substrings maps to canonical
    _CANONICAL_RULES = [
        ("rag", "RAG (Retrieval-Augmented Generation)"),
        ("retrieval-augmented", "RAG (Retrieval-Augmented Generation)"),
        ("retrieval + fusion", "RAG (Retrieval-Augmented Generation)"),
        ("guardrail", "Guardrail-as-LLM"),
        ("micro-model", "Micro-model Meshes"),
        ("agentic", "Agentic Architectures"),
        ("continuous-learning", "Continuous-learning Flywheels"),
        ("vertical data", "Vertical Data Moats"),
        ("knowledge graph", "Knowledge Graphs"),
        ("natural-language-to-code", "Natural-Language-to-Code"),
    ]

    def _canonicalize(name: str) -> str:
        lower = name.lower()
        for substr, canonical in _CANONICAL_RULES:
            if substr in lower:
                return canonical
        return name

    pattern_counts: Counter = Counter()
    total_analyzed = len(analyses)
    for analysis in analyses.values():
        patterns = analysis.get("build_patterns", [])
        for p in patterns:
            if p.get("confidence", 0) >= 0.5:
                name = _canonicalize(p["name"])
                pattern_counts[name] += 1

    trend_radar = []
    for pattern_name, count in pattern_counts.most_common(8):
        pct = (count / total_analyzed * 100) if total_analyzed else 0
        trend_radar.append({
            "pattern": pattern_name,
            "count": count,
            "total": total_analyzed,
            "percentage": round(pct, 1),
        })

    # --- Section 5: Stage Snapshot ---
    stage_data: dict[str, dict[str, Any]] = defaultdict(lambda: {"rounds": 0, "capital": 0})
    for r in rows:
        stage = _normalize_stage(r["funding_type"], r["funding_stage"])
        stage_data[stage]["rounds"] += 1
        stage_data[stage]["capital"] += r["funding_usd"]

    stage_order = ["Pre-Seed", "Seed", "Series A", "Series B", "Series C+"]
    stage_snapshot = []
    for stage in stage_order:
        d = stage_data.get(stage, {"rounds": 0, "capital": 0})
        pct = (d["rounds"] / total_rounds * 100) if total_rounds else 0
        stage_snapshot.append({
            "stage": stage,
            "rounds": d["rounds"],
            "rounds_pct": round(pct, 1),
            "capital": d["capital"],
            "capital_formatted": _format_currency(d["capital"]),
        })

    # --- Section 5b: Sankey Flow (Stage → Category) ---
    sankey_pairs: dict[tuple[str, str], float] = defaultdict(float)
    for r in rows:
        stage = _normalize_stage(r["funding_type"], r["funding_stage"])
        cat = _classify_category(r["industries"], r["description"], r["company_name"])
        sankey_pairs[(stage, cat)] += r["funding_usd"]

    sankey_flow = {
        "flows": [
            {"source": s, "target": t, "value": v, "value_formatted": _format_currency(v)}
            for (s, t), v in sorted(sankey_pairs.items(), key=lambda x: -x[1])
            if v > 0
        ]
    }

    # --- Section 6: Vertical Deep Dives ---
    # (Top 3 categories with company highlights)
    vertical_dives = []
    for entry in capital_flow[:3]:
        cat_name = entry["category"]
        # Find top companies in this category
        cat_companies = [(r["company_name"], r["funding_usd"]) for r in rows
                         if _classify_category(r["industries"], r["description"], r["company_name"]) == cat_name]
        cat_companies.sort(key=lambda x: -x[1])
        top_companies = [{"name": c[0], "amount_formatted": _format_currency(c[1])} for c in cat_companies[:5]]

        vertical_dives.append({
            "category": cat_name,
            "company_count": entry["rounds"],
            "total_funding_formatted": entry["total_funding_formatted"],
            "top_companies": top_companies,
        })

    # --- Section 7: Geography ---
    geo_data: Counter = Counter()
    for r in rows:
        region = _extract_region(r["location"])
        geo_data[region] += 1

    geography = []
    for region, count in geo_data.most_common():
        pct = (count / total_rounds * 100) if total_rounds else 0
        geography.append({
            "region": region,
            "companies": count,
            "percentage": round(pct, 1),
        })

    # --- Section 8: Market DNA (from analyses) ---
    market_type_counts = Counter()
    for analysis in analyses.values():
        mt = analysis.get("market_type", "unknown")
        if mt in ("horizontal", "vertical"):
            market_type_counts[mt] += 1

    market_dna = {
        "horizontal": market_type_counts.get("horizontal", 0),
        "vertical": market_type_counts.get("vertical", 0),
        "total": total_analyzed,
    }

    # --- Section 9: GenAI Intensity (from analyses) ---
    genai_counts = Counter()
    for analysis in analyses.values():
        intensity = analysis.get("genai_intensity", "unclear")
        genai_counts[intensity] += 1

    genai_intensity = []
    intensity_order = ["core", "none", "unclear", "tooling", "enhancement"]
    for intensity in intensity_order:
        count = genai_counts.get(intensity, 0)
        pct = (count / total_analyzed * 100) if total_analyzed else 0
        genai_intensity.append({
            "intensity": intensity,
            "count": count,
            "percentage": round(pct, 1),
        })

    # --- Section 10: Builder's Playbook ---
    # Derived from pattern prevalence
    playbook = []
    if trend_radar:
        # Data moats insight
        vdm = next((t for t in trend_radar if "Data Moat" in t["pattern"]), None)
        if vdm:
            playbook.append({
                "title": "Data > Models",
                "stat": f"{vdm['percentage']}%",
                "description": f"{vdm['percentage']}% of funded companies are building vertical data moats. The model layer is commoditizing; proprietary data is the lasting edge.",
            })

        # Agentic insight
        agentic = next((t for t in trend_radar if "Agentic" in t["pattern"]), None)
        if agentic:
            playbook.append({
                "title": "Agents Are Infrastructure Now",
                "stat": f"{agentic['percentage']}%",
                "description": f"{agentic['percentage']}% exhibit agentic patterns. Tool-use and multi-step reasoning aren't features — they're architecture.",
            })

    # Physical AI insight from capital flow
    physical_ai = next((c for c in capital_flow if "Physical" in c["category"] or "Robotics" in c["category"]), None)
    if physical_ai:
        playbook.append({
            "title": "Physical AI Is the Next Frontier",
            "stat": physical_ai["total_funding_formatted"],
            "description": f"{physical_ai['total_funding_formatted']} to robotics/AV in one month. Software-only AI is table stakes; the money is moving to atoms.",
        })

    # Assemble full output
    newsletter = {
        "period": period,
        "generated_at": datetime.now().isoformat(),
        "hero": hero,
        "capital_flow": capital_flow,
        "big5": big5,
        "top5_concentration": {
            "top5_total": top5_total,
            "top5_total_formatted": _format_currency(top5_total),
            "remaining_total": remaining_total,
            "remaining_total_formatted": _format_currency(remaining_total),
            "remaining_count": remaining_count,
        },
        "trend_radar": trend_radar,
        "stage_snapshot": stage_snapshot,
        "sankey_flow": sankey_flow,
        "vertical_dives": vertical_dives,
        "geography": geography,
        "market_dna": market_dna,
        "genai_intensity": genai_intensity,
        "playbook": playbook,
        "meta": {
            "total_rounds": total_rounds,
            "total_analyzed": total_analyzed,
            "period_label": _format_period_label(period),
        },
    }

    return newsletter


def write_newsletter_data(period: str, data_root: Path, output_path: Path | None = None) -> Path:
    """Generate and persist the monthly newsletter visuals payload."""
    newsletter_data = generate_newsletter_data(period, data_root)
    resolved_output = output_path or (data_root / period / "output" / "newsletter_data.json")
    resolved_output.parent.mkdir(parents=True, exist_ok=True)
    resolved_output.write_text(
        json.dumps(newsletter_data, indent=2, default=str),
        encoding="utf-8",
    )
    return resolved_output


def main():
    """CLI entry point."""
    period = sys.argv[1] if len(sys.argv) > 1 else "2026-02"

    # Determine data root
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parents[3]  # packages/analysis/src/automation -> project root
    data_root = project_root / "apps" / "web" / "data"

    print(f"Generating newsletter data for period: {period}")
    print(f"Data root: {data_root}")

    output_path = write_newsletter_data(period, data_root)
    newsletter_data = json.loads(output_path.read_text(encoding="utf-8"))

    print(f"\nNewsletter data written to: {output_path}")
    print(f"  Total rounds: {newsletter_data['hero']['total_rounds']}")
    print(f"  Total funding: {newsletter_data['hero']['total_funding_formatted']}")
    print(f"  Analyzed companies: {newsletter_data['meta']['total_analyzed']}")
    print(f"  Categories: {len(newsletter_data['capital_flow'])}")
    print(f"  Build patterns tracked: {len(newsletter_data['trend_radar'])}")
    print(f"  Top 5 rounds: {', '.join(b['company'] for b in newsletter_data['big5'])}")


if __name__ == "__main__":
    main()
