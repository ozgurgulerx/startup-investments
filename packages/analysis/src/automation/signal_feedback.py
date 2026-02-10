"""Signal Feedback Loop — reads community signals to feed back into ranking, source weighting, and gating.

Aggregates data from ``news_item_stats`` and ``news_item_signals`` (upvote, save, hide, not_useful)
into per-cluster, per-source, and per-topic scores using Wilson score confidence intervals.

Cold-start safe: all functions return neutral values when no signal data exists.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Dict, Optional, Sequence

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

# Minimum cluster count for a source/topic to be included in scoring.
MIN_SOURCE_CLUSTERS = 5
MIN_TOPIC_CLUSTERS = 3


def _wilson_lower(upvotes: int, total: int, z: float = 1.96) -> float:
    """Lower bound of Wilson score confidence interval.

    Handles low-count items fairly — 1 upvote on 1 total is NOT 100%.
    Returns 0.5 (neutral) when total is zero.
    """
    if total == 0:
        return 0.5
    p = upvotes / total
    denominator = 1 + z * z / total
    centre = p + z * z / (2 * total)
    spread = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total)
    return (centre - spread) / denominator


@dataclass
class _ClusterSignal:
    cluster_id: str
    upvote_count: int = 0
    not_useful_count: int = 0
    topic_tags: Sequence[str] = ()


@dataclass
class _SourceSignal:
    source_key: str
    total_upvotes: int = 0
    total_not_useful: int = 0
    cluster_count: int = 0


@dataclass
class _TopicSignal:
    topic: str
    total_upvotes: int = 0
    total_not_useful: int = 0
    cluster_count: int = 0


class SignalAggregator:
    """Reads community signal data to feed back into ranking, source weighting, and gating."""

    def __init__(self) -> None:
        self._cluster_signals: Dict[str, _ClusterSignal] = {}
        self._source_signals: Dict[str, _SourceSignal] = {}
        self._topic_signals: Dict[str, _TopicSignal] = {}
        self._loaded = False

    @property
    def loaded(self) -> bool:
        return self._loaded

    async def load(
        self,
        conn: "asyncpg.Connection",
        *,
        lookback_days: int = 14,
        region: str = "global",
    ) -> None:
        """Load signal stats for recent clusters from the database."""
        try:
            # --- Per-cluster signals ---
            rows = await conn.fetch(
                """
                SELECT s.cluster_id::text, s.upvote_count, s.not_useful_count,
                       c.topic_tags
                FROM news_item_stats s
                JOIN news_clusters c ON c.id = s.cluster_id
                WHERE c.published_at > now() - make_interval(days => $1)
                  AND c.region = $2
                  AND (s.upvote_count + s.not_useful_count) > 0
                """,
                lookback_days,
                region,
            )
            for row in rows:
                cid = str(row["cluster_id"])
                tags = row["topic_tags"] or []
                self._cluster_signals[cid] = _ClusterSignal(
                    cluster_id=cid,
                    upvote_count=int(row["upvote_count"] or 0),
                    not_useful_count=int(row["not_useful_count"] or 0),
                    topic_tags=list(tags),
                )

            # --- Per-source aggregate ---
            source_rows = await conn.fetch(
                """
                SELECT ns.source_key,
                       SUM(s.upvote_count)::int AS total_upvotes,
                       SUM(s.not_useful_count)::int AS total_not_useful,
                       COUNT(DISTINCT s.cluster_id)::int AS cluster_count
                FROM news_item_stats s
                JOIN news_clusters c ON c.id = s.cluster_id
                JOIN news_cluster_items nci ON nci.cluster_id = c.id AND nci.is_primary
                JOIN news_items_raw nir ON nir.id = nci.raw_item_id
                JOIN news_sources ns ON ns.id = nir.source_id
                WHERE c.published_at > now() - make_interval(days => $1)
                  AND c.region = $2
                GROUP BY ns.source_key
                """,
                lookback_days,
                region,
            )
            for row in source_rows:
                sk = str(row["source_key"])
                self._source_signals[sk] = _SourceSignal(
                    source_key=sk,
                    total_upvotes=int(row["total_upvotes"] or 0),
                    total_not_useful=int(row["total_not_useful"] or 0),
                    cluster_count=int(row["cluster_count"] or 0),
                )

            # --- Per-topic aggregate ---
            topic_map: Dict[str, _TopicSignal] = {}
            for cs in self._cluster_signals.values():
                for tag in cs.topic_tags:
                    t = tag.lower().strip()
                    if not t:
                        continue
                    if t not in topic_map:
                        topic_map[t] = _TopicSignal(topic=t)
                    topic_map[t].total_upvotes += cs.upvote_count
                    topic_map[t].total_not_useful += cs.not_useful_count
                    topic_map[t].cluster_count += 1
            self._topic_signals = topic_map

            self._loaded = True
            total_signals = sum(
                cs.upvote_count + cs.not_useful_count
                for cs in self._cluster_signals.values()
            )
            logger.info(
                "[signals] loaded %d cluster signals, %d sources, %d topics (%d total votes, region=%s)",
                len(self._cluster_signals),
                len(self._source_signals),
                len(self._topic_signals),
                total_signals,
                region,
            )
        except Exception as exc:
            logger.warning("[signals] failed to load signal data (tables may not exist): %s", exc)
            self._loaded = False

    def cluster_signal_score(self, cluster_id: str) -> float:
        """0-1 score from upvote/not_useful ratio for a specific cluster.

        Returns 0.0 if the cluster has no signal data (no penalty, no boost).
        """
        cs = self._cluster_signals.get(cluster_id)
        if not cs:
            return 0.0
        total = cs.upvote_count + cs.not_useful_count
        if total == 0:
            return 0.0
        return _wilson_lower(cs.upvote_count, total)

    def source_signal_quality(self, source_key: str) -> float:
        """0-1 score aggregating signal ratios for all clusters from this source.

        Returns 0.5 (neutral) if below minimum sample threshold.
        """
        ss = self._source_signals.get(source_key)
        if not ss or ss.cluster_count < MIN_SOURCE_CLUSTERS:
            return 0.5
        total = ss.total_upvotes + ss.total_not_useful
        if total == 0:
            return 0.5
        return _wilson_lower(ss.total_upvotes, total)

    def topic_signal_strength(self, topic: str) -> float:
        """0-1 score for how well a topic performs with users.

        Returns 0.5 (neutral) if below minimum sample threshold.
        """
        ts = self._topic_signals.get(topic.lower().strip())
        if not ts or ts.cluster_count < MIN_TOPIC_CLUSTERS:
            return 0.5
        total = ts.total_upvotes + ts.total_not_useful
        if total == 0:
            return 0.5
        return _wilson_lower(ts.total_upvotes, total)

    def has_negative_signal_pattern(
        self,
        *,
        primary_source_key: Optional[str] = None,
        topic_tags: Sequence[str] = (),
    ) -> bool:
        """Returns True if the source/topic combo historically gets overwhelmingly negative signals.

        Used to skip LLM enrichment for clearly low-value clusters.
        """
        if primary_source_key:
            sq = self.source_signal_quality(primary_source_key)
            if sq < 0.25:  # Source is overwhelmingly not-useful
                return True
        for topic in topic_tags:
            if self.topic_signal_strength(topic) < 0.20:  # Topic consistently rejected
                return True
        return False

    def get_source_adjustments(
        self,
    ) -> Dict[str, Dict[str, float]]:
        """Compute credibility_weight adjustments for all sources with sufficient data.

        Returns {source_key: {"quality": 0-1, "adjustment": -0.05..+0.05}}.
        """
        result: Dict[str, Dict[str, float]] = {}
        for sk, ss in self._source_signals.items():
            if ss.cluster_count < MIN_SOURCE_CLUSTERS:
                continue
            quality = self.source_signal_quality(sk)
            # quality is 0-1 from Wilson score; 0.5 = neutral
            adjustment = (quality - 0.5) * 0.10  # maps to [-0.05, +0.05]
            result[sk] = {"quality": round(quality, 4), "adjustment": round(adjustment, 4)}
        return result

    async def load_editorial_signals(
        self,
        conn: "asyncpg.Connection",
        *,
        lookback_days: int = 14,
        region: str = "global",
    ) -> int:
        """Inject admin editorial actions as amplified signals.

        Reject → 10 not_useful votes, Approve → 5 upvotes.
        Returns number of editorial actions loaded.
        """
        try:
            rows = await conn.fetch(
                """
                SELECT cluster_id::text, action, source_key,
                       (SELECT array_agg(t) FROM unnest(topic_tags) t) AS topic_tags
                FROM news_editorial_actions
                WHERE created_at > now() - make_interval(days => $1)
                  AND action IN ('reject', 'approve')
                  AND (region = $2 OR region = 'global')
                """,
                lookback_days,
                region,
            )
            count = 0
            for row in rows:
                cid = str(row["cluster_id"])
                action = row["action"]
                source_key = row["source_key"]
                tags = list(row["topic_tags"] or [])

                # Amplified cluster signal
                cs = self._cluster_signals.get(cid)
                if not cs:
                    cs = _ClusterSignal(cluster_id=cid, topic_tags=tags)
                    self._cluster_signals[cid] = cs

                if action == "reject":
                    cs.not_useful_count += 10
                elif action == "approve":
                    cs.upvote_count += 5

                # Amplified source signal
                if source_key:
                    ss = self._source_signals.get(source_key)
                    if not ss:
                        ss = _SourceSignal(source_key=source_key)
                        self._source_signals[source_key] = ss
                    if action == "reject":
                        ss.total_not_useful += 10
                    elif action == "approve":
                        ss.total_upvotes += 5
                    ss.cluster_count += 1

                # Amplified topic signals
                for tag in tags:
                    t = tag.lower().strip()
                    if not t:
                        continue
                    ts = self._topic_signals.get(t)
                    if not ts:
                        ts = _TopicSignal(topic=t)
                        self._topic_signals[t] = ts
                    if action == "reject":
                        ts.total_not_useful += 10
                    elif action == "approve":
                        ts.total_upvotes += 5
                    ts.cluster_count += 1

                count += 1

            if count:
                logger.info("[signals] injected %d editorial actions as amplified signals (region=%s)", count, region)
            return count
        except Exception as exc:
            logger.warning("[signals] failed to load editorial signals (table may not exist): %s", exc)
            return 0
