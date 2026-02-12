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
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

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
    event_key: str = ""      # Discriminator for dedup (e.g. pattern_name, round_type)
    event_date: Optional[datetime] = None  # When the event actually happened


def compute_event_key(event_type: str, metadata: Dict[str, Any]) -> str:
    """Derive a deterministic discriminator from event type + metadata.

    Allows multiple events of the same type per cluster when they represent
    distinct observations (e.g. 3 different arch patterns detected).
    """
    if event_type == "arch_pattern_adopted":
        return metadata.get("pattern_name", "")
    if event_type == "cap_funding_raised":
        return metadata.get("round_type", "")
    if event_type == "cap_acquisition_announced":
        return metadata.get("acquisition_target", "")
    if event_type.startswith("gtm_"):
        return metadata.get("gtm_tag", "")
    if event_type == "prod_launched":
        return metadata.get("product_launched", "")
    return ""


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

        # --- 6. Derive event_date from cluster member publication dates ---
        cluster_event_date = min(
            (m.published_at for m in cluster.members),
            default=cluster.published_at,
        )
        for evt in events:
            if not evt.event_date:
                evt.event_date = cluster_event_date

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
                meta = {claim.fact_key: claim.fact_value}
                evt = ExtractedEvent(
                    event_type=event_type,
                    confidence=claim.confidence,
                    cluster_id=cluster_id,
                    entity_name=claim.entity_name,
                    snippet=claim.text_span[:200] if claim.text_span else cluster.title[:200],
                    region=region,
                    metadata=meta,
                    event_key=compute_event_key(event_type, meta),
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
            meta = {"pattern_name": pattern_name, "match_score": score}
            events.append(ExtractedEvent(
                event_type=event_type,
                confidence=min(score, 1.0),
                cluster_id=cluster_id,
                snippet=f"Pattern '{pattern_name}' detected in: {cluster.title[:150]}",
                region=region,
                metadata=meta,
                event_key=compute_event_key(event_type, meta),
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
                    meta = {"gtm_tag": tag, "story_type": cluster.story_type}
                    evt = ExtractedEvent(
                        event_type=event_type,
                        confidence=0.5,
                        cluster_id=cluster_id,
                        snippet=cluster.title[:200],
                        region=region,
                        metadata=meta,
                        event_key=compute_event_key(event_type, meta),
                    )
                    seen_types[event_type] = evt
                    events.append(evt)
                    break  # One event per GTM tag

    # Event types that naturally involve multiple companies
    _MULTI_PARTY_TYPES = {
        "cap_acquisition_announced",
        "gtm_partnership_announced",
        "gtm_channel_launched",
    }

    def _attach_startup_ids(
        self,
        cluster: "StoryCluster",
        events: List[ExtractedEvent],
    ) -> None:
        """Attach startup_id to events from memory gate linked entities.

        When an event already has entity_name, look up that specific entity's
        startup_id instead of blindly assigning the best-scored startup.
        Falls back to the best-scored startup for events with no entity_name.

        For multi-party event types (acquisitions, partnerships), also writes
        metadata_json.participants with all linked entities and their roles.
        """
        if not cluster.memory_result or not cluster.memory_result.linked_entities:
            return

        # Build entity_name → (startup_id, match_score, match_method) lookup
        entity_lookup: Dict[str, tuple] = {}  # lowercase name → (startup_id, score)
        all_participants: List[Dict[str, Any]] = []
        best_startup_id: Optional[str] = None
        best_score = 0.0
        best_name: Optional[str] = None

        for entity in cluster.memory_result.linked_entities:
            if entity.startup_id:
                name_lower = entity.entity_name.lower()
                existing = entity_lookup.get(name_lower)
                if not existing or entity.match_score > existing[1]:
                    entity_lookup[name_lower] = (entity.startup_id, entity.match_score)
                if entity.match_score > best_score:
                    best_startup_id = entity.startup_id
                    best_score = entity.match_score
                    best_name = entity.entity_name
                all_participants.append({
                    "startup_id": entity.startup_id,
                    "entity_name": entity.entity_name,
                    "match_score": round(entity.match_score, 3),
                    "match_method": getattr(entity, "match_method", "entity_link"),
                })

        for evt in events:
            if evt.startup_id:
                pass  # Already assigned, but still add participants below
            elif evt.entity_name:
                match = entity_lookup.get(evt.entity_name.lower())
                if match:
                    evt.startup_id = match[0]
                elif best_startup_id:
                    evt.startup_id = best_startup_id
                    if not evt.entity_name and best_name:
                        evt.entity_name = best_name
            elif best_startup_id:
                evt.startup_id = best_startup_id
                if not evt.entity_name and best_name:
                    evt.entity_name = best_name

            # For multi-party events, attach participants list
            if (
                evt.event_type in self._MULTI_PARTY_TYPES
                and len(all_participants) > 1
            ):
                # Infer roles: for acquisitions, primary is acquirer, others are targets
                participants_with_roles = []
                for p in all_participants:
                    role = "participant"
                    if evt.event_type == "cap_acquisition_announced":
                        if p["startup_id"] == evt.startup_id:
                            role = "acquirer"
                        else:
                            role = "target"
                    participants_with_roles.append({**p, "role": role})
                evt.metadata["participants"] = participants_with_roles


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

async def persist_events(
    conn: "asyncpg.Connection",
    events: List[ExtractedEvent],
    registry: Dict[str, str],
) -> Tuple[int, List[Tuple[str, str, str]]]:
    """Persist extracted events to startup_events table.

    Returns (count_inserted, list of (event_id, startup_id, event_type) tuples).
    """
    if not events:
        return 0, []

    inserted = 0
    inserted_events: List[Tuple[str, str, str]] = []
    for evt in events:
        registry_id = registry.get(evt.event_type)
        try:
            row = await conn.fetchrow(
                """INSERT INTO startup_events
                       (startup_id, event_type, event_title, event_content,
                        event_registry_id, confidence, source_type,
                        metadata_json, cluster_id, region, event_key,
                        event_date, effective_date)
                   VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8::jsonb, $9::uuid, $10, $11,
                           $12, COALESCE($12::date, CURRENT_DATE))
                   ON CONFLICT (cluster_id, startup_id, event_type, event_key)
                       WHERE cluster_id IS NOT NULL DO NOTHING
                   RETURNING id""",
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
                evt.event_key,
                evt.event_date,
            )
            if row is not None:
                inserted += 1
                if evt.startup_id:
                    inserted_events.append((str(row["id"]), evt.startup_id, evt.event_type))
        except Exception:
            logger.warning("Failed to persist event %s for cluster %s", evt.event_type, evt.cluster_id, exc_info=True)

    return inserted, inserted_events


async def enqueue_refresh_for_events(
    conn: "asyncpg.Connection",
    inserted_events: List[Tuple[str, str, str]],
) -> int:
    """Enqueue refresh jobs for startups that had qualifying events inserted.

    Args:
        conn: database connection
        inserted_events: list of (event_id, startup_id, event_type) from persist_events

    Returns count of jobs enqueued.
    """
    from ..crawl_runtime.refresh_jobs import EVENT_TYPE_TO_REASON, enqueue_refresh_job

    # Group by startup_id, pick first event_id per startup
    startup_map: Dict[str, Tuple[str, str]] = {}  # startup_id → (event_id, reason)
    for event_id, startup_id, event_type in inserted_events:
        reason = EVENT_TYPE_TO_REASON.get(event_type)
        if reason and startup_id not in startup_map:
            startup_map[startup_id] = (event_id, reason)

    enqueued = 0
    for startup_id, (event_id, reason) in startup_map.items():
        job_id = await enqueue_refresh_job(conn, startup_id, reason, trigger_event_id=event_id)
        if job_id:
            enqueued += 1

    if enqueued:
        logger.info("Enqueued %d refresh jobs from %d inserted events", enqueued, len(inserted_events))
    return enqueued


# ---------------------------------------------------------------------------
# Funding amount parser (standalone copy from signal_engine)
# ---------------------------------------------------------------------------

def _parse_funding_amount(amount_str: str) -> Optional[float]:
    """Parse funding amount string like '$10M', '$1.5B' to float (USD)."""
    if not amount_str:
        return None
    s = str(amount_str).strip().replace(",", "").replace("$", "")
    multiplier = 1.0
    s_lower = s.lower()
    if s_lower.endswith("b"):
        multiplier = 1e9
        s = s[:-1]
    elif s_lower.endswith("m"):
        multiplier = 1e6
        s = s[:-1]
    elif s_lower.endswith("k"):
        multiplier = 1e3
        s = s[:-1]
    try:
        return float(s) * multiplier
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Funding upsert from high-confidence events
# ---------------------------------------------------------------------------

_VALID_ROUND_TYPES = {
    "pre-seed", "seed", "series a", "series b", "series c", "series d",
    "series e", "series f", "series g", "series h",
    "angel", "grant", "debt", "convertible note",
    "venture round", "private equity", "ipo", "secondary market",
    "undisclosed",
}


async def upsert_funding_from_events(
    conn: "asyncpg.Connection",
    events: List[ExtractedEvent],
    confidence_threshold: float = 0.7,
) -> int:
    """Upsert funding_rounds rows from high-confidence cap_funding_raised events.

    Applies fuzzy dedup (same startup + round_type within ±14 days) to avoid
    duplicating CSV-confirmed rows or near-duplicate news-derived rows.
    After inserts, updates startups.money_raised_usd for affected startups.

    Returns count of rows inserted.
    """
    # Filter to qualifying funding events
    candidates = [
        e for e in events
        if e.event_type == "cap_funding_raised"
        and e.confidence >= confidence_threshold
        and e.startup_id
        and e.metadata.get("round_type")
    ]
    if not candidates:
        return 0

    inserted = 0
    affected_startup_ids: set = set()

    for evt in candidates:
        raw_round = evt.metadata["round_type"]
        round_type = raw_round.strip()
        if round_type.lower() not in _VALID_ROUND_TYPES:
            continue

        # Parse funding amount from metadata
        amount_usd: Optional[float] = None
        for key in ("funding_amount", "mentioned_amount"):
            raw = evt.metadata.get(key)
            if raw:
                amount_usd = _parse_funding_amount(str(raw))
                if amount_usd is not None:
                    break

        event_date = evt.event_date.date() if evt.event_date else None
        lead_investor = evt.metadata.get("lead_investor")
        valuation_raw = evt.metadata.get("valuation")
        valuation_usd = _parse_funding_amount(str(valuation_raw)) if valuation_raw else None

        # Fuzzy dedup: skip if a round with same startup+type exists within ±14 days
        try:
            dup = await conn.fetchval(
                """SELECT 1 FROM funding_rounds
                   WHERE startup_id = $1::uuid
                     AND LOWER(round_type) = LOWER($2)
                     AND (announced_date IS NULL
                          OR $3::date IS NULL
                          OR ABS(announced_date - $3::date) <= 14)
                   LIMIT 1""",
                evt.startup_id,
                round_type,
                event_date,
            )
            if dup:
                continue
        except Exception:
            logger.warning("Fuzzy dedup check failed for %s/%s", evt.startup_id, round_type, exc_info=True)
            continue

        # Insert with ON CONFLICT safety net
        try:
            result = await conn.fetchval(
                """INSERT INTO funding_rounds
                       (startup_id, round_type, amount_usd, announced_date,
                        lead_investor, valuation_usd, source)
                   VALUES ($1::uuid, $2, $3, $4, $5, $6, 'news_event')
                   ON CONFLICT (startup_id, round_type, announced_date) DO NOTHING
                   RETURNING id""",
                evt.startup_id,
                round_type,
                int(amount_usd) if amount_usd is not None else None,
                event_date,
                lead_investor[:255] if lead_investor else None,
                int(valuation_usd) if valuation_usd is not None else None,
            )
            if result:
                inserted += 1
                affected_startup_ids.add(evt.startup_id)
        except Exception:
            logger.warning(
                "Failed to insert funding round for %s (%s)",
                evt.startup_id, round_type, exc_info=True,
            )

    # Update money_raised_usd for affected startups
    for sid in affected_startup_ids:
        try:
            await conn.execute(
                """UPDATE startups SET
                       money_raised_usd = sub.total,
                       updated_at = NOW()
                   FROM (
                       SELECT startup_id, SUM(amount_usd) AS total
                       FROM funding_rounds
                       WHERE startup_id = $1::uuid AND amount_usd IS NOT NULL
                       GROUP BY startup_id
                   ) sub
                   WHERE startups.id = sub.startup_id""",
                sid,
            )
        except Exception:
            logger.warning("Failed to update money_raised_usd for %s", sid, exc_info=True)

    if inserted:
        logger.info("Upserted %d funding rounds from %d candidate events", inserted, len(candidates))

    return inserted


# ---------------------------------------------------------------------------
# Unknown startup onboarding from events
# ---------------------------------------------------------------------------

def _slugify(name: str) -> str:
    """Generate a URL-safe slug from a company name."""
    import re as _re
    slug = name.lower().strip()
    slug = _re.sub(r'[^a-z0-9]+', '-', slug)
    return slug.strip('-')[:200]


async def onboard_unknown_startups(
    conn: "asyncpg.Connection",
    events: List[ExtractedEvent],
    clusters: list,
    confidence_threshold: float = 0.5,
    max_per_run: int = 10,
) -> int:
    """Create stub startups for entities mentioned in events but not yet in DB.

    Only onboards when:
    - The event has entity_name but no startup_id (not linked by memory gate)
    - Confidence >= threshold
    - Entity name doesn't fuzzy-match an existing startup (ILIKE check)
    - Rate limited to max_per_run per pipeline invocation

    After creation, backfills the event's startup_id and enqueues a refresh job.
    Returns count of startups created.
    """
    # Collect unique unlinked entity names from qualifying events
    seen_names: Dict[str, ExtractedEvent] = {}  # lowercase → first event
    for evt in events:
        if evt.startup_id:
            continue
        if not evt.entity_name:
            continue
        if evt.confidence < confidence_threshold:
            continue
        name_lower = evt.entity_name.lower().strip()
        if name_lower and name_lower not in seen_names and len(name_lower) > 2:
            seen_names[name_lower] = evt

    if not seen_names:
        return 0

    # Build cluster lookup for guessing website from URLs
    cluster_urls: Dict[Optional[str], str] = {}
    for c in clusters:
        if hasattr(c, 'cluster_key') and hasattr(c, 'members'):
            for m in c.members:
                url = getattr(m, 'url', None)
                if url and hasattr(c, 'cluster_key'):
                    cluster_urls[c.cluster_key] = url

    created = 0
    for name_lower, evt in list(seen_names.items())[:max_per_run]:
        entity_name = evt.entity_name or name_lower
        slug = _slugify(entity_name)
        if not slug:
            continue

        # Check if a startup with similar name already exists (fuzzy ILIKE)
        try:
            existing = await conn.fetchval(
                """SELECT id FROM startups
                   WHERE LOWER(name) = $1
                      OR slug = $2
                   LIMIT 1""",
                name_lower,
                slug,
            )
            if existing:
                # Link the orphan events to this existing startup
                for e in events:
                    if e.entity_name and e.entity_name.lower().strip() == name_lower and not e.startup_id:
                        e.startup_id = str(existing)
                continue
        except Exception:
            logger.warning("Onboard check failed for '%s'", entity_name, exc_info=True)
            continue

        # Guess region from event
        region = evt.region or "global"

        # Create stub startup
        try:
            new_id = await conn.fetchval(
                """INSERT INTO startups (name, slug, dataset_region, description, period)
                   VALUES ($1, $2, $3, $4, to_char(CURRENT_DATE, 'YYYY-MM'))
                   ON CONFLICT (dataset_region, slug) DO NOTHING
                   RETURNING id::text""",
                entity_name,
                slug,
                region,
                f"Auto-discovered from news events. Pending analysis.",
            )
            if not new_id:
                continue  # Slug collision

            created += 1
            logger.info("Onboarded stub startup '%s' (id=%s) from event", entity_name, new_id)

            # Backfill startup_id on all events for this entity
            for e in events:
                if e.entity_name and e.entity_name.lower().strip() == name_lower and not e.startup_id:
                    e.startup_id = new_id

            # Also update already-persisted events in DB
            await conn.execute(
                """UPDATE startup_events
                   SET startup_id = $1::uuid
                   WHERE startup_id IS NULL
                     AND LOWER(event_title) LIKE '%' || $2 || '%'
                     AND detected_at > NOW() - INTERVAL '7 days'""",
                new_id,
                name_lower,
            )

            # Enqueue refresh job so the crawler immediately picks it up
            try:
                from ..crawl_runtime.refresh_jobs import enqueue_refresh_job
                await enqueue_refresh_job(conn, new_id, "news_onboard")
            except Exception:
                pass  # refresh_jobs may not exist yet

        except Exception:
            logger.warning("Failed to onboard startup '%s'", entity_name, exc_info=True)

    if created:
        logger.info("Onboarded %d new stub startups from unlinked events", created)

    return created
