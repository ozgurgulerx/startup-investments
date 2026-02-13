#!/usr/bin/env python3
"""
Backfill investor->startup capital graph edges from funding_rounds.lead_investor.

Why this exists:
- The Investor DNA screener (/investors) and investor portfolio endpoints rely on
  canonical graph edges in `capital_graph_edges` (src_type='investor', dst_type='startup').
- In some environments we have `funding_rounds` populated (including `lead_investor`)
  but the corresponding investor edges were never projected into `capital_graph_edges`.

This script:
1) Reads funding_rounds + startups.dataset_region where lead_investor is present
2) Splits lead_investor into 1..N investor names
3) Upserts investors (type='unknown')
4) Upserts active graph edges: investor --LEADS_ROUND--> startup
5) Optionally refreshes capital graph materialized views.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Tuple

import psycopg2
from psycopg2.extras import execute_values

DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
GRAPH_ACTIVE_VALID_TO = date(9999, 12, 31)

_INVESTOR_SPLIT_RE = re.compile(r"\s+(?:and|ve)\s+|\s+&\s+|,|;|/|\|", re.IGNORECASE)
_INVESTOR_NAME_DENYLIST = {
    "undisclosed",
    "n/a",
    "na",
    "unknown",
    "investors",
}


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def split_investor_names(raw: str) -> List[str]:
    raw = _normalize_space(raw)
    if not raw:
        return []

    # Split by common delimiters (commas, &, "and", etc.).
    parts = [p.strip() for p in _INVESTOR_SPLIT_RE.split(raw) if p and p.strip()]
    seen: set[str] = set()
    out: List[str] = []
    for p in parts:
        name = _normalize_space(p)
        if not name:
            continue
        lower = name.lower()
        if lower in _INVESTOR_NAME_DENYLIST:
            continue
        if len(name) < 2:
            continue
        if lower in seen:
            continue
        seen.add(lower)
        out.append(name)
    return out


@dataclass(frozen=True)
class FundingRoundRow:
    round_id: str
    startup_id: str
    dataset_region: str
    round_type: Optional[str]
    amount_usd: Optional[int]
    announced_date: Optional[date]
    lead_investor: str


def chunked(items: List[Any], size: int) -> Iterable[List[Any]]:
    size = max(1, int(size))
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill capital_graph_edges investor->startup LEADS_ROUND edges from funding_rounds.lead_investor"
    )
    parser.add_argument("--dry-run", action="store_true", help="Compute stats but do not write to DB")
    parser.add_argument("--limit", type=int, default=0, help="Optional cap on funding_round rows processed (0 = no limit)")
    parser.add_argument("--chunk-size", type=int, default=500, help="Edges per insert batch (default: 500)")
    parser.add_argument(
        "--refresh-views",
        action="store_true",
        help="Refresh capital graph materialized views after writing edges (best-effort)",
    )
    args = parser.parse_args()

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL is not set", file=sys.stderr)
        return 2

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn:
            with conn.cursor() as cur:
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
                    print("ERROR: capital graph tables not available (need investors + capital_graph_edges)", file=sys.stderr)
                    return 3

                limit_clause = ""
                params: List[Any] = []
                if int(args.limit or 0) > 0:
                    limit_clause = "LIMIT %s"
                    params.append(int(args.limit))

                cur.execute(
                    f"""
                    SELECT
                      fr.id::text AS round_id,
                      fr.startup_id::text AS startup_id,
                      s.dataset_region,
                      fr.round_type,
                      fr.amount_usd,
                      fr.announced_date,
                      fr.lead_investor
                    FROM funding_rounds fr
                    JOIN startups s ON s.id = fr.startup_id
                    WHERE fr.lead_investor IS NOT NULL
                      AND length(trim(fr.lead_investor)) > 0
                    ORDER BY fr.announced_date DESC NULLS LAST, fr.created_at DESC
                    {limit_clause}
                    """,
                    params,
                )

                rounds: List[FundingRoundRow] = []
                for (
                    round_id,
                    startup_id,
                    dataset_region,
                    round_type,
                    amount_usd,
                    announced_date,
                    lead_investor,
                ) in cur.fetchall() or []:
                    rounds.append(
                        FundingRoundRow(
                            round_id=str(round_id),
                            startup_id=str(startup_id),
                            dataset_region=str(dataset_region or "global"),
                            round_type=str(round_type) if round_type else None,
                            amount_usd=int(amount_usd) if amount_usd is not None else None,
                            announced_date=announced_date,
                            lead_investor=str(lead_investor or ""),
                        )
                    )

                if not rounds:
                    print("No funding_rounds rows with lead_investor; nothing to backfill.")
                    return 0

                # Build unique investor map (normalized -> canonical display) to avoid redundant inserts.
                investor_display_by_norm: Dict[str, str] = {}
                edge_candidates: List[Tuple[str, str, str, FundingRoundRow]] = []
                for r in rounds:
                    names = split_investor_names(r.lead_investor)
                    if not names:
                        continue
                    for name in names:
                        norm = name.lower()
                        investor_display_by_norm.setdefault(norm, name)
                        edge_candidates.append((r.startup_id, r.dataset_region, norm, r))

                if not edge_candidates:
                    print("No investor names parsed from lead_investor fields; nothing to backfill.")
                    return 0

                print(
                    "Backfill candidates: "
                    f"funding_rounds={len(rounds)} parsed_edges={len(edge_candidates)} unique_investors={len(investor_display_by_norm)}"
                )

                if args.dry_run:
                    print("Dry run enabled; skipping DB writes.")
                    return 0

                # Upsert investors.
                investor_id_by_norm: Dict[str, str] = {}
                investors_inserted = 0

                for norm, display in investor_display_by_norm.items():
                    # Best-effort country hint: default Turkey for turkey dataset edges.
                    # (If an investor is inserted with NULL first, later TR rows will populate it via COALESCE.)
                    default_country = None
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
                        (display, default_country),
                    )
                    investor_id, inserted_now = cur.fetchone()
                    investor_id_by_norm[norm] = str(investor_id)
                    if bool(inserted_now):
                        investors_inserted += 1

                # Upsert edges in batches.
                edge_values: List[Tuple[Any, ...]] = []
                for startup_id, dataset_region, investor_norm, r in edge_candidates:
                    investor_id = investor_id_by_norm.get(investor_norm)
                    if not investor_id:
                        continue
                    valid_from = r.announced_date or date.today()
                    attrs: Dict[str, Any] = {
                        "round_type": r.round_type,
                        "amount_usd": r.amount_usd,
                        "announced_date": r.announced_date.isoformat() if r.announced_date else None,
                        "lead_investor": r.lead_investor,
                        "source": "funding_rounds_backfill",
                        "funding_round_id": r.round_id,
                    }
                    attrs_json = json.dumps({k: v for k, v in attrs.items() if v not in (None, "", [], {})})
                    edge_values.append(
                        (
                            "investor",
                            investor_id,
                            "LEADS_ROUND",
                            "startup",
                            startup_id,
                            dataset_region,
                            attrs_json,
                            "funding_rounds_backfill",
                            f"funding_round:{r.round_id}",
                            0.9,
                            "backfill-investor-edges-from-funding-rounds",
                            valid_from,
                            GRAPH_ACTIVE_VALID_TO,
                        )
                    )

                edges_upserted = 0
                for edge_chunk in chunked(edge_values, int(args.chunk_size)):
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
                        edge_chunk,
                        page_size=max(1, int(args.chunk_size)),
                    )
                    edges_upserted += int(cur.rowcount or 0)

                views_refreshed = False
                if args.refresh_views and edges_upserted > 0:
                    cur.execute("SELECT to_regprocedure('refresh_capital_graph_views()') IS NOT NULL")
                    fn_exists = bool(cur.fetchone()[0])
                    if fn_exists:
                        cur.execute("SELECT refresh_capital_graph_views()")
                        views_refreshed = True

                print(
                    "Backfill complete: "
                    f"investors_upserted={len(investor_display_by_norm)} "
                    f"investors_inserted={investors_inserted} "
                    f"edges_upserted={edges_upserted} "
                    f"views_refreshed={views_refreshed}"
                )

        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())

