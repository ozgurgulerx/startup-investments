"""Extended benchmarks computation — adds pattern-based cohorts and additional metrics.

Extends the base compute_benchmarks from neighbors_benchmarks.py to also compute:
- pattern:{pattern_name} cohorts
- stage+pattern:{stage}:{pattern} cohorts
- conviction_mean metric (from signal_occurrences)
- latest_round_usd metric (from funding_rounds)

Integration: Called via CLI `python main.py compute-benchmarks-extended`
"""

from __future__ import annotations

import logging
import os
from typing import Dict, List, TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    import asyncpg

from .neighbors_benchmarks import NeighborsBenchmarksEngine, MIN_COHORT_SIZE, PERCENTILES

logger = logging.getLogger(__name__)

EXTENDED_METRICS = (
    "funding_total_usd",
    "latest_round_usd",
    "employee_count",
    "confidence_score",
    "engineering_quality_score",
    "conviction_mean",
    "pattern_count",
)


class ExtendedBenchmarksEngine(NeighborsBenchmarksEngine):
    """Extends base benchmarks with pattern cohorts and more metrics."""

    async def compute_extended_benchmarks(self, period: str, region: str = "global") -> dict:
        """Compute benchmarks for all cohort types including pattern-based."""
        stats = {"cohorts_computed": 0, "benchmarks_inserted": 0, "skipped_small": 0}

        # Load snapshots with extended data
        snapshots = await self._load_extended_snapshots(period, region)
        if not snapshots:
            logger.warning("No snapshots for extended benchmarks: period=%s region=%s", period, region)
            return stats

        # Build cohort groups
        cohorts: Dict[str, List[dict]] = {}
        cohorts["all:all"] = snapshots

        for snap in snapshots:
            # By stage
            if snap["funding_stage"]:
                key = f"stage:{snap['funding_stage']}"
                cohorts.setdefault(key, []).append(snap)

            # By vertical
            if snap["vertical"]:
                key = f"vertical:{snap['vertical']}"
                cohorts.setdefault(key, []).append(snap)

            # By stage + vertical
            if snap["funding_stage"] and snap["vertical"]:
                key = f"stage_vertical:{snap['funding_stage']}:{snap['vertical']}"
                cohorts.setdefault(key, []).append(snap)

            # By pattern (each startup can appear in multiple pattern cohorts)
            patterns = snap.get("build_patterns") or []
            for pat in patterns:
                pat_name = pat if isinstance(pat, str) else (pat.get("name") if isinstance(pat, dict) else str(pat))
                if pat_name:
                    key = f"pattern:{pat_name}"
                    cohorts.setdefault(key, []).append(snap)

                    # stage + pattern
                    if snap["funding_stage"]:
                        key2 = f"stage_pattern:{snap['funding_stage']}:{pat_name}"
                        cohorts.setdefault(key2, []).append(snap)

        # Compute benchmarks per cohort per metric
        for cohort_key, members in cohorts.items():
            if len(members) < MIN_COHORT_SIZE:
                stats["skipped_small"] += 1
                continue

            cohort_type = cohort_key.split(":")[0]

            for metric in EXTENDED_METRICS:
                values = self._extract_extended_metric(members, metric)
                if len(values) < MIN_COHORT_SIZE:
                    continue

                arr = np.array(values, dtype=float)
                pcts = np.percentile(arr, PERCENTILES)

                await self.conn.execute(
                    """
                    INSERT INTO cohort_benchmarks
                        (cohort_key, cohort_type, region, metric, cohort_size,
                         p10, p25, p50, p75, p90, mean, stddev, period)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    ON CONFLICT (cohort_key, metric, period, region)
                    DO UPDATE SET cohort_size = EXCLUDED.cohort_size,
                                  p10 = EXCLUDED.p10, p25 = EXCLUDED.p25,
                                  p50 = EXCLUDED.p50, p75 = EXCLUDED.p75,
                                  p90 = EXCLUDED.p90, mean = EXCLUDED.mean,
                                  stddev = EXCLUDED.stddev,
                                  computed_at = NOW()
                    """,
                    cohort_key, cohort_type, region, metric, len(values),
                    float(pcts[0]), float(pcts[1]), float(pcts[2]),
                    float(pcts[3]), float(pcts[4]),
                    float(np.mean(arr)), float(np.std(arr)),
                    period,
                )
                stats["benchmarks_inserted"] += 1

            stats["cohorts_computed"] += 1

        logger.info("Extended benchmarks computed: %s", stats)
        return stats

    async def _load_extended_snapshots(self, period: str, region: str) -> List[dict]:
        """Load snapshots with additional metrics for extended benchmarks."""
        rows = await self.conn.fetch(
            """
            SELECT ss.startup_id, ss.funding_stage, ss.vertical, ss.sub_vertical,
                   ss.market_type, ss.genai_intensity, ss.build_patterns,
                   ss.confidence_score, ss.engineering_quality_score,
                   s.money_raised_usd, s.employee_count,
                   (SELECT fr.amount_usd FROM funding_rounds fr
                    WHERE fr.startup_id = ss.startup_id
                    ORDER BY fr.announced_date DESC NULLS LAST LIMIT 1) AS latest_round_usd,
                   (SELECT AVG(so.score) FROM signal_occurrences so
                    WHERE so.startup_id = ss.startup_id) AS conviction_mean
            FROM startup_state_snapshot ss
            JOIN startups s ON s.id = ss.startup_id
            WHERE ss.analysis_period = $1
              AND s.dataset_region = $2
            """,
            period, region,
        )
        return [dict(r) for r in rows]

    @staticmethod
    def _extract_extended_metric(members: List[dict], metric: str) -> List[float]:
        """Extract numeric values for extended metrics."""
        values = []
        for m in members:
            v = None
            if metric == "funding_total_usd":
                v = m.get("money_raised_usd")
                if v is not None and v > 0:
                    values.append(float(v))
                continue
            elif metric == "latest_round_usd":
                v = m.get("latest_round_usd")
            elif metric == "employee_count":
                v = m.get("employee_count")
            elif metric == "confidence_score":
                v = m.get("confidence_score")
            elif metric == "engineering_quality_score":
                v = m.get("engineering_quality_score")
            elif metric == "conviction_mean":
                v = m.get("conviction_mean")
            elif metric == "pattern_count":
                patterns = m.get("build_patterns") or []
                values.append(float(len(patterns)))
                continue

            if v is not None:
                values.append(float(v))
        return values


async def compute_startup_ranks(conn: "asyncpg.Connection", period: str, region: str = "global") -> dict:
    """Compute per-startup percentile ranks and store in startup_state_snapshot.percentile_ranks."""
    stats = {"startups_ranked": 0, "errors": 0}

    # Load all benchmarks for this period/region
    bench_rows = await conn.fetch(
        """
        SELECT cohort_key, metric, p10, p25, p50, p75, p90
        FROM cohort_benchmarks
        WHERE period = $1 AND region = $2
        """,
        period, region,
    )
    # Build lookup: {metric: {cohort_key: {p10, p25, p50, p75, p90}}}
    benchmarks: Dict[str, Dict[str, dict]] = {}
    for r in bench_rows:
        benchmarks.setdefault(r["metric"], {})[r["cohort_key"]] = {
            "p10": r["p10"], "p25": r["p25"], "p50": r["p50"],
            "p75": r["p75"], "p90": r["p90"],
        }

    # Load snapshots
    snapshots = await conn.fetch(
        """
        SELECT ss.startup_id, ss.funding_stage, ss.vertical, ss.build_patterns,
               ss.confidence_score, ss.engineering_quality_score,
               s.money_raised_usd, s.employee_count
        FROM startup_state_snapshot ss
        JOIN startups s ON s.id = ss.startup_id
        WHERE ss.analysis_period = $1 AND s.dataset_region = $2
        """,
        period, region,
    )

    for snap in snapshots:
        try:
            ranks: Dict[str, Dict[str, int]] = {}
            sid = str(snap["startup_id"])

            # Determine natural cohorts
            cohort_keys = ["all:all"]
            if snap["funding_stage"]:
                cohort_keys.append(f"stage:{snap['funding_stage']}")
            if snap["vertical"]:
                cohort_keys.append(f"vertical:{snap['vertical']}")

            patterns = snap["build_patterns"] or []
            for pat in patterns:
                pat_name = pat if isinstance(pat, str) else (pat.get("name") if isinstance(pat, dict) else str(pat))
                if pat_name:
                    cohort_keys.append(f"pattern:{pat_name}")

            # For each metric, compute percentile rank in each cohort
            metric_values = {
                "funding_total_usd": snap.get("money_raised_usd"),
                "confidence_score": snap.get("confidence_score"),
                "engineering_quality_score": snap.get("engineering_quality_score"),
                "employee_count": snap.get("employee_count"),
                "pattern_count": len(patterns),
            }

            for metric, value in metric_values.items():
                if value is None:
                    continue
                val = float(value)
                metric_ranks = {}
                for ck in cohort_keys:
                    pcts = benchmarks.get(metric, {}).get(ck)
                    if not pcts:
                        continue
                    # Estimate percentile from distribution
                    percentile = _estimate_percentile(val, pcts)
                    metric_ranks[ck] = percentile
                if metric_ranks:
                    ranks[metric] = metric_ranks

            import json
            await conn.execute(
                """
                UPDATE startup_state_snapshot
                SET percentile_ranks = $1::jsonb
                WHERE startup_id = $2 AND analysis_period = $3
                """,
                json.dumps(ranks), sid, period,
            )
            stats["startups_ranked"] += 1
        except Exception:
            logger.exception("Failed ranking startup %s", snap["startup_id"])
            stats["errors"] += 1

    logger.info("Startup ranks computed: %s", stats)
    return stats


def _estimate_percentile(value: float, pcts: dict) -> int:
    """Estimate percentile from p10/p25/p50/p75/p90 distribution."""
    p10 = pcts.get("p10") or 0
    p25 = pcts.get("p25") or 0
    p50 = pcts.get("p50") or 0
    p75 = pcts.get("p75") or 0
    p90 = pcts.get("p90") or 0

    if value <= p10:
        return 5
    elif value <= p25:
        return int(10 + (value - p10) / max(p25 - p10, 1e-9) * 15)
    elif value <= p50:
        return int(25 + (value - p25) / max(p50 - p25, 1e-9) * 25)
    elif value <= p75:
        return int(50 + (value - p50) / max(p75 - p50, 1e-9) * 25)
    elif value <= p90:
        return int(75 + (value - p75) / max(p90 - p75, 1e-9) * 15)
    else:
        return 95


# ---------------------------------------------------------------------------
# Standalone runners
# ---------------------------------------------------------------------------

async def run_extended_benchmarks(period: str, region: str = "global") -> dict:
    """Entry point for CLI / cron."""
    import asyncpg

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    conn = await asyncpg.connect(database_url)
    try:
        engine = ExtendedBenchmarksEngine(conn)
        bench_stats = await engine.compute_extended_benchmarks(period, region)
        rank_stats = await compute_startup_ranks(conn, period, region)
        return {**bench_stats, **rank_stats}
    finally:
        await conn.close()
