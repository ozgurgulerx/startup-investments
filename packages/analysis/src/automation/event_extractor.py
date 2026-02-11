"""Structured event extraction from news pipeline outputs.

Converts memory gate outputs (claims, patterns, GTM tags, linked entities)
into structured startup_events with event_registry linkage.

Heuristic-first: reuses FactExtractor claims, PatternMatcher matches, and
GTMClassifier tags already computed by the pipeline. Zero LLM cost.

Integration point: called in news_ingest.py after _persist_gating_decisions(),
before embedding. Follows the global-then-turkey pattern.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    import asyncpg
    from .news_ingest import StoryCluster

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class ExtractedEvent:
    """A structured event extracted from a news cluster."""
    event_type: str          # Must match event_registry.event_type
    confidence: float        # 0.0 - 1.0
    source_type: str = "news"
    startup_id: Optional[str] = None
    entity_name: Optional[str] = None
    cluster_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    snippet: str = ""
    region: str = "global"


# ---------------------------------------------------------------------------
# Claim fact_key → event_type mapping
# ---------------------------------------------------------------------------

_CLAIM_TO_EVENT: Dict[str, str] = {
    "funding_amount": "cap_funding_raised",
    "round_type": "cap_funding_raised",         # Enriches the same event
    "lead_investor": "cap_funding_raised",       # Enriches the same event
    "valuation": "cap_funding_raised",           # Enriches the same event
    "mentioned_amount": "cap_funding_raised",    # Likely funding context
    "acquisition_target": "cap_acquisition_announced",
    "deal_value": "cap_acquisition_announced",   # Enriches M&A event
    "product_launched": "prod_launched",
}

# story_type → event_type fallback mapping (when no claims match)
_STORY_TYPE_TO_EVENT: Dict[str, str] = {
    "funding": "cap_funding_raised",
    "mna": "cap_acquisition_announced",
    "launch": "prod_launched",
    "hiring": "org_key_hire",
    "product": "prod_major_update",
}

# GTM tag patterns → event_type mappings
_GTM_EVENT_PATTERNS: Dict[str, str] = {
    "open-source-core": "gtm_open_source_strategy",
    "marketplace": "gtm_channel_launched",
    "enterprise": "gtm_enterprise_tier_launched",
    "vertical-saas": "gtm_vertical_expansion",
}


# ---------------------------------------------------------------------------
# EventExtractor
# ---------------------------------------------------------------------------

class EventExtractor:
    """Extract structured events from StoryCluster pipeline outputs.

    Loads event_registry from DB into memory, then converts each cluster's
    memory gate results + gating results into typed events.
    """

    def __init__(self) -> None:
        self._registry: Dict[str, str] = {}   # event_type → registry_id
        self._valid_types: set = set()
        self._loaded = False

    async def load(self, conn: "asyncpg.Connection") -> None:
        """Load active event types from event_registry."""
        rows = await conn.fetch(
            "SELECT id::text, event_type FROM event_registry WHERE active = TRUE"
        )
        self._registry = {row["event_type"]: row["id"] for row in rows}
        self._valid_types = set(self._registry.keys())
        self._loaded = True
        logger.info("EventExtractor loaded %d active event types", len(self._registry))

    def _is_valid(self, event_type: str) -> bool:
        return event_type in self._valid_types

    def extract_from_cluster(
        self,
        cluster: "StoryCluster",
        cluster_id: Optional[str],
        region: str = "global",
    ) -> List[ExtractedEvent]:
        """Extract structured events from a single cluster's pipeline outputs.

        Consumes:
        - cluster.memory_result (MemoryResult): linked_entities, extracted_claims
        - cluster.gating_patterns (List[Tuple[str, float]]): matched build patterns
        - cluster.gating_gtm_tags (List[str]): GTM classification tags
        - cluster.story_type (str): cluster story type
        """
        events: List[ExtractedEvent] = []
        seen_types: Dict[str, ExtractedEvent] = {}  # Dedup by event_type per cluster

        # --- 1. Extract from FactExtractor claims ---
        if cluster.memory_result and cluster.memory_result.extracted_claims:
            self._extract_from_claims(cluster, cluster_id, region, events, seen_types)

        # --- 2. Extract from PatternMatcher matches ---
        if cluster.gating_patterns:
            self._extract_from_patterns(cluster, cluster_id, region, events)

        # --- 3. Extract from GTM tags ---
        if cluster.gating_gtm_tags and cluster.story_type in ("launch", "product", "news"):
            self._extract_from_gtm(cluster, cluster_id, region, events, seen_types)

        # --- 4. Fallback: story_type when no events extracted ---
        if not events and cluster.story_type in _STORY_TYPE_TO_EVENT:
            event_type = _STORY_TYPE_TO_EVENT[cluster.story_type]
            if self._is_valid(event_type):
                events.append(ExtractedEvent(
                    event_type=event_type,
                    confidence=0.4,  # Low confidence for story-type-only
                    cluster_id=cluster_id,
                    snippet=cluster.title[:200],
                    region=region,
                    metadata={"source": "story_type_fallback", "story_type": cluster.story_type},
                ))

        # --- 5. Attach startup_id from linked entities ---
        self._attach_startup_ids(cluster, events)

        return events

    def _extract_from_claims(
        self,
        cluster: "StoryCluster",
        cluster_id: Optional[str],
        region: str,
        events: List[ExtractedEvent],
        seen_types: Dict[str, ExtractedEvent],
    ) -> None:
        """Convert FactExtractor claims into events."""
        memory = cluster.memory_result
        if not memory:
            return

        # Group claims by target event type to consolidate
        for claim in memory.extracted_claims:
            event_type = _CLAIM_TO_EVENT.get(claim.fact_key)
            if not event_type or not self._is_valid(event_type):
                continue

            if event_type in seen_types:
                # Enrich existing event with additional metadata
                existing = seen_types[event_type]
                existing.metadata[claim.fact_key] = claim.fact_value
                existing.confidence = max(existing.confidence, claim.confidence)
            else:
                evt = ExtractedEvent(
                    event_type=event_type,
                    confidence=claim.confidence,
                    cluster_id=cluster_id,
                    entity_name=claim.entity_name,
                    snippet=claim.text_span[:200] if claim.text_span else cluster.title[:200],
                    region=region,
                    metadata={claim.fact_key: claim.fact_value},
                )
                seen_types[event_type] = evt
                events.append(evt)

    def _extract_from_patterns(
        self,
        cluster: "StoryCluster",
        cluster_id: Optional[str],
        region: str,
        events: List[ExtractedEvent],
    ) -> None:
        """Convert PatternMatcher matches into arch_pattern_adopted events."""
        event_type = "arch_pattern_adopted"
        if not self._is_valid(event_type):
            return

        for pattern_name, score in (cluster.gating_patterns or []):
            if score < 0.3:
                continue
            if not pattern_name or pattern_name.lower() in ('unknown', 'unknown_pattern', 'none'):
                continue
            events.append(ExtractedEvent(
                event_type=event_type,
                confidence=min(score, 1.0),
                cluster_id=cluster_id,
                snippet=f"Pattern '{pattern_name}' detected in: {cluster.title[:150]}",
                region=region,
                metadata={"pattern_name": pattern_name, "match_score": score},
            ))

    def _extract_from_gtm(
        self,
        cluster: "StoryCluster",
        cluster_id: Optional[str],
        region: str,
        events: List[ExtractedEvent],
        seen_types: Dict[str, ExtractedEvent],
    ) -> None:
        """Convert GTM tags into gtm_* events when combined with relevant story types."""
        for tag in (cluster.gating_gtm_tags or []):
            for pattern_key, event_type in _GTM_EVENT_PATTERNS.items():
                if pattern_key in tag and self._is_valid(event_type) and event_type not in seen_types:
                    evt = ExtractedEvent(
                        event_type=event_type,
                        confidence=0.5,
                        cluster_id=cluster_id,
                        snippet=cluster.title[:200],
                        region=region,
                        metadata={"gtm_tag": tag, "story_type": cluster.story_type},
                    )
                    seen_types[event_type] = evt
                    events.append(evt)
                    break  # One event per GTM tag

    def _attach_startup_ids(
        self,
        cluster: "StoryCluster",
        events: List[ExtractedEvent],
    ) -> None:
        """Attach startup_id to events from memory gate linked entities."""
        if not cluster.memory_result or not cluster.memory_result.linked_entities:
            return

        # Find the best-matched startup entity
        best_startup_id: Optional[str] = None
        best_score = 0.0
        best_name: Optional[str] = None

        for entity in cluster.memory_result.linked_entities:
            if entity.startup_id and entity.match_score > best_score:
                best_startup_id = entity.startup_id
                best_score = entity.match_score
                best_name = entity.entity_name

        if best_startup_id:
            for evt in events:
                if not evt.startup_id:
                    evt.startup_id = best_startup_id
                if not evt.entity_name and best_name:
                    evt.entity_name = best_name


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

async def persist_events(
    conn: "asyncpg.Connection",
    events: List[ExtractedEvent],
    registry: Dict[str, str],
) -> int:
    """Persist extracted events to startup_events table. Returns count inserted."""
    if not events:
        return 0

    inserted = 0
    for evt in events:
        registry_id = registry.get(evt.event_type)
        try:
            await conn.execute(
                """INSERT INTO startup_events
                       (startup_id, event_type, event_title, event_content,
                        event_registry_id, confidence, source_type,
                        metadata_json, cluster_id, region)
                   VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8::jsonb, $9::uuid, $10)
                   ON CONFLICT (cluster_id, event_type, startup_id)
                       WHERE cluster_id IS NOT NULL DO NOTHING""",
                evt.startup_id,
                evt.event_type,
                evt.snippet[:255] if evt.snippet else None,
                evt.snippet,
                registry_id,
                evt.confidence,
                evt.source_type,
                json.dumps(evt.metadata),
                evt.cluster_id,
                evt.region,
            )
            inserted += 1
        except Exception:
            logger.warning("Failed to persist event %s for cluster %s", evt.event_type, evt.cluster_id, exc_info=True)

    return inserted
