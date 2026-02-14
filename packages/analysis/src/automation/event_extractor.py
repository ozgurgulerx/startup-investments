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
import os
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse
from .onboarding_trace import emit_trace

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
            # Stash cluster_key so downstream (e.g. onboarding) can look up source stats
            if hasattr(cluster, "cluster_key") and cluster.cluster_key:
                evt.metadata["cluster_key"] = cluster.cluster_key

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

        # Build entity_name → (startup_id, score, entity_type) lookup
        entity_lookup: Dict[str, tuple] = {}  # lowercase name → (startup_id, score, entity_type)
        all_participants: List[Dict[str, Any]] = []
        best_startup_id: Optional[str] = None
        best_score = 0.0
        best_name: Optional[str] = None
        best_entity_type: Optional[str] = None

        for entity in cluster.memory_result.linked_entities:
            etype = getattr(entity, "entity_type", None)
            if entity.startup_id:
                name_lower = entity.entity_name.lower()
                existing = entity_lookup.get(name_lower)
                if not existing or entity.match_score > existing[1]:
                    entity_lookup[name_lower] = (entity.startup_id, entity.match_score, etype)
                if entity.match_score > best_score:
                    best_startup_id = entity.startup_id
                    best_score = entity.match_score
                    best_name = entity.entity_name
                    best_entity_type = etype
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
                    evt.metadata["entity_type"] = match[2]  # from entity_lookup
                elif best_startup_id:
                    evt.startup_id = best_startup_id
                    evt.metadata["entity_type"] = best_entity_type
                    if not evt.entity_name and best_name:
                        evt.entity_name = best_name
            elif best_startup_id:
                evt.startup_id = best_startup_id
                evt.metadata["entity_type"] = best_entity_type
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

        event_date = evt.event_date
        # Avoid asyncpg AmbiguousParameterError by:
        # - normalizing event_date to a tz-aware datetime (timestamptz)
        # - passing effective_date as a separate $n parameter (date)
        effective_date: date
        if isinstance(event_date, date) and not isinstance(event_date, datetime):
            effective_date = event_date
            event_date = datetime.combine(event_date, datetime.min.time(), tzinfo=timezone.utc)
        elif isinstance(event_date, datetime):
            if event_date.tzinfo is None:
                event_date = event_date.replace(tzinfo=timezone.utc)
            else:
                event_date = event_date.astimezone(timezone.utc)
            effective_date = event_date.date()
        else:
            effective_date = datetime.now(timezone.utc).date()

        try:
            row = await conn.fetchrow(
                """INSERT INTO startup_events
                       (startup_id, event_type, event_title, event_content,
                        event_registry_id, confidence, source_type,
                        metadata_json, cluster_id, region, event_key,
                        event_date, effective_date)
                   VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8::jsonb, $9::uuid, $10, $11,
                           $12::timestamptz, $13::date)
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
                event_date,
                effective_date,
            )
            if row is not None:
                inserted += 1
                if evt.startup_id:
                    inserted_events.append((str(row["id"]), evt.startup_id, evt.event_type))
        except Exception:
            logger.warning(
                "Failed to persist event %s for cluster %s",
                evt.event_type,
                evt.cluster_id,
                exc_info=True,
            )

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
# Capital graph sync from extracted news events
# ---------------------------------------------------------------------------

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


def _normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _split_investor_names(raw: str) -> List[str]:
    """Split a lead-investor string into one or more investor names."""
    cleaned = _normalize_space(raw)
    if not cleaned:
        return []

    # Drop common trailing clauses that aren't part of investor names.
    cleaned = re.sub(
        r"\b(?:with participation from|with participation by|katılımıyla|katilimiyla)\b.*$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip(" ,.;")
    if not cleaned:
        return []

    parts = _INVESTOR_SPLIT_RE.split(cleaned)
    names: List[str] = []
    seen: set = set()
    for part in parts:
        name = _normalize_space(part).strip(" ,.;")
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


def _event_graph_attrs(evt: ExtractedEvent) -> Dict[str, Any]:
    attrs: Dict[str, Any] = {
        "event_type": evt.event_type,
        "round_type": evt.metadata.get("round_type"),
        "funding_amount": evt.metadata.get("funding_amount"),
        "valuation": evt.metadata.get("valuation"),
        "cluster_id": evt.cluster_id,
        "cluster_key": evt.metadata.get("cluster_key"),
        "event_date": evt.event_date.isoformat() if evt.event_date else None,
        "snippet": (evt.snippet or "")[:280],
    }
    return {k: v for k, v in attrs.items() if v not in (None, "", [], {})}


async def _capital_graph_tables_ready(conn: "asyncpg.Connection") -> Tuple[bool, bool]:
    """Return (graph_ready, investor_aliases_ready)."""
    row = await conn.fetchrow(
        """
        SELECT
          to_regclass('public.capital_graph_edges') IS NOT NULL AS has_graph_edges,
          to_regclass('public.investors') IS NOT NULL AS has_investors,
          to_regclass('public.investor_aliases') IS NOT NULL AS has_investor_aliases
        """
    )
    graph_ready = bool(row and row["has_graph_edges"] and row["has_investors"])
    aliases_ready = bool(row and row["has_investor_aliases"])
    return graph_ready, aliases_ready


async def _resolve_or_create_investor_id(
    conn: "asyncpg.Connection",
    *,
    investor_name: str,
    region: str,
    aliases_ready: bool,
) -> Tuple[Optional[str], bool]:
    """Resolve investor by name/alias; create if missing. Returns (id, created_now)."""
    clean_name = _normalize_space(investor_name)
    if not clean_name:
        return None, False
    name_norm = clean_name.lower()

    if aliases_ready:
        row = await conn.fetchrow(
            """
            SELECT i.id::text AS id
            FROM investors i
            LEFT JOIN investor_aliases ia ON ia.investor_id = i.id
            WHERE lower(regexp_replace(trim(i.name), '\\s+', ' ', 'g')) = $1
               OR lower(regexp_replace(trim(COALESCE(ia.alias, '')), '\\s+', ' ', 'g')) = $1
            ORDER BY i.created_at ASC
            LIMIT 1
            """,
            name_norm,
        )
    else:
        row = await conn.fetchrow(
            """
            SELECT id::text AS id
            FROM investors
            WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $1
            ORDER BY created_at ASC
            LIMIT 1
            """,
            name_norm,
        )
    if row:
        return str(row["id"]), False

    hq_country = "Turkey" if (region or "global") == "turkey" else None
    inserted = await conn.fetchrow(
        """
        INSERT INTO investors (name, type, headquarters_country)
        VALUES ($1, 'unknown', $2)
        ON CONFLICT (name)
        DO UPDATE SET
          type = COALESCE(investors.type, EXCLUDED.type),
          headquarters_country = COALESCE(investors.headquarters_country, EXCLUDED.headquarters_country)
        RETURNING id::text AS id
        """,
        clean_name,
        hq_country,
    )
    if inserted:
        return str(inserted["id"]), True

    # Fallback for race or case-variant duplicates.
    existing = await conn.fetchrow(
        """
        SELECT id::text AS id
        FROM investors
        WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $1
        ORDER BY created_at ASC
        LIMIT 1
        """,
        name_norm,
    )
    return (str(existing["id"]), False) if existing else (None, False)


async def _upsert_investor_alias(
    conn: "asyncpg.Connection",
    *,
    investor_id: str,
    raw_name: str,
    canonical_name: str,
    confidence: float,
    aliases_ready: bool,
) -> None:
    if not aliases_ready:
        return
    alias = _normalize_space(raw_name)
    if not alias:
        return
    if alias.lower() == _normalize_space(canonical_name).lower():
        return
    await conn.execute(
        """
        INSERT INTO investor_aliases (investor_id, alias, alias_type, source, confidence)
        VALUES ($1::uuid, $2, 'news_mention', 'news_event', $3)
        ON CONFLICT ((lower(regexp_replace(trim(alias), '\\s+', ' ', 'g'))))
        DO UPDATE SET
          investor_id = EXCLUDED.investor_id,
          source = EXCLUDED.source,
          confidence = GREATEST(COALESCE(investor_aliases.confidence, 0), COALESCE(EXCLUDED.confidence, 0))
        """,
        investor_id,
        alias,
        max(0.0, min(1.0, float(confidence or 0.0))),
    )


async def upsert_capital_graph_from_events(
    conn: "asyncpg.Connection",
    events: List[ExtractedEvent],
    confidence_threshold: float = 0.65,
) -> Dict[str, int]:
    """Write investor->startup funding edges into capital_graph_edges from news events."""
    stats: Dict[str, int] = {
        "events_considered": 0,
        "investors_created": 0,
        "investors_enqueued": 0,
        "edges_upserted": 0,
        "skipped": 0,
    }
    if not events:
        return stats

    try:
        graph_ready, aliases_ready = await _capital_graph_tables_ready(conn)
    except Exception:
        logger.warning("capital graph table check failed", exc_info=True)
        return stats

    if not graph_ready:
        return stats

    def _env_bool(name: str, default: bool = False) -> bool:
        raw = str(os.getenv(name, "") or "").strip().lower()
        if not raw:
            return default
        return raw in {"1", "true", "yes", "on"}

    enqueue_enabled = _env_bool("INVESTOR_ONBOARDING_ENQUEUE_ENABLED", False)
    onboarding_queue_ready = False
    if enqueue_enabled:
        try:
            onboarding_queue_ready = bool(
                await conn.fetchval(
                    "SELECT to_regclass('public.investor_onboarding_queue') IS NOT NULL"
                )
            )
        except Exception:
            onboarding_queue_ready = False

    investor_cache: Dict[str, str] = {}
    enqueued_investor_ids: set[str] = set()
    for evt in events:
        if evt.event_type != "cap_funding_raised":
            continue
        if evt.confidence < confidence_threshold:
            continue
        if not evt.startup_id:
            stats["skipped"] += 1
            continue

        stats["events_considered"] += 1
        lead_raw = _normalize_space(str(evt.metadata.get("lead_investor") or ""))
        if not lead_raw:
            stats["skipped"] += 1
            continue

        investor_names = _split_investor_names(lead_raw)
        if not investor_names:
            stats["skipped"] += 1
            continue

        for investor_name in investor_names:
            norm_key = investor_name.lower()
            investor_id = investor_cache.get(norm_key)
            created_now = False
            if not investor_id:
                try:
                    investor_id, created_now = await _resolve_or_create_investor_id(
                        conn,
                        investor_name=investor_name,
                        region=evt.region or "global",
                        aliases_ready=aliases_ready,
                    )
                except Exception:
                    logger.warning("Failed to resolve/create investor '%s'", investor_name, exc_info=True)
                    stats["skipped"] += 1
                    continue
                if not investor_id:
                    stats["skipped"] += 1
                    continue
                investor_cache[norm_key] = investor_id
                if created_now:
                    stats["investors_created"] += 1

            # Best-effort investor onboarding enqueue for newly discovered or under-specified investors.
            if (
                enqueue_enabled
                and onboarding_queue_ready
                and investor_id
                and investor_id not in enqueued_investor_ids
            ):
                try:
                    inv_row = await conn.fetchrow(
                        "SELECT website, type FROM investors WHERE id = $1::uuid",
                        investor_id,
                    )
                    inv_website = str((inv_row or {}).get("website") or "").strip() if inv_row else ""
                    inv_type = str((inv_row or {}).get("type") or "").strip().lower() if inv_row else ""
                    type_unknown = (not inv_type) or inv_type in {"unknown", "n/a", "na"}
                    missing_profile = (not inv_website) or type_unknown
                    should_enqueue = bool(created_now or missing_profile)
                    if should_enqueue:
                        reason = "news_lead_investor_created" if created_now else "news_lead_investor_missing_profile"
                        priority = 3 if created_now else 6
                        await conn.execute(
                            """
                            INSERT INTO investor_onboarding_queue (
                                investor_id, priority, reason, seed_cluster_id, seed_urls
                            )
                            VALUES ($1::uuid, $2, $3, $4::uuid, $5::text[])
                            ON CONFLICT DO NOTHING
                            """,
                            investor_id,
                            priority,
                            reason,
                            evt.cluster_id,
                            [],
                        )
                        enqueued_investor_ids.add(investor_id)
                        stats["investors_enqueued"] += 1
                        await emit_trace(
                            conn,
                            startup_id=None,
                            investor_id=investor_id,
                            queue_item_id=None,
                            investor_queue_item_id=None,
                            trace_type="investor_onboarding",
                            stage="investor_enqueued",
                            status="success",
                            severity="info",
                            reason_code=reason,
                            message="Investor enqueued for onboarding enrichment",
                            payload={
                                "investor_id": investor_id,
                                "created_now": bool(created_now),
                                "region": evt.region or "global",
                                "cluster_id": evt.cluster_id,
                            },
                            dedupe_key=f"investor_onboarding_enqueued:{investor_id}:{reason}",
                            should_notify=False,
                        )
                except Exception:
                    # Enqueue is best-effort; do not block graph writes.
                    pass

            try:
                await _upsert_investor_alias(
                    conn,
                    investor_id=investor_id,
                    raw_name=lead_raw,
                    canonical_name=investor_name,
                    confidence=evt.confidence,
                    aliases_ready=aliases_ready,
                )
            except Exception:
                # Alias writes are best-effort.
                logger.debug("Failed to upsert investor alias '%s'", lead_raw, exc_info=True)

            attrs = _event_graph_attrs(evt)
            valid_from = evt.event_date.date() if evt.event_date else date.today()
            source_ref = evt.cluster_id or str(evt.metadata.get("cluster_key") or "") or None

            try:
                await conn.execute(
                    """
                    INSERT INTO capital_graph_edges (
                        src_type, src_id, edge_type, dst_type, dst_id, region,
                        attrs_json, source, source_ref, confidence, created_by,
                        valid_from, valid_to
                    )
                    VALUES (
                        'investor', $1::uuid, 'LEADS_ROUND', 'startup', $2::uuid, $3,
                        $4::jsonb, 'news_event', $5, $6, 'news_ingest',
                        $7::date, $8::date
                    )
                    ON CONFLICT (src_type, src_id, edge_type, dst_type, dst_id, region, valid_from, valid_to)
                    DO UPDATE SET
                      attrs_json = capital_graph_edges.attrs_json || EXCLUDED.attrs_json,
                      source = EXCLUDED.source,
                      source_ref = COALESCE(EXCLUDED.source_ref, capital_graph_edges.source_ref),
                      confidence = GREATEST(COALESCE(capital_graph_edges.confidence, 0), COALESCE(EXCLUDED.confidence, 0)),
                      created_by = COALESCE(EXCLUDED.created_by, capital_graph_edges.created_by),
                      updated_at = NOW()
                    """,
                    investor_id,
                    evt.startup_id,
                    evt.region or "global",
                    json.dumps(attrs),
                    source_ref,
                    max(0.0, min(1.0, float(evt.confidence))),
                    valid_from,
                    _GRAPH_ACTIVE_VALID_TO,
                )
                stats["edges_upserted"] += 1
                await emit_trace(
                    conn,
                    startup_id=evt.startup_id,
                    queue_item_id=None,
                    trace_type="graph",
                    stage="graph_edge_upserted",
                    status="info",
                    severity="info",
                    reason_code="cap_funding_raised",
                    message=f"Investor edge upserted for startup {evt.startup_id}",
                    payload={
                        "investor_id": investor_id,
                        "event_type": evt.event_type,
                        "region": evt.region or "global",
                        "valid_from": str(valid_from),
                        "lead_investor_raw": lead_raw,
                    },
                    dedupe_key=f"graph_edge_upserted:{investor_id}:{evt.startup_id}:{valid_from}",
                    should_notify=False,
                )
            except Exception:
                logger.warning(
                    "Failed to upsert capital graph edge investor=%s startup=%s",
                    investor_id,
                    evt.startup_id,
                    exc_info=True,
                )
                stats["skipped"] += 1

    if stats["edges_upserted"]:
        logger.info(
            "Capital graph sync from events: edges=%d investors_created=%d considered=%d",
            stats["edges_upserted"],
            stats["investors_created"],
            stats["events_considered"],
        )
    return stats


# ---------------------------------------------------------------------------
# Unknown startup onboarding from events
# ---------------------------------------------------------------------------

def _slugify(name: str) -> str:
    """Generate a URL-safe slug from a company name."""
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    return slug.strip('-')[:200]


# ---------------------------------------------------------------------------
# Multi-source confirmation helpers
# ---------------------------------------------------------------------------

# Common two-level domains where the registrable domain includes the second level
_COMMON_2LD = {"co.uk", "com.au", "co.jp", "co.kr", "com.br", "co.nz",
               "co.za", "com.tr", "co.in", "com.mx", "com.cn", "co.il"}


def _publisher_domain(url: str) -> str:
    """Normalize URL to registrable domain (e.g. 'bbc.co.uk', 'techcrunch.com').

    Handles common two-level TLDs. Returns empty string on failure.
    """
    try:
        host = urlparse(url).hostname or ""
        host = host.lower().removeprefix("www.")
        parts = host.split(".")
        if len(parts) >= 3:
            two_level = ".".join(parts[-2:])
            if two_level in _COMMON_2LD:
                return ".".join(parts[-3:])
        return ".".join(parts[-2:]) if len(parts) >= 2 else host
    except Exception:
        return ""


def cluster_source_stats(cluster: "StoryCluster") -> Dict[str, Any]:
    """Compute source diversity stats for a cluster.

    Returns dict with:
      - source_keys: set of distinct source_key values
      - publisher_domains: set of distinct publisher domains
      - multi_source_confirmed: True if >= 2 distinct publishers OR >= 2 distinct source_keys
    """
    source_keys: set = set()
    publisher_domains: set = set()

    for member in getattr(cluster, "members", []):
        sk = getattr(member, "source_key", None)
        if sk:
            source_keys.add(sk)
        url = getattr(member, "url", None)
        if url:
            dom = _publisher_domain(url)
            if dom:
                publisher_domains.add(dom)

    multi = len(publisher_domains) >= 2 or len(source_keys) >= 2
    return {
        "source_keys": source_keys,
        "publisher_domains": publisher_domains,
        "multi_source_confirmed": multi,
    }


# ---------------------------------------------------------------------------
# Entity name denylist for onboarding quality gates
# ---------------------------------------------------------------------------

_ONBOARD_DENYLIST = {
    "ai", "ml", "labs", "tech", "data", "cloud", "api",
    "saas", "the", "new", "app", "inc", "llc", "ltd",
    "fund", "capital", "ventures", "partners", "group",
    "association", "foundation", "institute", "university",
    "google", "microsoft", "amazon", "apple", "meta",
    "openai", "anthropic", "nvidia",  # big tech, not stubs
}

_ONBOARD_DENY_PATTERNS = [
    re.compile(r'^[A-Z]{1,4}$'),           # ALL-CAPS <= 4 chars (acronyms)
    re.compile(r'^\d'),                      # starts with digit
    re.compile(r'^(the|a|an)\s', re.I),     # articles
]

_ONBOARD_DOMAIN_DENYLIST = {
    # News/media/community domains that should never become startup websites.
    "techcrunch.com", "venturebeat.com", "wired.com", "sifted.eu", "crunchbase.com",
    "webrazzi.com", "egirisim.com", "news.ycombinator.com", "hnrss.org", "reddit.com",
    "lobste.rs", "producthunt.com", "entrepreneur.com", "inc.com", "fastcompany.com",
    "tech.eu", "mashable.com", "hackernoon.com", "ycombinator.com", "strictlyvc.com",
    "prnewswire.com", "businesswire.com", "dev.to", "huggingface.co", "github.com",
    "amazon.com",
}


def _root_domain_label(domain: str) -> str:
    """Return the left-most registrable domain label (e.g. acme from acme.ai)."""
    if not domain:
        return ""
    return domain.split(".")[0].strip().lower()


def _tokenize_slug(slug: str) -> List[str]:
    return [t for t in slug.split("-") if len(t) >= 3]


def _infer_startup_website(entity_name: str, cluster: Optional["StoryCluster"]) -> Optional[str]:
    """Infer a likely startup website from cluster member URLs.

    Heuristic:
    - Skip known publisher/community domains.
    - Prefer explicit startup-owned payload hints.
    - Else match domain label with entity slug/tokens.
    """
    if not cluster:
        return None

    entity_slug = _slugify(entity_name)
    if not entity_slug:
        return None
    slug_tokens = _tokenize_slug(entity_slug)

    for member in getattr(cluster, "members", []) or []:
        source_key = str(getattr(member, "source_key", "") or "")
        payload = getattr(member, "payload", None) or {}

        # Strong hint from startup-owned feeds where payload includes startup slug.
        payload_slug = str(payload.get("startup_slug") or "").strip().lower()
        if source_key == "startup_owned_feeds" and payload_slug and payload_slug == entity_slug:
            for raw_url in (getattr(member, "canonical_url", None), getattr(member, "url", None)):
                dom = _publisher_domain(str(raw_url or ""))
                if dom and dom not in _ONBOARD_DOMAIN_DENYLIST:
                    return f"https://{dom}"

        for raw_url in (getattr(member, "canonical_url", None), getattr(member, "url", None)):
            url = str(raw_url or "").strip()
            if not url:
                continue
            dom = _publisher_domain(url)
            if not dom or dom in _ONBOARD_DOMAIN_DENYLIST:
                continue

            label = _root_domain_label(dom)
            if not label:
                continue

            # Exact/near-exact label match wins immediately.
            if label == entity_slug or label.startswith(entity_slug) or entity_slug.startswith(label):
                return f"https://{dom}"

            # Fallback token overlap (e.g. "acme-ai" ↔ "acme").
            if slug_tokens and any(tok in label for tok in slug_tokens):
                return f"https://{dom}"

    return None


async def _record_onboarding_attempt(
    conn: "asyncpg.Connection",
    *,
    startup_id: Optional[str],
    entity_name: str,
    region: str,
    stage: str,
    success: bool,
    reason: str = "",
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Best-effort onboarding attempt telemetry (non-fatal when table is absent)."""
    try:
        await conn.execute(
            """
            INSERT INTO startup_onboarding_attempts (
                startup_id, entity_name, region, stage, success, reason, metadata_json
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb)
            """,
            startup_id,
            entity_name,
            region,
            stage,
            success,
            reason or "",
            json.dumps(metadata or {}),
        )
    except Exception:
        # Table may not exist yet; onboarding should proceed.
        return


async def onboard_unknown_startups(
    conn: "asyncpg.Connection",
    events: List[ExtractedEvent],
    clusters: list,
    confidence_threshold: float = 0.5,
    max_per_run: int = 10,
) -> int:
    """Create stub startups for entities mentioned in events but not yet in DB.

    Quality gates (applied in order):
    1. Denylist check (generic words, big tech, acronyms)
    2. Investor table dedup (skip known investor names)
    3. Entity type filter: "investor"/"person" → skip, "company" → allow,
       None/unknown → require multi-source confirmation
    4. Name/slug dedup against existing startups
    5. Rate limited to max_per_run per pipeline invocation

    After creation, backfills the event's startup_id and enqueues a refresh job.
    Returns count of startups created.
    """
    # Build cluster lookup for source stats
    cluster_by_key: Dict[str, Any] = {}
    for c in clusters:
        ck = getattr(c, "cluster_key", None)
        if ck:
            cluster_by_key[ck] = c

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

    # Pre-fetch existing investor names for dedup (lowercase set)
    try:
        investor_rows = await conn.fetch(
            "SELECT LOWER(name) AS name_lower FROM investors WHERE name IS NOT NULL"
        )
        investor_names = {r["name_lower"] for r in investor_rows}
    except Exception:
        investor_names = set()  # investors table may not exist

    created = 0
    skipped_reasons: Dict[str, int] = {}
    allowed_single_source = 0
    allowed_single_source_by_trust = 0
    allowed_single_source_by_allowlist = 0

    # Funding onboarding: allow trusted single-source clusters even when entity type is unknown.
    try:
        trust_min = float((os.getenv("ONBOARD_SINGLE_SOURCE_TRUST_MIN", "0.60") or "0.60").strip())
    except Exception:
        trust_min = 0.60
    trust_min = max(0.0, min(1.0, trust_min))

    allowlist_raw = (os.getenv("ONBOARD_SINGLE_SOURCE_ALLOWLIST", "") or "").strip()
    allowlist_domains: set[str] = set()
    if allowlist_raw:
        for raw in allowlist_raw.split(","):
            d = (raw or "").strip().lower()
            if not d:
                continue
            # Accept either bare domains ("tech.eu") or URLs ("https://tech.eu/...").
            if "://" in d:
                try:
                    host = urlparse(d).hostname or ""
                    d = host.lower()
                except Exception:
                    pass
            d = d.removeprefix("www.").split("/")[0].split(":")[0].strip()
            if d:
                allowlist_domains.add(d)

    def _skip(reason: str) -> None:
        skipped_reasons[reason] = skipped_reasons.get(reason, 0) + 1

    for name_lower, evt in list(seen_names.items())[:max_per_run]:
        entity_name = evt.entity_name or name_lower

        # --- Gate 1: Denylist ---
        if name_lower in _ONBOARD_DENYLIST:
            _skip("denylist")
            continue
        if any(p.match(entity_name) for p in _ONBOARD_DENY_PATTERNS):
            _skip("deny_pattern")
            continue

        # --- Gate 2: Investor table dedup ---
        if name_lower in investor_names:
            _skip("known_investor")
            continue

        # --- Gate 3: Entity type filter ---
        entity_type = evt.metadata.get("entity_type")
        if entity_type in ("investor", "person"):
            _skip("entity_type_" + str(entity_type))
            continue

        if entity_type != "company":
            # Unknown type → require multi-source confirmation
            # Exception: funding events can onboard from trusted single-source clusters.
            cluster_key = evt.metadata.get("cluster_key")
            cluster = cluster_by_key.get(cluster_key) if cluster_key else None
            if cluster:
                stats = cluster_source_stats(cluster)
                if not stats["multi_source_confirmed"]:
                    # Single source: allow only for funding when trust_score is high enough
                    # (or the publisher domain is explicitly allowlisted).
                    is_funding = (
                        evt.event_type == "cap_funding_raised"
                        or str(getattr(cluster, "story_type", "") or "").strip().lower() == "funding"
                        or str(evt.metadata.get("story_type") or "").strip().lower() == "funding"
                    )
                    if not is_funding:
                        _skip("single_source")
                        continue

                    trust_score = float(getattr(cluster, "trust_score", 0.0) or 0.0)
                    publisher_domains = set(stats.get("publisher_domains") or set())
                    allowlisted = bool(allowlist_domains and any(d in allowlist_domains for d in publisher_domains))

                    if allowlisted:
                        allowed_single_source += 1
                        allowed_single_source_by_allowlist += 1
                    elif trust_score >= trust_min:
                        allowed_single_source += 1
                        allowed_single_source_by_trust += 1
                    else:
                        _skip("single_source_low_trust")
                        continue
            else:
                # No cluster found → cannot verify sources → skip
                _skip("no_cluster")
                continue

        # --- Gate 4: Name/slug dedup ---
        slug = _slugify(entity_name)
        if not slug:
            _skip("empty_slug")
            continue

        region = evt.region or "global"
        cluster_key = evt.metadata.get("cluster_key")
        cluster = cluster_by_key.get(cluster_key) if cluster_key else None
        inferred_website = _infer_startup_website(entity_name, cluster)

        try:
            existing = await conn.fetchrow(
                """SELECT id::text AS id, website FROM startups
                   WHERE dataset_region = $3
                     AND COALESCE(onboarding_status, 'verified') != 'merged'
                     AND (LOWER(name) = $1 OR slug = $2)
                   LIMIT 1""",
                name_lower,
                slug,
                region,
            )
            if existing:
                existing_id = str(existing["id"])
                # Link the orphan events to this existing startup
                for e in events:
                    if e.entity_name and e.entity_name.lower().strip() == name_lower and not e.startup_id:
                        e.startup_id = existing_id
                # If this startup exists as a stub without website, fill website when inferred.
                existing_website = str(existing.get("website") or "").strip()
                if inferred_website and not existing_website:
                    await conn.execute(
                        """
                        UPDATE startups
                        SET website = $2,
                            updated_at = NOW()
                        WHERE id = $1::uuid
                          AND (website IS NULL OR TRIM(website) = '')
                        """,
                        existing_id,
                        inferred_website,
                    )
                await emit_trace(
                    conn,
                    startup_id=existing_id,
                    queue_item_id=None,
                    trace_type="onboarding",
                    stage="existing_startup_matched",
                    status="info",
                    severity="info",
                    reason_code="existing_startup",
                    message=f"Matched unknown entity to existing startup: {entity_name}",
                    payload={"region": region, "entity_name": entity_name, "slug": slug},
                    dedupe_key=f"existing_startup_matched:{existing_id}:{slug}",
                    should_notify=False,
                )
                _skip("existing_startup")
                continue
        except Exception:
            logger.warning("Onboard check failed for '%s'", entity_name, exc_info=True)
            continue

        # --- Create stub startup ---

        try:
            new_id = await conn.fetchval(
                """INSERT INTO startups (
                       name, slug, dataset_region, description, website, onboarding_status, period
                   )
                   VALUES ($1, $2, $3, $4, $5, 'stub', to_char(CURRENT_DATE, 'YYYY-MM'))
                   ON CONFLICT (dataset_region, slug) DO NOTHING
                   RETURNING id::text""",
                entity_name,
                slug,
                region,
                "Auto-discovered from news events. Pending analysis.",
                inferred_website,
            )
            if not new_id:
                continue  # Slug collision

            created += 1
            logger.info("Onboarded stub startup '%s' (id=%s) from event", entity_name, new_id)
            await emit_trace(
                conn,
                startup_id=new_id,
                queue_item_id=None,
                trace_type="onboarding",
                stage="stub_created",
                status="success",
                severity="info",
                reason_code="news_unlinked_entity",
                message=f"Created stub startup from news entity: {entity_name}",
                payload={
                    "region": region,
                    "entity_name": entity_name,
                    "slug": slug,
                    "website": inferred_website or "",
                    "website_inferred": bool(inferred_website),
                },
                dedupe_key=f"stub_created:{new_id}",
                should_notify=True,
            )
            await _record_onboarding_attempt(
                conn,
                startup_id=new_id,
                entity_name=entity_name,
                region=region,
                stage="stub_inserted",
                success=True,
                reason="news_unlinked_entity",
                metadata={"website_inferred": bool(inferred_website), "website": inferred_website or ""},
            )

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
            await emit_trace(
                conn,
                startup_id=None,
                queue_item_id=None,
                trace_type="onboarding",
                stage="stub_create_failed",
                status="failure",
                severity="warning",
                reason_code="insert_failed",
                message=f"Failed to create stub startup from entity: {entity_name}",
                payload={
                    "region": region,
                    "entity_name": entity_name,
                    "slug": slug,
                    "website_inferred": bool(inferred_website),
                },
                dedupe_key=f"stub_create_failed:{region}:{slug}:{date.today().isoformat()}",
                should_notify=True,
            )
            await _record_onboarding_attempt(
                conn,
                startup_id=None,
                entity_name=entity_name,
                region=region,
                stage="stub_inserted",
                success=False,
                reason="insert_failed",
                metadata={"website_inferred": bool(inferred_website)},
            )

    if skipped_reasons:
        logger.info("Onboarding skipped: %s", skipped_reasons)
    logger.info(
        "Onboarding summary: candidates=%d created=%d allowed_single_source=%d (trust=%d allowlist=%d) trust_min=%.2f",
        len(seen_names),
        created,
        allowed_single_source,
        allowed_single_source_by_trust,
        allowed_single_source_by_allowlist,
        trust_min,
    )
    try:
        region_label = (events[0].region if events else "global") or "global"
    except Exception:
        region_label = "global"
    print(
        f"[onboard:{region_label}] summary: candidates={len(seen_names)} created={created} "
        f"allowed_single_source={allowed_single_source} (trust={allowed_single_source_by_trust} "
        f"allowlist={allowed_single_source_by_allowlist}) trust_min={trust_min:.2f} "
        f"skipped={skipped_reasons or {}}"
    )
    if created:
        logger.info("Onboarded %d new stub startups from unlinked events", created)

    return created
