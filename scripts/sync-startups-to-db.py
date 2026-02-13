#!/usr/bin/env python3
"""
Sync startups.watch-style `startups.csv` into Postgres directly.

Why this exists:
- VM cron needs a deterministic way to keep `startups` + `funding_rounds` in sync
  with on-disk datasets under `apps/web/data/**`, without relying on Front Door
  timeouts on admin HTTP endpoints.
- Also projects lead-investor data into `capital_graph_edges` when graph tables
  are available.

Requires env var:
- DATABASE_URL

Usage:
  python scripts/sync-startups-to-db.py --csv apps/web/data/2026-02/input/startups.csv --region global
  python scripts/sync-startups-to-db.py --csv apps/web/data/tr/2026-02/input/startups.csv --region turkey
"""

import argparse
import csv
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import psycopg2
from psycopg2.extras import execute_values


DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()


def normalize_region(value: str) -> str:
    raw = (value or "").strip().lower()
    if raw in {"tr", "turkey"}:
        return "turkey"
    if raw in {"global", ""}:
        return "global"
    raise ValueError(f"Invalid region: {value!r} (expected global|turkey|tr)")

_SLUG_CLEAN_RE = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    text = (name or "").strip().lower()
    text = text.replace("&", " and ").replace("+", " plus ").replace("/", " ")
    text = _SLUG_CLEAN_RE.sub("-", text)
    text = re.sub(r"(^-|-$)", "", text)
    return text


def extract_company_name(transaction_name: str) -> str:
    raw = (transaction_name or "").strip()
    if not raw:
        return ""
    if " - " in raw:
        _, right = raw.split(" - ", 1)
        right = right.strip()
        if right:
            return right
    return raw


def parse_location(value: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    parts = [p.strip() for p in (value or "").split(",") if p.strip()]
    if len(parts) >= 4:
        city = parts[0] or None
        country = parts[-2] or None
        continent = parts[-1] or None
        return city, country, continent
    if len(parts) == 3:
        return parts[0] or None, parts[1] or None, parts[2] or None
    if len(parts) == 2:
        return None, parts[0] or None, parts[1] or None
    if len(parts) == 1:
        return None, parts[0] or None, None
    return None, None, None


_FUNDING_AMOUNT_RE = re.compile(r"[^0-9.-]+")
_GRAPH_ACTIVE_VALID_TO = date(9999, 12, 31)
_INVESTOR_SPLIT_RE = re.compile(r"\s+(?:and|ve)\s+|\s+&\s+|,|;|/|\|", re.IGNORECASE)
_INVESTOR_NAME_DENYLIST = {
    "investor",
    "investors",
    "round",
    "funding",
    "series",
    "seed",
    "pre-seed",
    "growth",
    "bridge",
}


def parse_funding_amount(raw: str) -> Optional[int]:
    value = (raw or "").strip()
    if not value:
        return None
    normalized = _FUNDING_AMOUNT_RE.sub("", value)
    if not normalized:
        return None
    try:
        num = float(normalized)
    except Exception:
        return None
    if not (num == num and abs(num) != float("inf")):
        return None
    return int(round(num))


def parse_date(raw: str) -> Optional[date]:
    value = (raw or "").strip()
    if not value:
        return None
    # startups.watch is typically YYYY-MM-DD. Be strict to avoid weird rows.
    try:
        y, m, d = value.split("-", 2)
        return date(int(y), int(m), int(d))
    except Exception:
        return None


def split_investor_names(raw: Optional[str]) -> List[str]:
    """Split a lead-investor string into normalized investor names."""
    cleaned = re.sub(r"\s+", " ", (raw or "").strip())
    if not cleaned:
        return []

    cleaned = re.sub(
        r"\b(?:with participation from|with participation by|katılımıyla|katilimiyla)\b.*$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip(" ,.;")
    if not cleaned:
        return []

    names: List[str] = []
    seen: Set[str] = set()
    for part in _INVESTOR_SPLIT_RE.split(cleaned):
        name = re.sub(r"\s+", " ", part).strip(" ,.;")
        if not name:
            continue
        lower = name.lower()
        if lower in _INVESTOR_NAME_DENYLIST:
            continue
        if re.fullmatch(r"(series\s+[a-z]|pre-?seed|seed|growth|bridge)", lower):
            continue
        if len(name) < 2:
            continue
        if lower in seen:
            continue
        seen.add(lower)
        names.append(name)
    return names


@dataclass(frozen=True)
class StartupRow:
    name: str
    slug: str
    description: Optional[str]
    website: Optional[str]
    hq_city: Optional[str]
    hq_country: Optional[str]
    continent: Optional[str]
    industry: Optional[str]
    stage: Optional[str]


@dataclass(frozen=True)
class FundingRoundRow:
    slug: str
    round_type: str
    amount_usd: Optional[int]
    announced_date: Optional[date]
    lead_investor: Optional[str]


def read_csv_rows(csv_path: str) -> Tuple[List[StartupRow], List[FundingRoundRow]]:
    startups: Dict[str, StartupRow] = {}
    rounds: List[FundingRoundRow] = []

    def get(row: Dict[str, str], key: str) -> str:
        return (row.get(key) or "").strip()

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            tx = get(row, "Transaction Name")
            name = extract_company_name(tx)
            if not name:
                continue

            slug = slugify(name)
            if not slug:
                continue

            desc = get(row, "Organization Description") or None
            website = get(row, "Organization Website") or None
            industries = get(row, "Organization Industries")
            industry = None
            if industries:
                industry = next((s.strip() for s in industries.split(",") if s.strip()), None)

            funding_stage = get(row, "Funding Stage") or None

            city, country, continent = parse_location(get(row, "Organization Location"))

            # Keep one canonical startup record per slug (latest row wins, but values are similar anyway).
            startups[slug] = StartupRow(
                name=name,
                slug=slug,
                description=desc,
                website=website,
                hq_city=city,
                hq_country=country,
                continent=continent,
                industry=industry,
                stage=funding_stage,
            )

            round_type = get(row, "Funding Type")
            amount_usd = parse_funding_amount(get(row, "Money Raised (in USD)") or get(row, "Money Raised"))
            announced_date = parse_date(get(row, "Announced Date"))
            lead_investors = get(row, "Lead Investors") or None

            # Funding rounds are optional; avoid inserting low-signal blanks.
            if round_type and announced_date and amount_usd is not None:
                rounds.append(
                    FundingRoundRow(
                        slug=slug,
                        round_type=round_type,
                        amount_usd=amount_usd,
                        announced_date=announced_date,
                        lead_investor=lead_investors,
                    )
                )

    return list(startups.values()), rounds


def chunked(items: List[Any], size: int) -> Iterable[List[Any]]:
    size = max(1, int(size))
    for i in range(0, len(items), size):
        yield items[i : i + size]


def sync_capital_graph_from_rounds(
    cur,
    *,
    rounds: List[FundingRoundRow],
    slug_to_id: Dict[str, str],
    region: str,
    csv_path: str,
    chunk_size: int,
) -> Dict[str, Any]:
    """Upsert investor/startup graph edges from CSV lead-investor rows."""
    stats: Dict[str, Any] = {
        "available": False,
        "investors_upserted": 0,
        "edges_upserted": 0,
        "views_refreshed": False,
        "candidate_rows": 0,
    }

    cur.execute(
        """
        SELECT
          to_regclass('public.capital_graph_edges') IS NOT NULL AS has_graph_edges,
          to_regclass('public.investors') IS NOT NULL AS has_investors
        """
    )
    row = cur.fetchone()
    graph_ready = bool(row and row[0] and row[1])
    if not graph_ready:
        return stats
    stats["available"] = True

    # Build edge candidates from round rows with resolvable startup IDs and lead investor names.
    edge_candidates: List[Tuple[str, str, str, Optional[int], Optional[date], str]] = []
    unique_investors: Dict[str, str] = {}  # normalized -> canonical display
    for r in rounds:
        startup_id = slug_to_id.get(r.slug)
        if not startup_id or not r.lead_investor:
            continue
        investor_names = split_investor_names(r.lead_investor)
        if not investor_names:
            continue
        stats["candidate_rows"] += 1
        for investor_name in investor_names:
            norm_name = investor_name.lower()
            unique_investors[norm_name] = investor_name
            edge_candidates.append(
                (
                    startup_id,
                    norm_name,
                    r.round_type,
                    r.amount_usd,
                    r.announced_date,
                    r.lead_investor,
                )
            )

    if not edge_candidates:
        return stats

    # Resolve/create investor IDs once per unique normalized name.
    investor_id_by_norm: Dict[str, str] = {}
    default_country = "Turkey" if region == "turkey" else None
    for norm_name, display_name in unique_investors.items():
        cur.execute(
            """
            INSERT INTO investors (name, type, headquarters_country)
            VALUES (%s, 'unknown', %s)
            ON CONFLICT (name)
            DO UPDATE SET
              type = COALESCE(investors.type, EXCLUDED.type),
              headquarters_country = COALESCE(investors.headquarters_country, EXCLUDED.headquarters_country)
            RETURNING id, (xmax = 0) AS inserted
            """,
            (display_name, default_country),
        )
        investor_id, inserted_now = cur.fetchone()
        investor_id_by_norm[norm_name] = str(investor_id)
        if bool(inserted_now):
            stats["investors_upserted"] += 1

    source_ref_prefix = Path(csv_path).name
    edge_values: List[Tuple[Any, ...]] = []
    for startup_id, investor_norm, round_type, amount_usd, announced_date, lead_raw in edge_candidates:
        investor_id = investor_id_by_norm.get(investor_norm)
        if not investor_id:
            continue
        valid_from = announced_date or date.today()
        attrs = {
            "round_type": round_type,
            "amount_usd": amount_usd,
            "announced_date": announced_date.isoformat() if announced_date else None,
            "lead_investor": lead_raw,
            "source": "csv_sync",
        }
        edge_values.append(
            (
                investor_id,
                startup_id,
                region,
                json.dumps({k: v for k, v in attrs.items() if v not in (None, "", [], {})}),
                f"{source_ref_prefix}:{round_type}:{valid_from.isoformat()}",
                valid_from,
                _GRAPH_ACTIVE_VALID_TO,
            )
        )

    for edge_chunk in chunked(edge_values, chunk_size):
        if not edge_chunk:
            continue
        execute_values(
            cur,
            """
            INSERT INTO capital_graph_edges (
              src_type, src_id, edge_type, dst_type, dst_id, region,
              attrs_json, source, source_ref, confidence, created_by, valid_from, valid_to
            )
            VALUES %s
            ON CONFLICT (src_type, src_id, edge_type, dst_type, dst_id, region, valid_from, valid_to)
            DO UPDATE SET
              attrs_json = capital_graph_edges.attrs_json || EXCLUDED.attrs_json,
              source = EXCLUDED.source,
              source_ref = COALESCE(EXCLUDED.source_ref, capital_graph_edges.source_ref),
              confidence = GREATEST(COALESCE(capital_graph_edges.confidence, 0), COALESCE(EXCLUDED.confidence, 0)),
              created_by = COALESCE(EXCLUDED.created_by, capital_graph_edges.created_by),
              updated_at = NOW()
            """,
            [
                (
                    "investor",
                    investor_id,
                    "LEADS_ROUND",
                    "startup",
                    startup_id,
                    edge_region,
                    attrs_json,
                    "csv_sync",
                    source_ref,
                    0.85,
                    "sync-startups-to-db",
                    valid_from,
                    valid_to,
                )
                for (
                    investor_id,
                    startup_id,
                    edge_region,
                    attrs_json,
                    source_ref,
                    valid_from,
                    valid_to,
                ) in edge_chunk
            ],
            page_size=max(1, int(chunk_size)),
        )
        stats["edges_upserted"] += cur.rowcount or 0

    if stats["edges_upserted"] > 0:
        cur.execute("SELECT to_regprocedure('refresh_capital_graph_views()') IS NOT NULL")
        fn_exists = bool(cur.fetchone()[0])
        if fn_exists:
            cur.execute("SELECT refresh_capital_graph_views()")
            stats["views_refreshed"] = True

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync startups.csv to Postgres (startups + funding_rounds + capital_graph_edges)"
    )
    parser.add_argument("--csv", required=True, help="Path to startups.csv")
    parser.add_argument("--region", default="global", help="Dataset region: global|turkey (legacy alias: tr)")
    parser.add_argument("--chunk-size", type=int, default=500, help="Rows per batch (default: 500)")
    args = parser.parse_args()

    region = normalize_region(args.region)
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL is not set (required for direct DB sync)", file=sys.stderr)
        return 2

    startups, rounds = read_csv_rows(args.csv)
    if not startups:
        print("No startups found; nothing to sync.")
        return 0

    inserted = 0
    updated = 0
    rounds_inserted = 0
    graph_stats: Dict[str, Any] = {
        "available": False,
        "investors_upserted": 0,
        "edges_upserted": 0,
        "views_refreshed": False,
        "candidate_rows": 0,
    }

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn:
            with conn.cursor() as cur:
                for chunk in chunked(startups, args.chunk_size):
                    values = [
                        (
                            region,
                            s.name,
                            s.slug,
                            s.description,
                            s.website,
                            s.hq_city,
                            s.hq_country,
                            s.continent,
                            s.industry,
                            s.stage,
                        )
                        for s in chunk
                    ]
                    rows = execute_values(
                        cur,
                        """
                        INSERT INTO startups (
                          dataset_region, name, slug, description, website,
                          headquarters_city, headquarters_country, continent, industry, stage
                        )
                        VALUES %s
                        ON CONFLICT (dataset_region, slug) DO UPDATE SET
                          name = EXCLUDED.name,
                          description = COALESCE(EXCLUDED.description, startups.description),
                          website = COALESCE(EXCLUDED.website, startups.website),
                          headquarters_city = EXCLUDED.headquarters_city,
                          headquarters_country = EXCLUDED.headquarters_country,
                          continent = EXCLUDED.continent,
                          industry = EXCLUDED.industry,
                          stage = EXCLUDED.stage,
                          onboarding_status = CASE
                            WHEN COALESCE(startups.onboarding_status, 'verified') = 'merged' THEN startups.onboarding_status
                            ELSE 'verified'
                          END,
                          updated_at = NOW()
                        RETURNING id, slug, (xmax = 0) AS inserted
                        """,
                        values,
                        page_size=max(1, int(args.chunk_size)),
                        fetch=True,
                    )
                    for _id, _slug, _ins in rows:
                        if _ins:
                            inserted += 1
                        else:
                            updated += 1

                # Funding rounds (match startup IDs by slug)
                if rounds:
                    # Build slug->id map for the region
                    # (The CSV usually has far fewer unique slugs than funding rows; this is cheap.)
                    slugs = sorted({r.slug for r in rounds})
                    cur.execute(
                        "SELECT slug, id FROM startups WHERE dataset_region = %s AND slug = ANY(%s)",
                        (region, slugs),
                    )
                    slug_to_id = {slug: sid for (slug, sid) in cur.fetchall() or []}

                    f_values: List[Tuple[Any, ...]] = []
                    for r in rounds:
                        sid = slug_to_id.get(r.slug)
                        if not sid:
                            continue
                        f_values.append((sid, r.round_type, r.amount_usd, r.announced_date, r.lead_investor))

                    for f_chunk in chunked(f_values, args.chunk_size):
                        if not f_chunk:
                            continue
                        execute_values(
                            cur,
                            """
                            INSERT INTO funding_rounds (startup_id, round_type, amount_usd, announced_date, lead_investor)
                            VALUES %s
                            ON CONFLICT (startup_id, round_type, announced_date) DO NOTHING
                            """,
                            f_chunk,
                            page_size=max(1, int(args.chunk_size)),
                        )
                        rounds_inserted += cur.rowcount or 0

                    graph_stats = sync_capital_graph_from_rounds(
                        cur,
                        rounds=rounds,
                        slug_to_id=slug_to_id,
                        region=region,
                        csv_path=args.csv,
                        chunk_size=args.chunk_size,
                    )

        print(
            f"DB sync complete (region={region}): startups inserted={inserted} updated={updated} "
            f"funding_rounds inserted={rounds_inserted} "
            f"graph_edges upserted={graph_stats.get('edges_upserted', 0)}"
        )
        if graph_stats.get("available"):
            print(
                "  Graph sync: "
                f"investors_upserted={graph_stats.get('investors_upserted', 0)} "
                f"candidate_rows={graph_stats.get('candidate_rows', 0)} "
                f"views_refreshed={bool(graph_stats.get('views_refreshed'))}"
            )
        else:
            print("  Graph sync: skipped (capital_graph_edges/investors tables not available)")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
