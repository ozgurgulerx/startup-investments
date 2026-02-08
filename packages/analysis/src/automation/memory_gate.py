"""Memory-gated editorial intelligence for the news pipeline.

Phase 1: Entity linking, heuristic fact extraction, and memory store.
Inserted between _cluster_items() and _enrich_clusters_with_llm() in news_ingest.py.

Zero LLM cost — all operations are dictionary lookups, regex, and database queries.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class LinkedEntity:
    """An entity matched to a known startup or investor."""
    entity_name: str
    entity_type: str  # company | investor | person | product
    startup_id: Optional[str] = None
    investor_id: Optional[str] = None
    match_method: str = "exact"  # exact | domain | jaccard
    match_score: float = 1.0


@dataclass
class ExtractedClaim:
    """A structured claim extracted from a cluster."""
    fact_key: str   # funding_amount, round_type, lead_investor, valuation, etc.
    fact_value: str
    text_span: str  # Source text supporting the claim
    confidence: float = 0.7
    entity_name: Optional[str] = None


@dataclass
class FactComparison:
    """Result of comparing an extracted claim against memory."""
    claim: ExtractedClaim
    status: str  # new_fact | confirmation | contradiction
    existing_value: Optional[str] = None
    existing_fact_id: Optional[str] = None


@dataclass
class MemoryResult:
    """Memory gate output for a single cluster."""
    linked_entities: List[LinkedEntity] = field(default_factory=list)
    extracted_claims: List[ExtractedClaim] = field(default_factory=list)
    fact_comparisons: List[FactComparison] = field(default_factory=list)
    extraction_method: str = "heuristic"

    @property
    def linked_entities_json(self) -> list:
        return [
            {
                "entity_name": e.entity_name,
                "entity_type": e.entity_type,
                "startup_id": e.startup_id,
                "investor_id": e.investor_id,
                "match_method": e.match_method,
                "match_score": e.match_score,
            }
            for e in self.linked_entities
        ]

    @property
    def claims_json(self) -> list:
        return [
            {
                "fact_key": c.fact_key,
                "fact_value": c.fact_value,
                "text_span": c.text_span,
                "confidence": c.confidence,
                "entity_name": c.entity_name,
            }
            for c in self.extracted_claims
        ]

    @property
    def has_new_facts(self) -> bool:
        return any(fc.status == "new_fact" for fc in self.fact_comparisons)

    @property
    def has_contradictions(self) -> bool:
        return any(fc.status == "contradiction" for fc in self.fact_comparisons)

    @property
    def contradictions_json(self) -> list:
        return [
            {
                "fact_key": fc.claim.fact_key,
                "new_value": fc.claim.fact_value,
                "existing_value": fc.existing_value,
                "entity_name": fc.claim.entity_name,
            }
            for fc in self.fact_comparisons
            if fc.status == "contradiction"
        ]


# ---------------------------------------------------------------------------
# EntityIndex — loads startups + investors into memory, provides link()
# ---------------------------------------------------------------------------

class EntityIndex:
    """In-memory index for fast entity linking (zero LLM cost)."""

    def __init__(self) -> None:
        # name_lower → (entity_type, startup_id_or_None, investor_id_or_None)
        self._name_index: Dict[str, Tuple[str, Optional[str], Optional[str]]] = {}
        # domain → startup_id
        self._domain_index: Dict[str, str] = {}
        self._loaded = False

    async def load(self, conn: asyncpg.Connection) -> None:
        """Load startups + investors into the in-memory index."""
        # Startups: name, slug, website
        rows = await conn.fetch(
            "SELECT id::text, name, slug, website FROM startups WHERE name IS NOT NULL"
        )
        for row in rows:
            sid = row["id"]
            name = row["name"].strip()
            name_lower = name.lower()
            self._name_index[name_lower] = ("company", sid, None)

            # Also index the slug (slugs are like "openai", "anthropic")
            slug = row.get("slug")
            if slug:
                slug_lower = slug.strip().lower()
                if slug_lower and slug_lower != name_lower:
                    self._name_index.setdefault(slug_lower, ("company", sid, None))

            # Index domain
            website = row.get("website")
            if website:
                domain = self._extract_domain(website)
                if domain:
                    self._domain_index[domain] = sid

        # Investors
        inv_rows = await conn.fetch(
            "SELECT id::text, name FROM investors WHERE name IS NOT NULL"
        )
        for row in inv_rows:
            inv_id = row["id"]
            name_lower = row["name"].strip().lower()
            # Don't overwrite if a startup has the same name
            if name_lower not in self._name_index:
                self._name_index[name_lower] = ("investor", None, inv_id)

        # Known entity names from prior extractions
        fact_rows = await conn.fetch(
            """SELECT DISTINCT entity_name, entity_type, linked_startup_id::text, linked_investor_id::text
               FROM news_entity_facts WHERE is_current = TRUE"""
        )
        for row in fact_rows:
            name_lower = row["entity_name"].strip().lower()
            if name_lower not in self._name_index:
                self._name_index[name_lower] = (
                    row["entity_type"],
                    row["linked_startup_id"],
                    row["linked_investor_id"],
                )

        self._loaded = True
        logger.info("EntityIndex loaded: %d names, %d domains", len(self._name_index), len(self._domain_index))

    def link(self, entity_names: Sequence[str], urls: Sequence[str] = ()) -> List[LinkedEntity]:
        """Link a list of entity names (from a cluster) to known entities.

        Tries three methods in order:
        1. Exact LOWER match on name/slug
        2. Domain match on URLs
        3. Jaccard token overlap >= 0.7
        """
        results: List[LinkedEntity] = []
        seen: set = set()

        for name in entity_names:
            name_stripped = name.strip()
            if not name_stripped:
                continue
            name_lower = name_stripped.lower()
            if name_lower in seen:
                continue
            seen.add(name_lower)

            # Method 1: exact match
            hit = self._name_index.get(name_lower)
            if hit:
                etype, sid, iid = hit
                results.append(LinkedEntity(
                    entity_name=name_stripped,
                    entity_type=etype,
                    startup_id=sid,
                    investor_id=iid,
                    match_method="exact",
                    match_score=1.0,
                ))
                continue

            # Method 3: Jaccard token overlap
            best_match = self._jaccard_search(name_lower)
            if best_match:
                _, score, hit = best_match
                etype, sid, iid = hit
                results.append(LinkedEntity(
                    entity_name=name_stripped,
                    entity_type=etype,
                    startup_id=sid,
                    investor_id=iid,
                    match_method="jaccard",
                    match_score=score,
                ))

        # Method 2: domain match from URLs
        for url in urls:
            domain = self._extract_domain(url)
            if domain and domain in self._domain_index:
                sid = self._domain_index[domain]
                # Check if already linked
                if not any(le.startup_id == sid for le in results):
                    results.append(LinkedEntity(
                        entity_name=domain,
                        entity_type="company",
                        startup_id=sid,
                        match_method="domain",
                        match_score=0.9,
                    ))

        return results

    def _jaccard_search(
        self, query_lower: str, threshold: float = 0.7
    ) -> Optional[Tuple[str, float, Tuple[str, Optional[str], Optional[str]]]]:
        """Find the best Jaccard match above threshold."""
        query_tokens = set(query_lower.split())
        if len(query_tokens) < 2:
            return None  # Single-token names are too ambiguous for fuzzy matching

        best_score = 0.0
        best_name = ""
        best_hit = None

        for indexed_name, hit in self._name_index.items():
            indexed_tokens = set(indexed_name.split())
            if len(indexed_tokens) < 2:
                continue
            intersection = query_tokens & indexed_tokens
            union = query_tokens | indexed_tokens
            if not union:
                continue
            score = len(intersection) / len(union)
            if score > best_score and score >= threshold:
                best_score = score
                best_name = indexed_name
                best_hit = hit

        if best_hit and best_score >= threshold:
            return best_name, best_score, best_hit
        return None

    @staticmethod
    def _extract_domain(url: str) -> str:
        """Extract bare domain from a URL (without www.)."""
        if not url:
            return ""
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"
        try:
            host = urlparse(url).netloc.lower().removeprefix("www.")
            return host
        except Exception:
            return ""


# ---------------------------------------------------------------------------
# FactExtractor — heuristic regex extraction by story_type
# ---------------------------------------------------------------------------

# Funding patterns
_AMOUNT_RE = re.compile(
    r"\$\s*([\d,.]+)\s*(million|billion|mn|bn|m|b|k)\b",
    re.IGNORECASE,
)
_AMOUNT_PLAIN_RE = re.compile(
    r"\$\s*([\d,.]+)\s*([MBK])\b",
)
_SERIES_RE = re.compile(
    r"\b(pre-?seed|seed|series\s+[a-f]|series\s+[a-f]\d?|growth|bridge|extension)\b",
    re.IGNORECASE,
)
_LED_BY_RE = re.compile(
    r"(?:led\s+by|anchored\s+by|co-?led\s+by)\s+([A-Za-z0-9][A-Za-z0-9\s&]+?)(?:\s+(?:with|and\s+participation|in\s+a)|[.,;]|$)",
    re.IGNORECASE,
)
_VALUATION_RE = re.compile(
    r"(?:valued?\s+at|valuation\s+of)\s+\$\s*([\d,.]+)\s*(million|billion|mn|bn|m|b)\b",
    re.IGNORECASE,
)

# M&A patterns
_ACQUIRED_RE = re.compile(
    r"(?:acquires?|acquired|acquisition\s+of|to\s+acquire)\s+([A-Z][A-Za-z\s&]+?)(?:\s+for|\s+in|\.|,|$)",
    re.IGNORECASE,
)
_DEAL_VALUE_RE = re.compile(
    r"(?:for|deal\s+worth|at)\s+\$\s*([\d,.]+)\s*(million|billion|mn|bn|m|b)\b",
    re.IGNORECASE,
)

# Launch patterns
_LAUNCH_RE = re.compile(
    r"\b(launch(?:es|ed)?|introduces?|unveiled?|announces?|rolls?\s+out)\b",
    re.IGNORECASE,
)


def _normalize_amount(value_str: str, unit: str) -> str:
    """Normalize a funding amount string to a standard format."""
    cleaned = value_str.replace(",", "")
    try:
        num = float(cleaned)
    except ValueError:
        return f"${value_str}{unit}"

    unit_lower = unit.lower()
    if unit_lower in ("b", "bn", "billion"):
        return f"${num}B"
    elif unit_lower in ("m", "mn", "million"):
        return f"${num}M"
    elif unit_lower in ("k",):
        return f"${num}K"
    return f"${value_str}{unit}"


class FactExtractor:
    """Heuristic regex-based fact extraction by story_type.

    Phase 1: No LLM calls. Extracts from cluster title + summary.
    """

    def extract(
        self,
        *,
        story_type: str,
        title: str,
        summary: str,
        entities: Sequence[str],
    ) -> List[ExtractedClaim]:
        """Extract structured claims from a cluster."""
        text = f"{title} {summary}"
        claims: List[ExtractedClaim] = []

        # Primary entity is the first entity in the cluster
        primary_entity = entities[0] if entities else None

        if story_type == "funding":
            claims.extend(self._extract_funding(text, primary_entity))
        elif story_type == "mna":
            claims.extend(self._extract_mna(text, primary_entity))
        elif story_type == "launch":
            claims.extend(self._extract_launch(text, primary_entity))
        elif story_type in ("hiring", "regulation"):
            claims.extend(self._extract_general(text, primary_entity, story_type))
        else:
            # Generic news — try funding patterns first, then general
            funding = self._extract_funding(text, primary_entity)
            if funding:
                claims.extend(funding)
            else:
                claims.extend(self._extract_general(text, primary_entity, story_type))

        return claims

    def _extract_funding(self, text: str, entity: Optional[str]) -> List[ExtractedClaim]:
        claims: List[ExtractedClaim] = []

        # Amount
        for pattern in (_AMOUNT_RE, _AMOUNT_PLAIN_RE):
            m = pattern.search(text)
            if m:
                amount = _normalize_amount(m.group(1), m.group(2))
                claims.append(ExtractedClaim(
                    fact_key="funding_amount",
                    fact_value=amount,
                    text_span=m.group(0).strip(),
                    confidence=0.85,
                    entity_name=entity,
                ))
                break

        # Round type
        m = _SERIES_RE.search(text)
        if m:
            round_type = m.group(1).strip().title()
            claims.append(ExtractedClaim(
                fact_key="round_type",
                fact_value=round_type,
                text_span=m.group(0).strip(),
                confidence=0.9,
                entity_name=entity,
            ))

        # Lead investor
        m = _LED_BY_RE.search(text)
        if m:
            lead = m.group(1).strip().rstrip(",. ")
            claims.append(ExtractedClaim(
                fact_key="lead_investor",
                fact_value=lead,
                text_span=m.group(0).strip(),
                confidence=0.8,
                entity_name=entity,
            ))

        # Valuation
        m = _VALUATION_RE.search(text)
        if m:
            val = _normalize_amount(m.group(1), m.group(2))
            claims.append(ExtractedClaim(
                fact_key="valuation",
                fact_value=val,
                text_span=m.group(0).strip(),
                confidence=0.75,
                entity_name=entity,
            ))

        return claims

    def _extract_mna(self, text: str, entity: Optional[str]) -> List[ExtractedClaim]:
        claims: List[ExtractedClaim] = []

        m = _ACQUIRED_RE.search(text)
        if m:
            target = m.group(1).strip().rstrip(",. ")
            claims.append(ExtractedClaim(
                fact_key="acquisition_target",
                fact_value=target,
                text_span=m.group(0).strip(),
                confidence=0.8,
                entity_name=entity,
            ))

        m = _DEAL_VALUE_RE.search(text)
        if m:
            amount = _normalize_amount(m.group(1), m.group(2))
            claims.append(ExtractedClaim(
                fact_key="deal_value",
                fact_value=amount,
                text_span=m.group(0).strip(),
                confidence=0.75,
                entity_name=entity,
            ))

        return claims

    def _extract_launch(self, text: str, entity: Optional[str]) -> List[ExtractedClaim]:
        claims: List[ExtractedClaim] = []

        if _LAUNCH_RE.search(text):
            claims.append(ExtractedClaim(
                fact_key="product_launched",
                fact_value="true",
                text_span=text[:200].strip(),
                confidence=0.7,
                entity_name=entity,
            ))

        return claims

    def _extract_general(
        self, text: str, entity: Optional[str], story_type: str
    ) -> List[ExtractedClaim]:
        """Extract minimal claims for non-specific story types."""
        claims: List[ExtractedClaim] = []

        # Try amount extraction even in general stories
        m = _AMOUNT_RE.search(text) or _AMOUNT_PLAIN_RE.search(text)
        if m:
            amount = _normalize_amount(m.group(1), m.group(2))
            claims.append(ExtractedClaim(
                fact_key="mentioned_amount",
                fact_value=amount,
                text_span=m.group(0).strip(),
                confidence=0.5,
                entity_name=entity,
            ))

        return claims


# ---------------------------------------------------------------------------
# MemoryStore — read/write news_entity_facts, dedup + contradiction check
# ---------------------------------------------------------------------------

class MemoryStore:
    """Persistent memory layer: reads/writes news_entity_facts."""

    async def compare_claims(
        self,
        conn: asyncpg.Connection,
        claims: Sequence[ExtractedClaim],
    ) -> List[FactComparison]:
        """Compare extracted claims against stored facts.

        Returns: list of FactComparison with status new_fact / confirmation / contradiction.
        """
        results: List[FactComparison] = []

        for claim in claims:
            if not claim.entity_name:
                results.append(FactComparison(claim=claim, status="new_fact"))
                continue

            existing = await conn.fetchrow(
                """
                SELECT id::text, fact_value
                FROM news_entity_facts
                WHERE LOWER(entity_name) = LOWER($1)
                  AND fact_key = $2
                  AND is_current = TRUE
                ORDER BY last_confirmed_at DESC
                LIMIT 1
                """,
                claim.entity_name,
                claim.fact_key,
            )

            if not existing:
                results.append(FactComparison(claim=claim, status="new_fact"))
            elif self._values_match(existing["fact_value"], claim.fact_value):
                results.append(FactComparison(
                    claim=claim,
                    status="confirmation",
                    existing_value=existing["fact_value"],
                    existing_fact_id=existing["id"],
                ))
            else:
                results.append(FactComparison(
                    claim=claim,
                    status="contradiction",
                    existing_value=existing["fact_value"],
                    existing_fact_id=existing["id"],
                ))

        return results

    async def persist_facts(
        self,
        conn: asyncpg.Connection,
        comparisons: Sequence[FactComparison],
        linked_entities: Sequence[LinkedEntity],
        cluster_id: str,
        source_url: str,
    ) -> int:
        """Write new/updated facts to news_entity_facts. Returns count of rows written."""
        # Build entity → linked IDs map
        entity_map: Dict[str, LinkedEntity] = {}
        for le in linked_entities:
            entity_map[le.entity_name.lower()] = le

        count = 0
        for fc in comparisons:
            claim = fc.claim
            if not claim.entity_name:
                continue

            le = entity_map.get(claim.entity_name.lower())
            startup_id = le.startup_id if le else None
            investor_id = le.investor_id if le else None
            entity_type = le.entity_type if le else "company"

            if fc.status == "new_fact":
                await conn.execute(
                    """
                    INSERT INTO news_entity_facts (
                        entity_name, entity_type, linked_startup_id, linked_investor_id,
                        fact_key, fact_value, fact_confidence,
                        source_cluster_id, source_url, source_text_span,
                        is_current, confirmation_count, first_seen_at, last_confirmed_at
                    ) VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8::uuid, $9, $10,
                              TRUE, 1, NOW(), NOW())
                    """,
                    claim.entity_name,
                    entity_type,
                    startup_id,
                    investor_id,
                    claim.fact_key,
                    claim.fact_value,
                    claim.confidence,
                    cluster_id,
                    source_url,
                    claim.text_span,
                )
                count += 1

            elif fc.status == "confirmation" and fc.existing_fact_id:
                await conn.execute(
                    """
                    UPDATE news_entity_facts
                    SET confirmation_count = confirmation_count + 1,
                        last_confirmed_at = NOW(),
                        fact_confidence = LEAST(1.0, fact_confidence + 0.05)
                    WHERE id = $1::uuid
                    """,
                    fc.existing_fact_id,
                )

            elif fc.status == "contradiction" and fc.existing_fact_id:
                # Supersede old fact
                new_fact_id = await conn.fetchval(
                    """
                    INSERT INTO news_entity_facts (
                        entity_name, entity_type, linked_startup_id, linked_investor_id,
                        fact_key, fact_value, fact_confidence,
                        source_cluster_id, source_url, source_text_span,
                        is_current, confirmation_count, first_seen_at, last_confirmed_at
                    ) VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8::uuid, $9, $10,
                              TRUE, 1, NOW(), NOW())
                    RETURNING id::text
                    """,
                    claim.entity_name,
                    entity_type,
                    startup_id,
                    investor_id,
                    claim.fact_key,
                    claim.fact_value,
                    claim.confidence,
                    cluster_id,
                    source_url,
                    claim.text_span,
                )
                # Mark old fact as superseded
                await conn.execute(
                    """
                    UPDATE news_entity_facts
                    SET is_current = FALSE,
                        superseded_by = $2::uuid
                    WHERE id = $1::uuid
                    """,
                    fc.existing_fact_id,
                    new_fact_id,
                )
                count += 1

        return count

    @staticmethod
    def _values_match(existing: str, new: str) -> bool:
        """Check if two fact values are semantically equivalent."""
        a = existing.strip().lower().replace(",", "").replace(" ", "")
        b = new.strip().lower().replace(",", "").replace(" ", "")
        return a == b


# ---------------------------------------------------------------------------
# MemoryGate — orchestrator (wires EntityIndex + FactExtractor + MemoryStore)
# ---------------------------------------------------------------------------

class MemoryGate:
    """Orchestrates memory gate processing for clusters.

    Usage in news_ingest.py:
        gate = MemoryGate()
        await gate.load(conn)
        for cluster in clusters:
            result = await gate.process_cluster(conn, cluster_key, ...)
    """

    def __init__(self) -> None:
        self.entity_index = EntityIndex()
        self.fact_extractor = FactExtractor()
        self.memory_store = MemoryStore()
        self._stats = {
            "clusters_processed": 0,
            "entities_linked": 0,
            "claims_extracted": 0,
            "new_facts": 0,
            "confirmations": 0,
            "contradictions": 0,
        }

    async def load(self, conn: asyncpg.Connection) -> None:
        """Load entity index from database."""
        await self.entity_index.load(conn)

    async def process_cluster(
        self,
        conn: asyncpg.Connection,
        *,
        cluster_key: str,
        title: str,
        summary: str,
        story_type: str,
        entities: Sequence[str],
        canonical_url: str,
        trust_score: float,
        members_urls: Sequence[str] = (),
    ) -> MemoryResult:
        """Run memory gate on a single cluster.

        Returns MemoryResult with linked entities, extracted claims, and comparisons.
        """
        result = MemoryResult()

        # Step 1: Entity linking
        all_urls = list(members_urls)
        if canonical_url:
            all_urls.insert(0, canonical_url)
        result.linked_entities = self.entity_index.link(entities, all_urls)

        # Step 2: Fact extraction
        result.extracted_claims = self.fact_extractor.extract(
            story_type=story_type,
            title=title,
            summary=summary or "",
            entities=entities,
        )

        # Step 3: Memory comparison
        if result.extracted_claims:
            result.fact_comparisons = await self.memory_store.compare_claims(
                conn, result.extracted_claims
            )

        self._stats["clusters_processed"] += 1
        self._stats["entities_linked"] += len(result.linked_entities)
        self._stats["claims_extracted"] += len(result.extracted_claims)
        for fc in result.fact_comparisons:
            if fc.status == "new_fact":
                self._stats["new_facts"] += 1
            elif fc.status == "confirmation":
                self._stats["confirmations"] += 1
            elif fc.status == "contradiction":
                self._stats["contradictions"] += 1

        return result

    async def persist_extraction(
        self,
        conn: asyncpg.Connection,
        cluster_id: str,
        result: MemoryResult,
    ) -> None:
        """Persist extraction results to news_item_extractions table."""
        await conn.execute(
            """
            INSERT INTO news_item_extractions (
                cluster_id, claims_json, linked_entities_json,
                extraction_method
            ) VALUES ($1::uuid, $2::jsonb, $3::jsonb, $4)
            ON CONFLICT (cluster_id) DO UPDATE
            SET claims_json = EXCLUDED.claims_json,
                linked_entities_json = EXCLUDED.linked_entities_json,
                extraction_method = EXCLUDED.extraction_method,
                updated_at = NOW()
            """,
            cluster_id,
            json.dumps(result.claims_json),
            json.dumps(result.linked_entities_json),
            result.extraction_method,
        )

    async def persist_facts(
        self,
        conn: asyncpg.Connection,
        cluster_id: str,
        canonical_url: str,
        result: MemoryResult,
    ) -> int:
        """Persist new/updated entity facts. Returns count of new facts written."""
        if not result.fact_comparisons:
            return 0
        return await self.memory_store.persist_facts(
            conn,
            result.fact_comparisons,
            result.linked_entities,
            cluster_id,
            canonical_url,
        )

    @property
    def stats(self) -> Dict[str, Any]:
        return dict(self._stats)
