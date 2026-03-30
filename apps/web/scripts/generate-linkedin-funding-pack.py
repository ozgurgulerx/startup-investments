#!/usr/bin/env python3
"""Generate a static JSON artifact for the March 2026 LinkedIn visual pack.

This parser intentionally uses only the Python standard library so it can run
without additional dependencies. It reads the first sheet of the workbook,
normalizes the user-supplied theme labels, and writes a compact JSON bundle
consumed directly by the Next.js artboard route.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET


NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

COLS = [
    "transaction_name",
    "tag1",
    "tag2",
    "transaction_url",
    "funding_type",
    "money_usd",
    "announced_date",
    "funding_stage",
    "org_website",
    "org_description",
    "num_rounds",
    "industries",
    "location",
    "lead_investors",
]

THEME_LABELS = {
    "HCLS": "Health + Life Sciences",
    "AI Infra": "AI Infrastructure",
    "AI Dev": "AI Dev Tools",
    "AI Tooling": "AI Tooling",
    "AI Agents": "AI Agents",
    "FinTech": "Fintech",
    "SecOps": "Security",
    "ITOps": "IT Ops",
    "LegalTech": "LegalTech",
    "CSTech": "Climate + Sustainability",
    "Frontier Lab": "Frontier Lab",
    "Defense": "Defense",
    "Robotics": "Robotics",
    "Betting Site - predictive?": "Predictive Markets",
    "VC and Private Equity": "VC Platforms",
    "MarTech": "Marketing Tech",
}

THEME_COLORS = {
    "Frontier Lab": "#2457FF",
    "AI Infrastructure": "#0E8F7A",
    "Robotics": "#F36A2D",
    "Defense": "#1D3557",
    "Health + Life Sciences": "#E24D6B",
    "Predictive Markets": "#B06A00",
    "LegalTech": "#6D5BD0",
    "AI Dev Tools": "#2884C7",
    "AI Agents": "#4E7A43",
    "Security": "#7A2E3A",
    "Other Themes": "#94A3B8",
    "Untagged": "#CBD5E1",
}

STAGE_ORDER = [
    "Pre-Seed",
    "Seed",
    "Series A",
    "Series B",
    "Series C+",
    "Venture / Unknown",
    "Other",
]

COUNTRY_LIMIT = 6
THEME_LIMIT = 8
TOP_DEALS_LIMIT = 15


@dataclass
class RoundRow:
    transaction_name: str
    company: str
    theme_raw: str
    theme: str
    subtheme: str
    funding_type: str
    stage_bucket: str
    capital_usd: float
    announced_date: date | None
    country: str
    continent: str
    investors: list[str]
    industries: list[str]
    description: str
    url: str


def col_to_idx(col: str) -> int:
    value = 0
    for ch in col:
        if ch.isalpha():
            value = value * 26 + (ord(ch.upper()) - 64)
    return value - 1


def load_sheet_rows(path: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(path) as zf:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall("main:si", NS):
                shared_strings.append(
                    "".join(text.text or "" for text in si.iterfind(".//main:t", NS))
                )

        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_map = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels.findall("pkgrel:Relationship", NS)
        }

        sheet = workbook.find("main:sheets/main:sheet", NS)
        if sheet is None:
            raise ValueError("Workbook contains no sheets.")

        target = rel_map[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
        if not target.startswith("xl/"):
            target = f"xl/{target}"

        root = ET.fromstring(zf.read(target))
        rows: list[dict[str, str]] = []
        for row in root.findall("main:sheetData/main:row", NS):
            values = [""] * len(COLS)
            for cell in row.findall("main:c", NS):
                ref = cell.attrib.get("r", "")
                idx = col_to_idx("".join(ch for ch in ref if ch.isalpha()))
                if idx >= len(COLS):
                    continue
                cell_type = cell.attrib.get("t")
                value_node = cell.find("main:v", NS)
                inline_node = cell.find("main:is", NS)
                value = ""
                if cell_type == "s" and value_node is not None and value_node.text is not None:
                    value = shared_strings[int(value_node.text)]
                elif cell_type == "inlineStr" and inline_node is not None:
                    value = "".join(
                        text.text or "" for text in inline_node.iterfind(".//main:t", NS)
                    )
                elif value_node is not None:
                    value = value_node.text or ""
                values[idx] = value.strip() if isinstance(value, str) else value
            if any(str(cell).strip() for cell in values):
                rows.append(dict(zip(COLS, values)))

    if not rows:
        raise ValueError("Workbook sheet is empty.")

    return rows[1:]


def excel_date_to_date(value: str) -> date | None:
    if not value:
        return None
    base = datetime(1899, 12, 30)
    try:
        return (base + timedelta(days=float(value))).date()
    except ValueError:
        return None


def clean_theme(raw: str) -> str:
    theme = (raw or "").strip()
    while theme.endswith("-"):
        theme = theme[:-1].rstrip()
    return theme or "Untagged"


def display_theme(raw: str) -> str:
    return THEME_LABELS.get(raw, raw)


def normalize_stage_bucket(funding_type: str) -> str:
    label = (funding_type or "").strip()
    if label == "Pre-Seed":
        return "Pre-Seed"
    if label == "Seed":
        return "Seed"
    if label == "Series A":
        return "Series A"
    if label == "Series B":
        return "Series B"
    if label in {"Series C", "Series D", "Series E", "Series F", "Series G"}:
        return "Series C+"
    if label == "Venture - Series Unknown":
        return "Venture / Unknown"
    return "Other"


def extract_company(transaction_name: str) -> str:
    if " - " in transaction_name:
        return transaction_name.split(" - ", 1)[1].strip()
    return transaction_name.strip()


def parse_location(location: str) -> tuple[str, str]:
    parts = [part.strip() for part in location.split(",") if part.strip()]
    if not parts:
        return ("Unknown", "Unknown")
    if len(parts) == 1:
        return (parts[0], "Unknown")
    return (parts[-2], parts[-1])


def parse_csvish(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def to_round_rows(rows: list[dict[str, str]]) -> list[RoundRow]:
    parsed: list[RoundRow] = []
    for row in rows:
        capital = float(row["money_usd"]) if row["money_usd"] else 0.0
        cleaned_theme = clean_theme(row["tag1"])
        parsed.append(
            RoundRow(
                transaction_name=row["transaction_name"],
                company=extract_company(row["transaction_name"]),
                theme_raw=cleaned_theme,
                theme=display_theme(cleaned_theme),
                subtheme=(row["tag2"] or "").strip(),
                funding_type=(row["funding_type"] or "").strip() or "Other",
                stage_bucket=normalize_stage_bucket(row["funding_type"]),
                capital_usd=capital,
                announced_date=excel_date_to_date(row["announced_date"]),
                country=parse_location(row["location"])[0],
                continent=parse_location(row["location"])[1],
                investors=parse_csvish(row["lead_investors"]),
                industries=parse_csvish(row["industries"]),
                description=(row["org_description"] or "").strip(),
                url=(row["transaction_url"] or "").strip(),
            )
        )
    return parsed


def compact_money(value: float) -> str:
    abs_value = abs(value)
    if abs_value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.1f}B"
    if abs_value >= 1_000_000:
        return f"${value / 1_000_000:.0f}M"
    if abs_value >= 1_000:
        return f"${value / 1_000:.0f}K"
    return f"${value:.0f}"


def pct(value: float) -> float:
    return round(value * 100, 1)


def ensure_all_days(rows: list[RoundRow]) -> list[dict[str, Any]]:
    dates = [row.announced_date for row in rows if row.announced_date is not None]
    if not dates:
        return []
    start = min(dates)
    end = max(dates)
    by_day = defaultdict(lambda: {"rounds": 0, "capital_usd": 0.0})
    for row in rows:
        if row.announced_date is None:
            continue
        bucket = by_day[row.announced_date]
        bucket["rounds"] += 1
        bucket["capital_usd"] += row.capital_usd

    output: list[dict[str, Any]] = []
    cursor = start
    while cursor <= end:
        item = by_day[cursor]
        output.append(
            {
                "date": cursor.isoformat(),
                "dayLabel": cursor.strftime("%b %-d"),
                "rounds": item["rounds"],
                "capitalUsd": round(item["capital_usd"]),
            }
        )
        cursor += timedelta(days=1)
    return output


def theme_color(theme: str) -> str:
    return THEME_COLORS.get(theme, THEME_COLORS["Other Themes"])


def build_output(rows: list[RoundRow], source_path: Path) -> dict[str, Any]:
    total_funding = sum(row.capital_usd for row in rows)
    sorted_rows = sorted(rows, key=lambda row: row.capital_usd, reverse=True)
    median_round = statistics.median(row.capital_usd for row in rows if row.capital_usd > 0)
    top5_share = sum(row.capital_usd for row in sorted_rows[:5]) / total_funding
    top10_share = sum(row.capital_usd for row in sorted_rows[:10]) / total_funding

    theme_capital = defaultdict(float)
    theme_count = Counter()
    subtheme_capital = defaultdict(float)
    subtheme_count = Counter()
    country_capital = defaultdict(float)
    country_count = Counter()
    continent_capital = defaultdict(float)
    stage_counts = Counter()
    stage_capital = defaultdict(float)
    investors_touched = defaultdict(float)

    for row in rows:
        theme_capital[row.theme] += row.capital_usd
        theme_count[row.theme] += 1
        if row.subtheme:
            subtheme_capital[row.subtheme] += row.capital_usd
            subtheme_count[row.subtheme] += 1
        country_capital[row.country] += row.capital_usd
        country_count[row.country] += 1
        continent_capital[row.continent] += row.capital_usd
        stage_counts[row.stage_bucket] += 1
        stage_capital[row.stage_bucket] += row.capital_usd
        for investor in row.investors:
            investors_touched[investor] += row.capital_usd

    visual_themes = [
        theme
        for theme, _capital in sorted(theme_capital.items(), key=lambda item: item[1], reverse=True)
        if theme != "Untagged"
    ][:THEME_LIMIT]
    visual_theme_set = set(visual_themes)

    leading_theme = max(theme_capital.items(), key=lambda item: item[1])
    leading_country = max(country_capital.items(), key=lambda item: item[1])

    theme_summary = [
        {
            "name": theme,
            "rounds": theme_count[theme],
            "capitalUsd": round(theme_capital[theme]),
            "sharePct": pct(theme_capital[theme] / total_funding),
            "color": theme_color(theme),
        }
        for theme, _capital in sorted(theme_capital.items(), key=lambda item: item[1], reverse=True)
    ]

    stage_summary = []
    for stage in STAGE_ORDER:
        rounds_count = stage_counts[stage]
        capital = stage_capital[stage]
        stage_summary.append(
            {
                "stage": stage,
                "rounds": rounds_count,
                "capitalUsd": round(capital),
                "roundSharePct": pct(rounds_count / len(rows)),
                "capitalSharePct": pct(capital / total_funding if total_funding else 0),
                "avgRoundUsd": round(capital / rounds_count) if rounds_count else 0,
            }
        )

    subtheme_summary = [
        {
            "name": subtheme,
            "rounds": subtheme_count[subtheme],
            "capitalUsd": round(subtheme_capital[subtheme]),
            "sharePct": pct(subtheme_capital[subtheme] / total_funding),
        }
        for subtheme, _capital in sorted(
            subtheme_capital.items(),
            key=lambda item: item[1],
            reverse=True,
        )
    ]

    country_summary = [
        {
            "name": country,
            "rounds": country_count[country],
            "capitalUsd": round(country_capital[country]),
            "sharePct": pct(country_capital[country] / total_funding),
        }
        for country, _capital in sorted(country_capital.items(), key=lambda item: item[1], reverse=True)
    ]

    top_countries = [item["name"] for item in country_summary[:COUNTRY_LIMIT]]
    top_country_set = set(top_countries)

    treemap_children: list[dict[str, Any]] = []
    for theme in visual_themes:
        theme_rounds = [row for row in rows if row.theme == theme]
        treemap_children.append(
            {
                "name": theme,
                "color": theme_color(theme),
                "children": [
                    {
                        "name": row.company,
                        "size": round(row.capital_usd),
                        "stage": row.stage_bucket,
                        "theme": theme,
                        "date": row.announced_date.isoformat() if row.announced_date else None,
                    }
                    for row in sorted(theme_rounds, key=lambda item: item.capital_usd, reverse=True)
                ],
            }
        )

    other_theme_rounds = [row for row in rows if row.theme not in visual_theme_set]
    if other_theme_rounds:
        treemap_children.append(
            {
                "name": "Other Themes",
                "color": theme_color("Other Themes"),
                "children": [
                    {
                        "name": row.company,
                        "size": round(row.capital_usd),
                        "stage": row.stage_bucket,
                        "theme": row.theme,
                        "date": row.announced_date.isoformat() if row.announced_date else None,
                    }
                    for row in sorted(other_theme_rounds, key=lambda item: item.capital_usd, reverse=True)
                ],
            }
        )

    flow_country_theme = defaultdict(float)
    flow_theme_stage = defaultdict(float)
    for row in rows:
        flow_country = row.country if row.country in top_country_set else "Other Geographies"
        flow_theme = row.theme if row.theme in visual_theme_set else "Other Themes"
        flow_country_theme[(flow_country, flow_theme)] += row.capital_usd
        flow_theme_stage[(flow_theme, row.stage_bucket)] += row.capital_usd

    flow_nodes = [
        {"id": country, "kind": "country"}
        for country in [*top_countries, "Other Geographies"]
        if country in top_country_set or country == "Other Geographies"
    ]
    flow_nodes.extend({"id": theme, "kind": "theme"} for theme in [*visual_themes, "Other Themes"])
    flow_nodes.extend({"id": stage, "kind": "stage"} for stage in STAGE_ORDER)

    flow_links = [
        {
            "source": source,
            "target": target,
            "value": round(value),
        }
        for (source, target), value in sorted(
            flow_country_theme.items(),
            key=lambda item: item[1],
            reverse=True,
        )
        if value > 0
    ]
    flow_links.extend(
        {
            "source": source,
            "target": target,
            "value": round(value),
        }
        for (source, target), value in sorted(
            flow_theme_stage.items(),
            key=lambda item: item[1],
            reverse=True,
        )
        if value > 0
    )

    matrix_rows = []
    max_matrix_value = 0.0
    for theme in visual_themes:
        cells = []
        for stage in STAGE_ORDER:
            theme_stage_rows = [
                row for row in rows if row.theme == theme and row.stage_bucket == stage
            ]
            capital = sum(row.capital_usd for row in theme_stage_rows)
            max_matrix_value = max(max_matrix_value, capital)
            cells.append(
                {
                    "stage": stage,
                    "rounds": len(theme_stage_rows),
                    "capitalUsd": round(capital),
                }
            )
        matrix_rows.append(
            {
                "theme": theme,
                "color": theme_color(theme),
                "cells": cells,
            }
        )

    top_deals = []
    for row in sorted_rows[:TOP_DEALS_LIMIT]:
        top_deals.append(
            {
                "name": row.transaction_name,
                "company": row.company,
                "theme": row.theme,
                "subtheme": row.subtheme,
                "fundingType": row.funding_type,
                "stageBucket": row.stage_bucket,
                "capitalUsd": round(row.capital_usd),
                "date": row.announced_date.isoformat() if row.announced_date else None,
                "country": row.country,
                "investors": row.investors,
                "url": row.url,
            }
        )

    pulse_days = ensure_all_days(rows)
    pulse_sorted = sorted(pulse_days, key=lambda day: day["capitalUsd"], reverse=True)[:5]

    top_investors = [
        {"name": name, "capitalUsd": round(capital)}
        for name, capital in sorted(
            investors_touched.items(),
            key=lambda item: item[1],
            reverse=True,
        )[:10]
    ]

    return {
        "meta": {
            "title": "March 2026 AI funding visual pack",
            "periodLabel": "March 2026",
            "sourceWorkbook": source_path.name,
            "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        },
        "summary": {
            "roundCount": len(rows),
            "totalFundingUsd": round(total_funding),
            "medianRoundUsd": round(median_round),
            "seedRoundCount": stage_counts["Seed"],
            "seedCapitalUsd": round(stage_capital["Seed"]),
            "top5CapitalSharePct": pct(top5_share),
            "top10CapitalSharePct": pct(top10_share),
            "leadingTheme": leading_theme[0],
            "leadingThemeFundingUsd": round(leading_theme[1]),
            "leadingCountry": leading_country[0],
            "leadingCountrySharePct": pct(leading_country[1] / total_funding),
            "topFundingDay": pulse_sorted[0] if pulse_sorted else None,
        },
        "themes": theme_summary,
        "subthemes": subtheme_summary,
        "stages": stage_summary,
        "countries": country_summary,
        "continents": [
            {"name": name, "capitalUsd": round(capital)}
            for name, capital in sorted(
                continent_capital.items(),
                key=lambda item: item[1],
                reverse=True,
            )
        ],
        "topDeals": top_deals,
        "daily": pulse_days,
        "dailyPeaks": pulse_sorted,
        "topInvestors": top_investors,
        "heroTreemap": {
            "name": "March 2026",
            "children": treemap_children,
        },
        "capitalFlow": {
            "nodes": flow_nodes,
            "links": flow_links,
        },
        "themeStageMatrix": {
            "stages": STAGE_ORDER,
            "rows": matrix_rows,
            "maxCapitalUsd": round(max_matrix_value),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to the source .xlsx workbook")
    parser.add_argument(
        "--output",
        default="apps/web/data/linkedin/march-2026-ai-funding-pack.json",
        help="Output path for the generated JSON artifact",
    )
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    rows = to_round_rows(load_sheet_rows(input_path))
    payload = build_output(rows, input_path)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
