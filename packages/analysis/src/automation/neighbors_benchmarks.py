"""Neighbors & Benchmarks engine — computes startup similarity and cohort percentiles.

For each startup with a state snapshot:
1. If embeddings exist: pgvector ANN for candidate neighbors
2. Pattern Jaccard similarity
3. Metadata scoring (stage, vertical, market_type, genai_intensity)
4. Composite ranking → top-k neighbors stored in startup_neighbors

Cohort benchmarks: computes p10/p25/p50/p75/p90/mean/stddev per metric
for each cohort (stage, vertical, stage+vertical, overall).

Integration: Called via CLI `python main.py compute-neighbors` / `compute-benchmarks`
"""

from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional, Set, Tuple, TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_K = 10
MIN_COHORT_SIZE = 5

# Composite weights
W_VECTOR = 0.5
W_PATTERN = 0.3
W_META = 0.2

# Fallback weights (no vector embeddings)
W_PATTERN_FALLBACK = 0.6
W_META_FALLBACK = 0.4

# Metrics to benchmark
BENCHMARK_METRICS = (
    "funding_total_usd",
    "confidence_score",
    "engineering_quality_score",
    "pattern_count",
)

PERCENTILES = (10, 25, 50, 75, 90)


class NeighborsBenchmarksEngine:
    """Computes startup neighbors and cohort benchmarks."""

    def __init__(self, conn: "asyncpg.Connection"):
        self.conn = conn

    # ------------------------------------------------------------------
    # Neighbors
    # ------------------------------------------------------------------

    async def compute_neighbors(self, period: str, region: str = "global", k: int = DEFAULT_K) -> dict:
        """Compute k-nearest neighbors for all startups in a period."""
        stats = {"processed": 0, "neighbors_inserted": 0, "skipped": 0, "errors": 0}

        # Check if embeddings are available
        has_embeddings = await self._has_embeddings()
        method = "hybrid" if has_embeddings else "pattern_meta"
        logger.info("Computing neighbors: period=%s region=%s k=%d method=%s",
                     period, region, k, method)

        # Load all state snapshots for the period
        snapshots = await self._load_snapshots(period, region)
        if not snapshots:
            logger.warning("No snapshots found for period=%s region=%s", period, region)
            return stats

        # Build pattern index for Jaccard
        pattern_index: Dict[str, Set[str]] = {}
        for snap in snapshots:
            sid = str(snap["startup_id"])
            patterns = snap["build_patterns"] or []
            pattern_index[sid] = set(patterns)

        # Process each startup
        for snap in snapshots:
            sid = str(snap["startup_id"])
            try:
                candidates = await self._get_candidates(
                    snap, snapshots, pattern_index, has_embeddings, k, period, region
                )
                # Insert top-k
                for rank_idx, (neighbor_id, scores) in enumerate(candidates[:k], 1):
                    shared = sorted(pattern_index.get(sid, set()) &
                                    pattern_index.get(neighbor_id, set()))
                    await self.conn.execute(
                        """
                        INSERT INTO startup_neighbors
                            (startup_id, neighbor_id, rank, overall_score,
                             vector_score, pattern_score, meta_score,
                             shared_patterns, method, period)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        ON CONFLICT (startup_id, neighbor_id, period)
                        DO UPDATE SET rank = EXCLUDED.rank,
                                      overall_score = EXCLUDED.overall_score,
                                      vector_score = EXCLUDED.vector_score,
                                      pattern_score = EXCLUDED.pattern_score,
                                      meta_score = EXCLUDED.meta_score,
                                      shared_patterns = EXCLUDED.shared_patterns,
                                      method = EXCLUDED.method,
                                      computed_at = NOW()
                        """,
                        sid, neighbor_id, rank_idx,
                        scores["overall"], scores.get("vector"),
                        scores["pattern"], scores["meta"],
                        shared, method, period,
                    )
                    stats["neighbors_inserted"] += 1
                stats["processed"] += 1
            except Exception:
                logger.exception("Failed computing neighbors for startup %s", sid)
                stats["errors"] += 1

        logger.info("Neighbors computed: %s", stats)
        return stats

    async def _get_candidates(
        self,
        snap: dict,
        all_snapshots: List[dict],
        pattern_index: Dict[str, Set[str]],
        has_embeddings: bool,
        k: int,
        period: str,
        region: str,
    ) -> List[Tuple[str, Dict[str, Optional[float]]]]:
        """Score all other startups against this one and return top candidates."""
        sid = str(snap["startup_id"])
        my_patterns = pattern_index.get(sid, set())

        # Get vector candidates if available
        vector_scores: Dict[str, float] = {}
        if has_embeddings:
            vector_scores = await self._vector_candidates(sid, period, k * 3)

        scored: List[Tuple[str, Dict[str, Optional[float]]]] = []
        for other in all_snapshots:
            other_id = str(other["startup_id"])
            if other_id == sid:
                continue

            # Pattern Jaccard
            other_patterns = pattern_index.get(other_id, set())
            pattern_score = _jaccard(my_patterns, other_patterns)

            # Metadata score
            meta_score = _meta_similarity(snap, other)

            # Vector score
            vs = vector_scores.get(other_id)

            # Composite
            if vs is not None:
                overall = W_VECTOR * vs + W_PATTERN * pattern_score + W_META * meta_score
            else:
                overall = W_PATTERN_FALLBACK * pattern_score + W_META_FALLBACK * meta_score

            scored.append((other_id, {
                "overall": overall,
                "vector": vs,
                "pattern": pattern_score,
                "meta": meta_score,
            }))

        # Sort by overall descending
        scored.sort(key=lambda x: x[1].get("overall") or 0.0, reverse=True)
        return scored

    async def _vector_candidates(self, startup_id: str, period: str, limit: int) -> Dict[str, float]:
        """Get top candidates via pgvector ANN search."""
        try:
            rows = await self.conn.fetch(
                """
                SELECT s2.startup_id,
                       1 - (s1.embedding <=> s2.embedding) AS similarity
                FROM startup_state_snapshot s1
                JOIN startup_state_snapshot s2
                  ON s2.analysis_period = s1.analysis_period
                  AND s2.startup_id != s1.startup_id
                  AND s2.embedding IS NOT NULL
                WHERE s1.startup_id = $1
                  AND s1.analysis_period = $2
                  AND s1.embedding IS NOT NULL
                ORDER BY s1.embedding <=> s2.embedding
                LIMIT $3
                """,
                startup_id, period, limit,
            )
            return {str(r["startup_id"]): float(r["similarity"]) for r in rows}
        except Exception:
            logger.debug("Vector search unavailable for startup %s", startup_id)
            return {}

    async def _has_embeddings(self) -> bool:
        """Check if any embeddings exist in state snapshots."""
        try:
            row = await self.conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM startup_state_snapshot WHERE embedding IS NOT NULL LIMIT 1)"
            )
            return bool(row)
        except Exception:
            return False

    async def _load_snapshots(self, period: str, region: str) -> List[dict]:
        """Load all state snapshots for a period and region."""
        rows = await self.conn.fetch(
            """
            SELECT ss.startup_id, ss.funding_stage, ss.vertical, ss.sub_vertical,
                   ss.market_type, ss.genai_intensity, ss.build_patterns,
                   ss.confidence_score, ss.engineering_quality_score,
                   s.money_raised_usd
            FROM startup_state_snapshot ss
            JOIN startups s ON s.id = ss.startup_id
            WHERE ss.analysis_period = $1
              AND s.dataset_region = $2
            """,
            period, region,
        )
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Benchmarks
    # ------------------------------------------------------------------

    async def compute_benchmarks(self, period: str, region: str = "global") -> dict:
        """Compute cohort benchmarks for all cohort types and metrics."""
        stats = {"cohorts_computed": 0, "benchmarks_inserted": 0, "skipped_small": 0}

        snapshots = await self._load_snapshots(period, region)
        if not snapshots:
            logger.warning("No snapshots for benchmarks: period=%s region=%s", period, region)
            return stats

        # Build cohort groups
        cohorts: Dict[str, List[dict]] = {}

        # Overall
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

        # Compute benchmarks per cohort per metric
        for cohort_key, members in cohorts.items():
            if len(members) < MIN_COHORT_SIZE:
                stats["skipped_small"] += 1
                continue

            cohort_type = cohort_key.split(":")[0]

            for metric in BENCHMARK_METRICS:
                values = _extract_metric(members, metric)
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

        logger.info("Benchmarks computed: %s", stats)
        return stats


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _jaccard(a: Set[str], b: Set[str]) -> float:
    """Jaccard similarity between two sets."""
    if not a and not b:
        return 0.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union > 0 else 0.0


def _meta_similarity(a: dict, b: dict) -> float:
    """Metadata similarity score based on shared categorical attributes."""
    score = 0.0
    if a.get("funding_stage") and a["funding_stage"] == b.get("funding_stage"):
        score += 0.3
    if a.get("vertical") and a["vertical"] == b.get("vertical"):
        score += 0.3
    if a.get("market_type") and a["market_type"] == b.get("market_type"):
        score += 0.2
    if a.get("genai_intensity") and a["genai_intensity"] == b.get("genai_intensity"):
        score += 0.2
    return score


def _extract_metric(members: List[dict], metric: str) -> List[float]:
    """Extract numeric values for a metric, skipping nulls."""
    values = []
    for m in members:
        if metric == "funding_total_usd":
            v = m.get("money_raised_usd")
            if v is not None and v > 0:
                values.append(float(v))
        elif metric == "confidence_score":
            v = m.get("confidence_score")
            if v is not None:
                values.append(float(v))
        elif metric == "engineering_quality_score":
            v = m.get("engineering_quality_score")
            if v is not None:
                values.append(float(v))
        elif metric == "pattern_count":
            patterns = m.get("build_patterns") or []
            values.append(float(len(patterns)))
    return values


# ---------------------------------------------------------------------------
# Standalone runners
# ---------------------------------------------------------------------------

async def run_compute_neighbors(period: str, region: str = "global", k: int = DEFAULT_K) -> dict:
    """Entry point for CLI / cron."""
    import asyncpg

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    conn = await asyncpg.connect(database_url)
    try:
        engine = NeighborsBenchmarksEngine(conn)
        return await engine.compute_neighbors(period, region, k)
    finally:
        await conn.close()


async def run_compute_benchmarks(period: str, region: str = "global") -> dict:
    """Entry point for CLI / cron."""
    import asyncpg

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    conn = await asyncpg.connect(database_url)
    try:
        engine = NeighborsBenchmarksEngine(conn)
        return await engine.compute_benchmarks(period, region)
    finally:
        await conn.close()
