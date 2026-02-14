"""Investor DNA computation — pattern exposure, thesis shifts, and co-invest edges.

For each investor in a period:
1. Aggregate deal count, total $, pattern allocation, stage distribution
2. Compute Jensen-Shannon divergence for thesis shift vs previous quarter
3. Build co-invest edges for shared funding rounds

Integration: Called via CLI `python main.py compute-investor-dna`
"""

from __future__ import annotations

import json
import logging
import os
from collections import defaultdict
from datetime import date
from typing import Dict, List, TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)


def _parse_command_tag_count(tag: str) -> int:
    # asyncpg returns strings like: "INSERT 0 123" or "UPDATE 45"
    parts = (tag or "").strip().split()
    for p in reversed(parts):
        if p.isdigit():
            try:
                return int(p)
            except Exception:
                return 0
    return 0


class InvestorDNAEngine:
    """Computes investor pattern mix, thesis shifts, and co-invest graph."""

    def __init__(self, conn: "asyncpg.Connection"):
        self.conn = conn

    async def run(self, period: str, scope: str = "global") -> dict:
        """Main execution — compute investor DNA for a period."""
        stats = {
            "investors_processed": 0,
            "mix_inserted": 0,
            "edges_inserted": 0,
            "graph_coinvest_edges_upserted": 0,
            "errors": 0,
        }

        month_date = date.fromisoformat(f"{period}-01")
        logger.info("Computing investor DNA: period=%s scope=%s", period, scope)

        # Load investor funding activity + patterns for the period.
        #
        # Canonical source is capital_graph_edges (investor -> startup edges) because our
        # primary pipelines populate the capital graph, not the legacy investments table.
        rounds_data = await self._load_period_data(period, scope)
        if not rounds_data:
            logger.warning("No funding data for period=%s scope=%s", period, scope)
            return stats

        # Group by investor
        investor_data: Dict[str, dict] = {}
        round_investors: Dict[str, List[str]] = {}  # round_id -> [investor_ids]

        for row in rounds_data:
            inv_id = str(row["investor_id"])
            round_id = str(row["round_id"])

            if inv_id not in investor_data:
                investor_data[inv_id] = {
                    "deals": 0, "total_usd": 0, "lead_count": 0,
                    "amounts": [], "pattern_deals": defaultdict(int),
                    "pattern_amounts": defaultdict(float),
                    "stage_deals": defaultdict(int),
                    "stage_amounts": defaultdict(float),
                }

            d = investor_data[inv_id]
            d["deals"] += 1
            amount = float(row["amount_usd"] or 0)
            d["total_usd"] += amount
            if amount > 0:
                d["amounts"].append(amount)
            if row["is_lead"]:
                d["lead_count"] += 1

            # Stage
            stage = row["funding_stage"] or "unknown"
            d["stage_deals"][stage] += 1
            d["stage_amounts"][stage] += amount

            # Patterns
            patterns = row["build_patterns"] or []
            for pat in patterns:
                pat_name = pat if isinstance(pat, str) else (pat.get("name") if isinstance(pat, dict) else str(pat))
                if pat_name:
                    d["pattern_deals"][pat_name] += 1
                    d["pattern_amounts"][pat_name] += amount / max(len(patterns), 1)

            # Track round participants for co-invest
            round_investors.setdefault(round_id, []).append(inv_id)

        # Compute thesis shift (JS divergence vs previous quarter)
        prev_period = _prev_quarter_period(period)
        prev_mixes = await self._load_prev_mixes(prev_period, scope)

        # Insert investor pattern mix
        for inv_id, d in investor_data.items():
            try:
                median_check = float(np.median(d["amounts"])) if d["amounts"] else None

                # Thesis shift
                thesis_shift = None
                top_gainers = None
                prev_mix = prev_mixes.get(inv_id)
                if prev_mix:
                    thesis_shift, top_gainers = _compute_thesis_shift(
                        dict(d["pattern_deals"]), prev_mix
                    )

                await self.conn.execute(
                    """
                    INSERT INTO investor_pattern_mix
                        (scope, month, investor_id, deal_count, total_amount_usd,
                         lead_count, median_check_usd,
                         pattern_deal_counts, pattern_amounts,
                         stage_deal_counts, stage_amounts,
                         thesis_shift_js, top_gainers)
                    VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
                            $10::jsonb, $11::jsonb, $12, $13::jsonb)
                    ON CONFLICT (scope, month, investor_id)
                    DO UPDATE SET deal_count = EXCLUDED.deal_count,
                                  total_amount_usd = EXCLUDED.total_amount_usd,
                                  lead_count = EXCLUDED.lead_count,
                                  median_check_usd = EXCLUDED.median_check_usd,
                                  pattern_deal_counts = EXCLUDED.pattern_deal_counts,
                                  pattern_amounts = EXCLUDED.pattern_amounts,
                                  stage_deal_counts = EXCLUDED.stage_deal_counts,
                                  stage_amounts = EXCLUDED.stage_amounts,
                                  thesis_shift_js = EXCLUDED.thesis_shift_js,
                                  top_gainers = EXCLUDED.top_gainers,
                                  computed_at = NOW()
                    """,
                    scope, month_date, inv_id, d["deals"],
                    d["total_usd"] if d["total_usd"] > 0 else None,
                    d["lead_count"],
                    median_check if median_check else None,
                    json.dumps(dict(d["pattern_deals"])),
                    json.dumps({k: round(v, 2) for k, v in d["pattern_amounts"].items()}),
                    json.dumps(dict(d["stage_deals"])),
                    json.dumps({k: round(v, 2) for k, v in d["stage_amounts"].items()}),
                    thesis_shift,
                    json.dumps(top_gainers) if top_gainers else None,
                )
                stats["mix_inserted"] += 1
                stats["investors_processed"] += 1
            except Exception:
                logger.exception("Failed inserting mix for investor %s", inv_id)
                stats["errors"] += 1

        # Build co-invest edges
        for round_id, participants in round_investors.items():
            if len(participants) < 2:
                continue
            # Find the round's amount and patterns
            round_info = next(
                (r for r in rounds_data if str(r["round_id"]) == round_id), None
            )
            amount = float(round_info["amount_usd"] or 0) if round_info else 0
            patterns = round_info["build_patterns"] if round_info else []

            for i, inv_a in enumerate(participants):
                for inv_b in participants[i + 1:]:
                    try:
                        pat_names = []
                        for p in (patterns or []):
                            pn = p if isinstance(p, str) else (p.get("name") if isinstance(p, dict) else str(p))
                            if pn:
                                pat_names.append(pn)

                        for a, b in [(inv_a, inv_b), (inv_b, inv_a)]:
                            await self.conn.execute(
                                """
                                INSERT INTO investor_co_invest_edges
                                    (scope, month, investor_id, partner_investor_id,
                                     co_deals, co_amount_usd, shared_patterns)
                                VALUES ($1, $2, $3::uuid, $4::uuid, 1, $5, $6::jsonb)
                                ON CONFLICT (scope, month, investor_id, partner_investor_id)
                                DO UPDATE SET co_deals = investor_co_invest_edges.co_deals + 1,
                                              co_amount_usd = COALESCE(investor_co_invest_edges.co_amount_usd, 0) + COALESCE(EXCLUDED.co_amount_usd, 0),
                                              shared_patterns = EXCLUDED.shared_patterns
                                """,
                                scope, month_date, a, b,
                                amount if amount > 0 else None,
                                json.dumps(pat_names) if pat_names else None,
                            )
                            stats["edges_inserted"] += 1
                    except Exception:
                        logger.exception("Failed inserting co-invest edge %s<->%s", inv_a, inv_b)
                        stats["errors"] += 1

        # Sync co-invest edges into the canonical capital graph for graph-based traversal APIs.
        try:
            stats["graph_coinvest_edges_upserted"] = await self._sync_coinvest_edges_to_capital_graph(scope)
        except Exception:
            logger.exception("Failed syncing co-invest edges into capital graph (scope=%s)", scope)
            stats["errors"] += 1

        logger.info("Investor DNA computed: %s", stats)
        return stats

    async def _sync_coinvest_edges_to_capital_graph(self, scope: str) -> int:
        """Upsert investor<->investor co-invest edges into capital_graph_edges (current-only)."""
        try:
            has_graph = await self.conn.fetchval(
                "SELECT to_regclass('public.capital_graph_edges') IS NOT NULL"
            )
        except Exception:
            has_graph = False

        if not has_graph:
            return 0

        tag = await self.conn.execute(
            """
            INSERT INTO capital_graph_edges (
              src_type, src_id, edge_type, dst_type, dst_id, region,
              attrs_json, source, source_ref, confidence, created_by,
              valid_from, valid_to
            )
            SELECT
              'investor' AS src_type,
              ice.investor_id AS src_id,
              'CO_INVESTS_WITH' AS edge_type,
              'investor' AS dst_type,
              ice.partner_investor_id AS dst_id,
              $1::text AS region,
              jsonb_build_object(
                'co_deals', SUM(ice.co_deals)::int,
                'co_amount_usd', SUM(COALESCE(ice.co_amount_usd, 0))
              ) AS attrs_json,
              'investor_dna' AS source,
              'investor_co_invest_edges' AS source_ref,
              NULL AS confidence,
              'compute-investor-dna' AS created_by,
              DATE '1900-01-01' AS valid_from,
              DATE '9999-12-31' AS valid_to
            FROM investor_co_invest_edges ice
            WHERE ice.scope = $1
              AND ice.investor_id <> ice.partner_investor_id
            GROUP BY ice.investor_id, ice.partner_investor_id
            ON CONFLICT (src_type, src_id, edge_type, dst_type, dst_id, region, valid_from, valid_to)
            DO UPDATE SET
              attrs_json = capital_graph_edges.attrs_json || EXCLUDED.attrs_json,
              source = EXCLUDED.source,
              source_ref = EXCLUDED.source_ref,
              confidence = COALESCE(EXCLUDED.confidence, capital_graph_edges.confidence),
              created_by = COALESCE(EXCLUDED.created_by, capital_graph_edges.created_by),
              updated_at = NOW()
            """,
            scope,
        )
        return _parse_command_tag_count(tag)

    async def _load_period_data(self, period: str, scope: str) -> List[dict]:
        """Load funding rounds with investor and pattern data for a period.

        Prefers capital_graph_edges (canonical) and falls back to legacy investments join.
        """
        # Prefer graph-backed investor edges (populated by CSV sync + news ingest).
        try:
            has_graph = await self.conn.fetchval(
                "SELECT to_regclass('public.capital_graph_edges') IS NOT NULL"
            )
        except Exception:
            has_graph = False

        if has_graph:
            try:
                rows = await self.conn.fetch(
                    """
                    WITH edges AS (
                      SELECT
                        COALESCE(
                          NULLIF(e.attrs_json->>'announced_date', '')::date,
                          e.valid_from
                        ) AS edge_date,
                        e.dst_id AS startup_id,
                        e.src_id AS investor_id,
                        COALESCE(
                          NULLIF(e.attrs_json->>'round_type', ''),
                          fr.round_type,
                          e.edge_type
                        ) AS round_type,
                        COALESCE(
                          NULLIF(e.attrs_json->>'amount_usd', '')::numeric,
                          fr.amount_usd
                        ) AS amount_usd,
                        TRUE AS is_lead,
                        COALESCE(fr.id::text, '') AS funding_round_id
                      FROM capital_graph_edges e
                      JOIN startups s ON s.id = e.dst_id
                      LEFT JOIN funding_rounds fr
                        ON fr.startup_id = e.dst_id
                       AND fr.announced_date = COALESCE(
                            NULLIF(e.attrs_json->>'announced_date', '')::date,
                            e.valid_from
                          )
                       AND (
                            NULLIF(e.attrs_json->>'round_type', '') IS NULL
                            OR lower(fr.round_type) = lower(NULLIF(e.attrs_json->>'round_type', ''))
                          )
                      WHERE e.src_type = 'investor'
                        AND e.dst_type = 'startup'
                        AND e.region = $2
                        AND e.valid_to = DATE '9999-12-31'
                        AND s.dataset_region = $2
                    )
                    SELECT
                      CASE
                        WHEN edges.funding_round_id <> '' THEN edges.funding_round_id
                        ELSE (edges.startup_id::text || ':' || edges.round_type || ':' || edges.edge_date::text)
                      END AS round_id,
                      edges.startup_id,
                      edges.round_type,
                      edges.amount_usd,
                      edges.investor_id,
                      edges.is_lead,
                      ss.funding_stage,
                      ss.build_patterns
                    FROM edges
                    LEFT JOIN startup_state_snapshot ss
                      ON ss.startup_id = edges.startup_id
                     AND ss.analysis_period = $1
                    WHERE edges.edge_date >= ($1 || '-01')::date
                      AND edges.edge_date < (($1 || '-01')::date + INTERVAL '1 month')
                    """,
                    period,
                    scope,
                )
                return [dict(r) for r in rows]
            except Exception:
                logger.exception(
                    "Failed loading investor DNA period data from capital graph (period=%s scope=%s); "
                    "falling back to legacy investments path",
                    period,
                    scope,
                )

        # Legacy fallback: funding_rounds + investments join.
        rows = await self.conn.fetch(
            """
            SELECT fr.id AS round_id, fr.startup_id, fr.round_type, fr.amount_usd,
                   inv.investor_id, inv.is_lead,
                   ss.funding_stage, ss.build_patterns
            FROM funding_rounds fr
            JOIN investments inv ON inv.funding_round_id = fr.id
            JOIN startups s ON s.id = fr.startup_id
            LEFT JOIN startup_state_snapshot ss
              ON ss.startup_id = fr.startup_id
              AND ss.analysis_period = $1
            WHERE fr.announced_date >= ($1 || '-01')::date
              AND fr.announced_date < (($1 || '-01')::date + INTERVAL '1 month')
              AND s.dataset_region = $2
            """,
            period,
            scope,
        )
        return [dict(r) for r in rows]

    async def _load_prev_mixes(self, prev_period: str, scope: str) -> Dict[str, dict]:
        """Load previous period pattern_deal_counts for thesis shift."""
        rows = await self.conn.fetch(
            """
            SELECT investor_id::text, pattern_deal_counts
            FROM investor_pattern_mix
            WHERE scope = $1 AND month = ($2 || '-01')::date
            """,
            scope, prev_period,
        )
        result = {}
        for r in rows:
            pdc = r["pattern_deal_counts"]
            if isinstance(pdc, str):
                pdc = json.loads(pdc)
            result[r["investor_id"]] = pdc or {}
        return result


def _prev_quarter_period(period: str) -> str:
    """Given '2026-02', return '2025-11' (3 months back)."""
    year, month = int(period[:4]), int(period[5:7])
    month -= 3
    if month <= 0:
        month += 12
        year -= 1
    return f"{year}-{month:02d}"


def _compute_thesis_shift(
    current: Dict[str, int], previous: Dict[str, int]
) -> tuple:
    """Compute Jensen-Shannon divergence between pattern distributions."""
    all_patterns = sorted(set(current.keys()) | set(previous.keys()))
    if not all_patterns:
        return None, None

    curr_total = sum(current.values()) or 1
    prev_total = sum(previous.values()) or 1

    p = np.array([current.get(k, 0) / curr_total for k in all_patterns])
    q = np.array([previous.get(k, 0) / prev_total for k in all_patterns])

    # Add small epsilon to avoid log(0)
    eps = 1e-10
    p = p + eps
    q = q + eps
    p = p / p.sum()
    q = q / q.sum()

    m = 0.5 * (p + q)
    js = 0.5 * np.sum(p * np.log(p / m)) + 0.5 * np.sum(q * np.log(q / m))
    js_val = float(np.clip(js, 0, 1))

    # Top gainers: patterns with biggest positive delta in percentage points
    top_gainers = []
    for i, pat in enumerate(all_patterns):
        delta_pp = (p[i] - eps) / (p.sum() - len(all_patterns) * eps) - \
                   (q[i] - eps) / (q.sum() - len(all_patterns) * eps)
        if delta_pp > 0.01:
            top_gainers.append({"pattern": pat, "delta_pp": round(float(delta_pp) * 100, 1)})
    top_gainers.sort(key=lambda x: x["delta_pp"], reverse=True)

    return round(js_val, 4), top_gainers[:5] if top_gainers else None


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

async def run_investor_dna(period: str, scope: str = "global") -> dict:
    """Entry point for CLI / cron."""
    import asyncpg

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    conn = await asyncpg.connect(database_url)
    try:
        engine = InvestorDNAEngine(conn)
        return await engine.run(period, scope)
    finally:
        await conn.close()
