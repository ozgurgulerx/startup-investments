"""Pattern Correlation Computation.

Scheduled job to compute pattern co-occurrence matrix
and update pattern_correlations table.
"""

import logging
import math
from typing import Dict, Any, List, Optional, Set, Tuple
from datetime import datetime, timezone
from dataclasses import dataclass
from collections import defaultdict

from .db import DatabaseConnection

logger = logging.getLogger(__name__)


@dataclass
class PatternStats:
    """Statistics for a single pattern."""
    name: str
    count: int
    total_funding: int
    avg_funding: float
    startups: Set[str]


@dataclass
class CorrelationResult:
    """Result of a pattern correlation computation."""
    pattern_a: str
    pattern_b: str
    co_occurrence_count: int
    correlation_coefficient: float
    lift_score: float
    avg_funding_both: Optional[int]
    avg_funding_a_only: Optional[int]
    avg_funding_b_only: Optional[int]


class PatternCorrelator:
    """Computes correlations between build patterns."""

    def __init__(self, db: Optional[DatabaseConnection] = None):
        self.db = db or DatabaseConnection()

    async def compute_correlations(self, period: Optional[str] = None) -> List[CorrelationResult]:
        """Compute all pattern correlations for a period."""
        period = period or datetime.now(timezone.utc).strftime("%Y-%m")
        results = []

        try:
            await self.db.connect()

            # Get all startups with patterns
            startups = await self.db.get_all_startups_with_patterns()
            logger.info(f"Computing correlations for {len(startups)} startups with patterns")

            if not startups:
                return results

            # Parse patterns and build statistics
            pattern_stats = self._build_pattern_stats(startups)
            patterns = list(pattern_stats.keys())

            logger.info(f"Found {len(patterns)} unique patterns")

            # Compute pairwise correlations
            total_startups = len(startups)

            for i, pattern_a in enumerate(patterns):
                for pattern_b in patterns[i + 1:]:
                    # Ensure consistent ordering (a < b)
                    if pattern_a > pattern_b:
                        pattern_a, pattern_b = pattern_b, pattern_a

                    correlation = self._compute_correlation(
                        pattern_stats[pattern_a],
                        pattern_stats[pattern_b],
                        total_startups
                    )

                    if correlation:
                        results.append(correlation)

                        # Save to database
                        await self.db.upsert_pattern_correlation(
                            pattern_a=correlation.pattern_a,
                            pattern_b=correlation.pattern_b,
                            period=period,
                            co_occurrence_count=correlation.co_occurrence_count,
                            total_a=pattern_stats[pattern_a].count,
                            total_b=pattern_stats[pattern_b].count,
                            avg_funding_both=correlation.avg_funding_both,
                            avg_funding_a_only=correlation.avg_funding_a_only,
                            avg_funding_b_only=correlation.avg_funding_b_only,
                            correlation_coefficient=correlation.correlation_coefficient,
                            lift_score=correlation.lift_score
                        )

            logger.info(f"Computed {len(results)} pattern correlations for period {period}")

            return results

        finally:
            await self.db.close()

    def _build_pattern_stats(
        self,
        startups: List[Dict[str, Any]]
    ) -> Dict[str, PatternStats]:
        """Build statistics for each pattern."""
        stats: Dict[str, PatternStats] = {}

        for startup in startups:
            pattern = startup.get("pattern")
            if not pattern:
                continue

            # Handle comma-separated patterns
            patterns = [p.strip() for p in pattern.split(",") if p.strip()]

            for p in patterns:
                if p not in stats:
                    stats[p] = PatternStats(
                        name=p,
                        count=0,
                        total_funding=0,
                        avg_funding=0.0,
                        startups=set()
                    )

                stats[p].count += 1
                stats[p].startups.add(str(startup["id"]))

                funding = startup.get("total_funding") or 0
                stats[p].total_funding += funding

        # Calculate averages
        for p in stats.values():
            if p.count > 0:
                p.avg_funding = p.total_funding / p.count

        return stats

    def _compute_correlation(
        self,
        stats_a: PatternStats,
        stats_b: PatternStats,
        total_startups: int
    ) -> Optional[CorrelationResult]:
        """Compute correlation between two patterns."""
        # Find co-occurrences
        both_startups = stats_a.startups & stats_b.startups
        co_occurrence_count = len(both_startups)

        # Skip if no co-occurrences
        if co_occurrence_count == 0:
            return None

        # Compute probabilities
        p_a = stats_a.count / total_startups
        p_b = stats_b.count / total_startups
        p_both = co_occurrence_count / total_startups

        # Expected co-occurrence under independence
        p_expected = p_a * p_b

        # Lift score: how much more likely they appear together than expected
        lift_score = p_both / p_expected if p_expected > 0 else 0

        # Phi coefficient (correlation for binary variables)
        # phi = (P(A&B) - P(A)*P(B)) / sqrt(P(A)*(1-P(A))*P(B)*(1-P(B)))
        numerator = p_both - (p_a * p_b)
        denominator = math.sqrt(p_a * (1 - p_a) * p_b * (1 - p_b))

        if denominator > 0:
            correlation_coefficient = numerator / denominator
        else:
            correlation_coefficient = 0

        # Compute funding averages
        # Startups with A only
        a_only = stats_a.startups - stats_b.startups
        b_only = stats_b.startups - stats_a.startups

        # For simplicity, we'd need the actual funding data to compute these
        # For now, return None for funding-based metrics
        avg_funding_both = None
        avg_funding_a_only = None
        avg_funding_b_only = None

        return CorrelationResult(
            pattern_a=stats_a.name,
            pattern_b=stats_b.name,
            co_occurrence_count=co_occurrence_count,
            correlation_coefficient=round(correlation_coefficient, 4),
            lift_score=round(lift_score, 2),
            avg_funding_both=avg_funding_both,
            avg_funding_a_only=avg_funding_a_only,
            avg_funding_b_only=avg_funding_b_only
        )

    async def get_top_correlations(
        self,
        period: str,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get top pattern correlations for a period."""
        try:
            await self.db.connect()

            rows = await self.db.fetch("""
                SELECT
                    pattern_a, pattern_b,
                    co_occurrence_count,
                    total_startups_with_a,
                    total_startups_with_b,
                    correlation_coefficient,
                    lift_score,
                    avg_funding_with_both
                FROM pattern_correlations
                WHERE period = $1
                ORDER BY lift_score DESC
                LIMIT $2
            """, period, limit)

            return [dict(r) for r in rows]

        finally:
            await self.db.close()

    async def get_pattern_insights(self, pattern: str, period: str) -> Dict[str, Any]:
        """Get correlation insights for a specific pattern."""
        try:
            await self.db.connect()

            # Get correlations where this pattern appears
            rows = await self.db.fetch("""
                SELECT
                    CASE WHEN pattern_a = $1 THEN pattern_b ELSE pattern_a END as related_pattern,
                    co_occurrence_count,
                    correlation_coefficient,
                    lift_score
                FROM pattern_correlations
                WHERE period = $2 AND (pattern_a = $1 OR pattern_b = $1)
                ORDER BY lift_score DESC
            """, pattern, period)

            positive_correlations = [
                dict(r) for r in rows
                if r["correlation_coefficient"] > 0.1
            ]

            negative_correlations = [
                dict(r) for r in rows
                if r["correlation_coefficient"] < -0.1
            ]

            return {
                "pattern": pattern,
                "period": period,
                "positive_correlations": positive_correlations[:10],
                "negative_correlations": negative_correlations[:10],
                "total_correlations": len(rows)
            }

        finally:
            await self.db.close()


async def run_pattern_correlator(period: Optional[str] = None) -> List[CorrelationResult]:
    """Run the pattern correlation computation."""
    correlator = PatternCorrelator()
    results = await correlator.compute_correlations(period=period)

    if results:
        # Log top correlations
        sorted_results = sorted(results, key=lambda x: x.lift_score, reverse=True)
        logger.info("Top 5 pattern correlations by lift:")
        for r in sorted_results[:5]:
            logger.info(f"  {r.pattern_a} + {r.pattern_b}: lift={r.lift_score}, corr={r.correlation_coefficient}")

    return results
