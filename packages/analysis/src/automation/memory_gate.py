"""Memory-gated editorial intelligence for the news pipeline.

Phase 1: Entity linking, heuristic fact extraction, and memory store.
Phase 2: Pattern matching, GTM classification, heuristic scoring, and gating.

Inserted between _cluster_items() and _enrich_clusters_with_llm() in news_ingest.py.

Region-aware: Turkey memory reads global + turkey facts (one-way merge),
global memory reads only global facts. Turkish-language regex patterns
are applied when region="turkey".

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

    async def load(self, conn: asyncpg.Connection, region: str = "global") -> None:
        """Load startups + investors into the in-memory index.

        Args:
            region: 'global' loads only global entity facts.
                    'turkey' loads global + turkey entity facts (one-way merge).
                    Startups and investors are always loaded globally.
        """
        # Startups: name, slug, website (always global — skip merged startups)
        # onboarding_status added by migration 046 — graceful fallback via try/except in news_ingest.py
        rows = await conn.fetch(
            "SELECT id::text, name, slug, website FROM startups "
            "WHERE name IS NOT NULL AND COALESCE(onboarding_status, 'verified') != 'merged'"
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

        # Load aliases into name/domain indexes
        try:
            alias_rows = await conn.fetch(
                "SELECT alias, startup_id::text, alias_type FROM startup_aliases"
            )
            for arow in alias_rows:
                alias_lower = arow["alias"].strip().lower()
                sid = arow["startup_id"]
                if alias_lower not in self._name_index:
                    self._name_index[alias_lower] = ("company", sid, None)
                if arow["alias_type"] == "domain" and alias_lower not in self._domain_index:
                    self._domain_index[alias_lower] = sid
        except asyncpg.UndefinedTableError:
            pass  # startup_aliases table may not exist yet

        # Investors (always global)
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
        # Turkey loads both global + turkey facts; global loads only global
        if region == "turkey":
            region_filter = "region IN ('global', 'turkey')"
        else:
            region_filter = "region = 'global'"
        fact_rows = await conn.fetch(
            f"""SELECT DISTINCT entity_name, entity_type, linked_startup_id::text, linked_investor_id::text
               FROM news_entity_facts WHERE is_current = TRUE AND {region_filter}"""
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
        logger.info("EntityIndex loaded (%s): %d names, %d domains", region, len(self._name_index), len(self._domain_index))

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

    async def get_entity_profile(
        self, conn: "asyncpg.Connection", entity_name: str, region: str = "global"
    ) -> Dict[str, Any]:
        """Return structured profile of known facts for an entity.

        Used to feed entity context into LLM prompts.
        """
        if region == "turkey":
            region_filter = "AND region IN ('global', 'turkey')"
        else:
            region_filter = "AND region = 'global'"

        rows = await conn.fetch(
            f"""SELECT fact_key, fact_value, fact_confidence, confirmation_count,
                       first_seen_at, last_confirmed_at
                FROM news_entity_facts
                WHERE LOWER(entity_name) = LOWER($1) AND is_current = TRUE {region_filter}
                ORDER BY last_confirmed_at DESC""",
            entity_name,
        )
        return {
            "entity_name": entity_name,
            "facts": {row["fact_key"]: row["fact_value"] for row in rows},
            "confidence": {row["fact_key"]: float(row["fact_confidence"]) for row in rows},
            "confirmations": {row["fact_key"]: int(row["confirmation_count"]) for row in rows},
        }

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

# ---------------------------------------------------------------------------
# Turkish-language patterns (applied when region="turkey")
# ---------------------------------------------------------------------------
_TR_AMOUNT_RE = re.compile(
    r"(\d[\d,.]*)\s*(milyon|milyar)\s*(dolar|tl|euro)\b",
    re.IGNORECASE,
)
_TR_SERIES_RE = re.compile(
    r"\b(tohum|pre-?seed|seed|seri\s+[a-f]|büyüme\s+turu|köprü\s+tur)\b",
    re.IGNORECASE,
)
_TR_LED_BY_RE = re.compile(
    r"(?:liderliğinde|öncülüğünde|liderliginde|onculugunde)\s+([A-Za-z0-9][A-Za-z0-9\s&]+?)(?:\s+(?:ile|ve\s+katılımıyla)|[.,;]|$)",
    re.IGNORECASE,
)
_TR_VALUATION_RE = re.compile(
    r"(?:değerleme(?:si)?|degerleme(?:si)?)\s+(\d[\d,.]*)\s*(milyon|milyar)\s*(dolar|tl)\b",
    re.IGNORECASE,
)
_TR_ACQUIRED_RE = re.compile(
    r"(?:[Ss]atın\s+al|[Ss]atinal|[Bb]ünyesine\s+kat)\w*\s+([A-ZÇĞİÖŞÜ][A-Za-zçğıöşü\s&]+?)(?:\s+(?:şirketini|firmasını|için|ile|olarak)|[.,;]|$)",
)
_TR_LAUNCH_RE = re.compile(
    r"\b(lansm|kullanıma\s+sun|yayınla|piyasaya\s+sür|beta\s+sürüm|duyur)",
    re.IGNORECASE,
)


def _normalize_tr_amount(value_str: str, unit: str, currency: str) -> str:
    """Normalize a Turkish funding amount to USD standard format."""
    cleaned = value_str.replace(",", "").replace(".", "")
    try:
        num = float(cleaned)
    except ValueError:
        return f"{value_str} {unit} {currency}"
    unit_lower = unit.lower()
    # Convert to standard $ format
    if unit_lower == "milyar":
        return f"${num}B"
    elif unit_lower == "milyon":
        return f"${num}M"
    return f"${value_str}{unit}"


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
    Region-aware: applies both English and Turkish patterns when region="turkey".
    """

    def extract(
        self,
        *,
        story_type: str,
        title: str,
        summary: str,
        entities: Sequence[str],
        region: str = "global",
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

        # Turkish patterns — run in addition to English when region is turkey
        if region == "turkey":
            claims.extend(self._extract_turkish(text, primary_entity, story_type))

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

    def _extract_turkish(
        self, text: str, entity: Optional[str], story_type: str
    ) -> List[ExtractedClaim]:
        """Extract claims using Turkish-language patterns.

        Only adds claims that weren't already captured by English patterns.
        """
        claims: List[ExtractedClaim] = []

        # Turkish funding amount (e.g., "5 milyon dolar", "1.2 milyar dolar")
        m = _TR_AMOUNT_RE.search(text)
        if m and story_type in ("funding", "news", ""):
            amount = _normalize_tr_amount(m.group(1), m.group(2), m.group(3))
            claims.append(ExtractedClaim(
                fact_key="funding_amount",
                fact_value=amount,
                text_span=m.group(0).strip(),
                confidence=0.80,
                entity_name=entity,
            ))

        # Turkish round type (e.g., "seri A", "tohum", "büyüme turu")
        m = _TR_SERIES_RE.search(text)
        if m:
            raw = m.group(1).strip()
            # Normalize Turkish round names to English
            _TR_ROUND_MAP = {
                "tohum": "Seed", "seed": "Seed", "pre-seed": "Pre-Seed",
                "büyüme turu": "Growth", "köprü tur": "Bridge",
            }
            round_type = _TR_ROUND_MAP.get(raw.lower(), raw.title())
            claims.append(ExtractedClaim(
                fact_key="round_type",
                fact_value=round_type,
                text_span=m.group(0).strip(),
                confidence=0.85,
                entity_name=entity,
            ))

        # Turkish lead investor
        m = _TR_LED_BY_RE.search(text)
        if m:
            lead = m.group(1).strip().rstrip(",. ")
            claims.append(ExtractedClaim(
                fact_key="lead_investor",
                fact_value=lead,
                text_span=m.group(0).strip(),
                confidence=0.75,
                entity_name=entity,
            ))

        # Turkish valuation
        m = _TR_VALUATION_RE.search(text)
        if m:
            val = _normalize_tr_amount(m.group(1), m.group(2), m.group(3))
            claims.append(ExtractedClaim(
                fact_key="valuation",
                fact_value=val,
                text_span=m.group(0).strip(),
                confidence=0.70,
                entity_name=entity,
            ))

        # Turkish M&A
        if story_type in ("mna", "news", ""):
            m = _TR_ACQUIRED_RE.search(text)
            if m:
                target = m.group(1).strip().rstrip(",. ")
                claims.append(ExtractedClaim(
                    fact_key="acquisition_target",
                    fact_value=target,
                    text_span=m.group(0).strip(),
                    confidence=0.75,
                    entity_name=entity,
                ))

        # Turkish launch
        if story_type in ("launch", "news", ""):
            if _TR_LAUNCH_RE.search(text):
                claims.append(ExtractedClaim(
                    fact_key="product_launched",
                    fact_value="true",
                    text_span=text[:200].strip(),
                    confidence=0.65,
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
        region: str = "global",
    ) -> List[FactComparison]:
        """Compare extracted claims against stored facts.

        Args:
            region: 'global' compares against global facts only.
                    'turkey' compares against global + turkey facts (one-way merge).

        Returns: list of FactComparison with status new_fact / confirmation / contradiction.
        """
        # Turkey sees both global and turkey facts; global sees only global
        if region == "turkey":
            region_filter = "AND region IN ('global', 'turkey')"
        else:
            region_filter = "AND region = 'global'"

        results: List[FactComparison] = []

        for claim in claims:
            if not claim.entity_name:
                results.append(FactComparison(claim=claim, status="new_fact"))
                continue

            existing = await conn.fetchrow(
                f"""
                SELECT id::text, fact_value
                FROM news_entity_facts
                WHERE LOWER(entity_name) = LOWER($1)
                  AND fact_key = $2
                  AND is_current = TRUE
                  {region_filter}
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
        region: str = "global",
    ) -> int:
        """Write new/updated facts to news_entity_facts. Returns count of rows written.

        Facts are always tagged with the given region so they stay scoped.
        """
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
                        is_current, confirmation_count, first_seen_at, last_confirmed_at,
                        region
                    ) VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8::uuid, $9, $10,
                              TRUE, 1, NOW(), NOW(), $11)
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
                    region,
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
                        is_current, confirmation_count, first_seen_at, last_confirmed_at,
                        region
                    ) VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8::uuid, $9, $10,
                              TRUE, 1, NOW(), NOW(), $11)
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
                    region,
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

    Region-aware: pass region to load() and process_cluster() to control
    which facts are visible and how extraction works.

    Usage in news_ingest.py:
        gate = MemoryGate()
        await gate.load(conn, region="turkey")
        for cluster in clusters:
            result = await gate.process_cluster(conn, cluster_key, ..., region="turkey")
    """

    def __init__(self) -> None:
        self.entity_index = EntityIndex()
        self.fact_extractor = FactExtractor()
        self.memory_store = MemoryStore()
        self._region = "global"
        self._stats = {
            "clusters_processed": 0,
            "entities_linked": 0,
            "claims_extracted": 0,
            "new_facts": 0,
            "confirmations": 0,
            "contradictions": 0,
        }

    async def load(self, conn: asyncpg.Connection, region: str = "global") -> None:
        """Load entity index from database with region-appropriate facts."""
        self._region = region
        await self.entity_index.load(conn, region=region)

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
        region: str = "global",
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

        # Step 2: Fact extraction (region-aware — applies Turkish patterns for turkey)
        result.extracted_claims = self.fact_extractor.extract(
            story_type=story_type,
            title=title,
            summary=summary or "",
            entities=entities,
            region=region,
        )

        # Step 3: Memory comparison (region-aware — turkey sees global+turkey facts)
        if result.extracted_claims:
            result.fact_comparisons = await self.memory_store.compare_claims(
                conn, result.extracted_claims, region=region,
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
        region: str = "global",
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
            region=region,
        )

    @property
    def stats(self) -> Dict[str, Any]:
        return dict(self._stats)


# ---------------------------------------------------------------------------
# PatternMatcher — keyword-based build-pattern matching (zero LLM)
# ---------------------------------------------------------------------------

# Keyword anchors for each canonical pattern.
# Match is computed as keyword overlap score (0-1).
_PATTERN_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "Agentic Architectures": (
        "agent", "agentic", "autonomous", "multi-agent", "tool-use",
        "function calling", "tool calling", "agent framework",
    ),
    "Vertical Data Moats": (
        "proprietary data", "data moat", "vertical data", "domain-specific data",
        "exclusive dataset", "data advantage",
    ),
    "Micro-model Meshes": (
        "micro-model", "small model", "specialized model", "distill",
        "model ensemble", "mixture of experts", "moe",
    ),
    "Continuous-learning Flywheels": (
        "continuous learning", "online learning", "reinforcement",
        "feedback loop", "self-improving",
    ),
    "RAG (Retrieval-Augmented Generation)": (
        "rag", "retrieval augmented", "retrieval-augmented", "vector search",
        "vector database", "embedding search", "knowledge retrieval",
    ),
    "Knowledge Graphs": (
        "knowledge graph", "ontology", "graph database", "neo4j",
        "graph-based", "entity graph",
    ),
    "Natural-Language-to-Code": (
        "code generation", "nl-to-code", "copilot", "code assistant",
        "code completion", "code editor", "ai ide", "pair programmer",
    ),
    "Guardrail-as-LLM": (
        "guardrail", "safety filter", "content filter", "moderation",
        "output filter", "hallucination detection",
    ),
    "Fine-tuned Models": (
        "fine-tune", "fine-tuning", "finetune", "lora", "qlora",
        "adapter", "peft", "custom model",
    ),
    "Compound AI Systems": (
        "compound ai", "multi-model", "pipeline", "orchestrat",
        "chain", "multi-step", "workflow",
    ),
    "EvalOps": (
        "evaluation", "eval", "benchmark", "testing llm",
        "eval framework", "quality assurance",
    ),
    "LLMOps": (
        "llmops", "model monitoring", "prompt management", "model serving",
        "model deployment", "inference serving",
    ),
    "LLM Security": (
        "llm security", "prompt injection", "jailbreak", "red team",
        "adversarial", "ai safety", "alignment",
    ),
    "Inference Optimization": (
        "inference", "quantiz", "pruning", "onnx", "tensorrt",
        "vllm", "speculative decoding", "kv cache",
    ),
    "Data Flywheels": (
        "data flywheel", "user data", "feedback data",
        "data network effect",
    ),
    "Model Routing": (
        "model routing", "model gateway", "load balancing",
        "fallback", "model selection", "router",
    ),
    "Prompt Engineering": (
        "prompt engineer", "prompt template", "chain of thought",
        "few-shot", "prompt optimization",
    ),
    "Hybrid Search": (
        "hybrid search", "semantic search", "keyword search",
        "bm25", "full-text search",
    ),
    "Active Learning": (
        "active learning", "human-in-the-loop", "hitl",
        "annotation", "labeling",
    ),
    "Synthetic Data Generation": (
        "synthetic data", "data generation", "data augment",
        "artificial data",
    ),
}

# Category mapping for canonical patterns.
_PATTERN_CATEGORIES: Dict[str, str] = {
    "Agentic Architectures": "Model Architecture",
    "Vertical Data Moats": "Data Strategy",
    "Micro-model Meshes": "Model Architecture",
    "Continuous-learning Flywheels": "Learning & Improvement",
    "RAG (Retrieval-Augmented Generation)": "Retrieval & Knowledge",
    "Knowledge Graphs": "Retrieval & Knowledge",
    "Natural-Language-to-Code": "Compound AI Systems",
    "Guardrail-as-LLM": "Safety & Trust",
    "Fine-tuned Models": "Model Architecture",
    "Compound AI Systems": "Compound AI Systems",
    "EvalOps": "Evaluation & Quality",
    "LLMOps": "Operations & Infrastructure",
    "LLM Security": "Safety & Trust",
    "Inference Optimization": "Operations & Infrastructure",
    "Data Flywheels": "Data Strategy",
    "Model Routing": "Operations & Infrastructure",
    "Prompt Engineering": "Operations & Infrastructure",
    "Hybrid Search": "Retrieval & Knowledge",
    "Active Learning": "Learning & Improvement",
    "Synthetic Data Generation": "Data Strategy",
}


def _text_contains(text: str, needle: str) -> bool:
    """Check if text contains a keyword, with word-boundary awareness for short needles."""
    if len(needle) <= 3:
        return bool(re.search(r"\b" + re.escape(needle) + r"\b", text, re.IGNORECASE))
    return needle.lower() in text


class PatternMatcher:
    """Matches cluster text against known build patterns (zero LLM cost).

    Loads from `news_pattern_library` table and uses keyword overlap scoring.
    Can seed the library with canonical patterns from PatternRegistry.
    """

    def __init__(self) -> None:
        # pattern_name_lower -> {id, pattern_name, category, mention_count, canonical}
        self._db_patterns: Dict[str, Dict[str, Any]] = {}
        self._loaded = False

    async def load(self, conn: "asyncpg.Connection", region: str = "global") -> None:
        """Load pattern library from DB."""
        if region == "turkey":
            region_filter = "region IN ('global', 'turkey')"
        else:
            region_filter = "region = 'global'"

        rows = await conn.fetch(
            f"""SELECT id::text, pattern_name, pattern_category, canonical,
                       mention_count, last_seen_at
                FROM news_pattern_library
                WHERE {region_filter}"""
        )
        self._db_patterns.clear()
        for row in rows:
            self._db_patterns[row["pattern_name"].lower()] = {
                "id": row["id"],
                "pattern_name": row["pattern_name"],
                "category": row["pattern_category"],
                "mention_count": row["mention_count"] or 0,
                "canonical": row["canonical"],
            }
        self._loaded = True
        logger.info("PatternMatcher loaded (%s): %d patterns", region, len(self._db_patterns))

    def match(
        self, title: str, summary: str, topic_tags: Sequence[str]
    ) -> List[Tuple[str, float]]:
        """Return (pattern_name, match_score) for patterns matching the text.

        Uses keyword overlap scoring: score = matched_keywords / total_keywords.
        Returns patterns with score >= 0.25 (at least 2 keywords for most patterns).
        """
        text = f"{title} {summary}".lower()
        tag_set = {t.lower() for t in topic_tags}
        matches: List[Tuple[str, float]] = []

        for pattern_name, keywords in _PATTERN_KEYWORDS.items():
            matched = sum(1 for kw in keywords if _text_contains(text, kw))
            # Bonus for topic_tag matches
            pattern_tokens = {t.lower() for t in pattern_name.split() if len(t) > 2}
            tag_overlap = len(tag_set & pattern_tokens)
            total = len(keywords)
            score = (matched + tag_overlap * 0.5) / total if total else 0

            if score >= 0.25:
                matches.append((pattern_name, round(score, 3)))

        matches.sort(key=lambda x: x[1], reverse=True)
        return matches

    def get_novelty_score(self, pattern_name: str) -> int:
        """Return novelty score (0-5) based on mention_count in the library."""
        db_entry = self._db_patterns.get(pattern_name.lower())
        if not db_entry:
            return 5  # Never seen in library
        count = db_entry["mention_count"]
        if count < 3:
            return 4  # Emerging
        if count <= 10:
            return 3  # Growing
        if count <= 30:
            return 2  # Established
        return 1  # Well-known

    async def update_counts(
        self,
        conn: "asyncpg.Connection",
        matches: Sequence[Tuple[str, float]],
        cluster_id: str,
        region: str = "global",
    ) -> None:
        """Increment mention_count and append cluster_id to example_cluster_ids."""
        for pattern_name, _score in matches:
            db_entry = self._db_patterns.get(pattern_name.lower())
            if db_entry:
                await conn.execute(
                    """
                    UPDATE news_pattern_library
                    SET mention_count = mention_count + 1,
                        last_seen_at = NOW(),
                        example_cluster_ids = (
                            SELECT ARRAY(SELECT UNNEST(example_cluster_ids) UNION SELECT $2::uuid)
                        )[:10],
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    """,
                    db_entry["id"],
                    cluster_id,
                )
            else:
                # New pattern discovered — insert it
                await conn.execute(
                    """
                    INSERT INTO news_pattern_library (
                        pattern_name, pattern_category, canonical,
                        mention_count, example_cluster_ids, region, last_seen_at
                    ) VALUES ($1, $2, FALSE, 1, ARRAY[$3::uuid], $4, NOW())
                    ON CONFLICT (pattern_name, region) DO UPDATE
                    SET mention_count = news_pattern_library.mention_count + 1,
                        last_seen_at = NOW(),
                        example_cluster_ids = (
                            SELECT ARRAY(SELECT UNNEST(news_pattern_library.example_cluster_ids) UNION SELECT $3::uuid)
                        )[:10],
                        updated_at = NOW()
                    """,
                    pattern_name,
                    _PATTERN_CATEGORIES.get(pattern_name),
                    cluster_id,
                    region,
                )

    async def seed_canonical_patterns(self, conn: "asyncpg.Connection", region: str = "global") -> int:
        """Seed news_pattern_library with the 20 canonical patterns. Returns count inserted."""
        count = 0
        for name in _PATTERN_KEYWORDS:
            category = _PATTERN_CATEGORIES.get(name)
            result = await conn.execute(
                """
                INSERT INTO news_pattern_library (
                    pattern_name, pattern_category, canonical, mention_count, region
                ) VALUES ($1, $2, TRUE, 0, $3)
                ON CONFLICT (pattern_name, region) DO NOTHING
                """,
                name, category, region,
            )
            if result and "INSERT" in result:
                count += 1
        logger.info("Seeded %d canonical patterns for region=%s", count, region)
        return count


# ---------------------------------------------------------------------------
# GTMClassifier — keyword-based go-to-market classification (zero LLM)
# ---------------------------------------------------------------------------

# Keyword anchors for GTM tags. Each tag maps to identifying keywords.
_GTM_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    # developer-platform
    "api-first": ("api", "endpoint", "rest api", "graphql", "webhook"),
    "sdk": ("sdk", "client library", "developer kit"),
    "cli-tool": ("cli", "command line", "terminal"),
    "open-source-core": ("open source", "open-source", "github", "apache license", "mit license", "oss"),
    "developer-marketplace": ("plugin", "extension", "app store", "marketplace"),
    # enterprise-saas
    "vertical-saas": ("vertical", "industry-specific", "healthcare ai", "legal ai", "fintech ai"),
    "horizontal-platform": ("platform", "all-in-one", "suite"),
    "usage-based": ("usage-based", "pay-per-use", "metered", "credits", "per token"),
    "seat-based": ("per seat", "per user", "team plan", "enterprise plan"),
    # infrastructure
    "managed-service": ("managed", "fully-managed", "serverless", "hosted"),
    "self-hosted": ("self-hosted", "on-premise", "on-prem", "docker", "helm"),
    "edge-deployment": ("edge", "on-device", "mobile inference", "local model"),
    "cloud-native": ("cloud-native", "kubernetes", "k8s", "aws", "gcp", "azure"),
    # marketplace
    "two-sided-marketplace": ("marketplace", "buyer", "seller", "listing"),
    "data-marketplace": ("data marketplace", "dataset", "data exchange"),
    "model-marketplace": ("model hub", "model marketplace", "hugging face"),
    # embedded-ai
    "copilot": ("copilot", "assistant", "co-pilot", "pair programming"),
    "workflow-automation": ("workflow", "automation", "no-code", "low-code", "automate"),
    "decision-support": ("decision support", "recommendation", "advisory"),
    # consumer
    "freemium": ("free tier", "freemium", "free plan", "starter"),
    "subscription": ("subscription", "monthly plan", "annual plan"),
}

# Parent category mapping.
_GTM_PARENT: Dict[str, str] = {
    "api-first": "developer-platform",
    "sdk": "developer-platform",
    "cli-tool": "developer-platform",
    "open-source-core": "developer-platform",
    "developer-marketplace": "developer-platform",
    "vertical-saas": "enterprise-saas",
    "horizontal-platform": "enterprise-saas",
    "usage-based": "enterprise-saas",
    "seat-based": "enterprise-saas",
    "managed-service": "infrastructure",
    "self-hosted": "infrastructure",
    "edge-deployment": "infrastructure",
    "cloud-native": "infrastructure",
    "two-sided-marketplace": "marketplace",
    "data-marketplace": "marketplace",
    "model-marketplace": "marketplace",
    "copilot": "embedded-ai",
    "workflow-automation": "embedded-ai",
    "decision-support": "embedded-ai",
    "freemium": "consumer",
    "subscription": "consumer",
}

# Delivery model keywords.
_DELIVERY_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "api": ("api", "endpoint", "rest", "graphql"),
    "saas": ("saas", "cloud", "web app", "dashboard"),
    "marketplace": ("marketplace", "app store"),
    "open-source": ("open source", "open-source", "github"),
    "embedded": ("embedded", "sdk", "library", "widget"),
    "managed": ("managed service", "fully managed", "serverless"),
}


class GTMClassifier:
    """Classify cluster GTM model and delivery approach from text signals (zero LLM cost)."""

    def __init__(self) -> None:
        # tag -> {id, mention_count}
        self._db_taxonomy: Dict[str, Dict[str, Any]] = {}
        self._loaded = False

    async def load(self, conn: "asyncpg.Connection", region: str = "global") -> None:
        """Load GTM taxonomy from DB."""
        if region == "turkey":
            region_filter = "region IN ('global', 'turkey')"
        else:
            region_filter = "region = 'global'"

        rows = await conn.fetch(
            f"""SELECT id::text, tag, parent_tag, mention_count
                FROM news_gtm_taxonomy WHERE {region_filter}"""
        )
        self._db_taxonomy.clear()
        for row in rows:
            self._db_taxonomy[row["tag"]] = {
                "id": row["id"],
                "parent_tag": row["parent_tag"],
                "mention_count": row["mention_count"] or 0,
            }
        self._loaded = True
        logger.info("GTMClassifier loaded (%s): %d tags", region, len(self._db_taxonomy))

    def classify(self, title: str, summary: str) -> Tuple[List[str], Optional[str]]:
        """Classify cluster into GTM tags and delivery model.

        Returns: (list of matching GTM tags, delivery_model or None).
        """
        text = f"{title} {summary}".lower()
        tags: List[str] = []

        for tag, keywords in _GTM_KEYWORDS.items():
            if any(_text_contains(text, kw) for kw in keywords):
                tags.append(tag)

        # Delivery model
        delivery_model: Optional[str] = None
        best_delivery_score = 0
        for model, keywords in _DELIVERY_KEYWORDS.items():
            score = sum(1 for kw in keywords if _text_contains(text, kw))
            if score > best_delivery_score:
                best_delivery_score = score
                delivery_model = model

        return tags, delivery_model

    def get_uniqueness_score(self, tags: Sequence[str]) -> int:
        """Return GTM uniqueness score (0-5) based on tag novelty."""
        if not tags:
            return 0

        best = 1  # At least some GTM signal
        for tag in tags:
            db_entry = self._db_taxonomy.get(tag)
            if not db_entry:
                best = max(best, 4)  # Novel tag
            elif db_entry["mention_count"] < 5:
                best = max(best, 3)
            elif db_entry["mention_count"] < 20:
                best = max(best, 2)

        # Multi-model GTM bonus
        if len(tags) >= 3:
            best = min(5, best + 1)

        return min(5, best)

    async def update_counts(
        self,
        conn: "asyncpg.Connection",
        tags: Sequence[str],
        region: str = "global",
    ) -> None:
        """Increment mention_count for matched tags."""
        for tag in tags:
            db_entry = self._db_taxonomy.get(tag)
            if db_entry:
                await conn.execute(
                    "UPDATE news_gtm_taxonomy SET mention_count = mention_count + 1, updated_at = NOW() WHERE id = $1::uuid",
                    db_entry["id"],
                )
            else:
                parent = _GTM_PARENT.get(tag)
                await conn.execute(
                    """
                    INSERT INTO news_gtm_taxonomy (tag, parent_tag, mention_count, region)
                    VALUES ($1, $2, 1, $3)
                    ON CONFLICT (tag, region) DO UPDATE
                    SET mention_count = news_gtm_taxonomy.mention_count + 1, updated_at = NOW()
                    """,
                    tag, parent, region,
                )

    async def seed_taxonomy(self, conn: "asyncpg.Connection", region: str = "global") -> int:
        """Seed news_gtm_taxonomy with the initial taxonomy. Returns count inserted."""
        count = 0
        for tag, parent in _GTM_PARENT.items():
            result = await conn.execute(
                """
                INSERT INTO news_gtm_taxonomy (tag, parent_tag, mention_count, region)
                VALUES ($1, $2, 0, $3)
                ON CONFLICT (tag, region) DO NOTHING
                """,
                tag, parent, region,
            )
            if result and "INSERT" in result:
                count += 1
        # Also insert parent categories
        parents = set(_GTM_PARENT.values())
        for parent in parents:
            result = await conn.execute(
                """
                INSERT INTO news_gtm_taxonomy (tag, parent_tag, mention_count, region)
                VALUES ($1, NULL, 0, $2)
                ON CONFLICT (tag, region) DO NOTHING
                """,
                parent, region,
            )
            if result and "INSERT" in result:
                count += 1
        logger.info("Seeded %d GTM taxonomy tags for region=%s", count, region)
        return count


# ---------------------------------------------------------------------------
# HeuristicScorer — 4-dimension scoring rubric (zero LLM cost)
# ---------------------------------------------------------------------------

@dataclass
class GatingScores:
    """Scores from the heuristic scorer."""
    builder_insight: int = 0
    pattern_novelty: int = 0
    gtm_uniqueness: int = 0
    evidence_quality: int = 0
    community_signal: float = 0.0
    composite: float = 0.0
    boosts: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "builder_insight": self.builder_insight,
            "pattern_novelty": self.pattern_novelty,
            "gtm_uniqueness": self.gtm_uniqueness,
            "evidence_quality": self.evidence_quality,
            "community_signal": round(self.community_signal, 2),
            "composite": round(self.composite, 3),
            "boosts": self.boosts,
        }


class HeuristicScorer:
    """Compute 5-dimension scores for a cluster using heuristics only.

    Scores:
    - Builder Insight (BIS): 0-5
    - Pattern Novelty (PNS): 0-5
    - GTM Uniqueness (GUS): 0-5
    - Evidence Quality (EQS): 0-5
    - Community Signal (CSS): 0-5
    - Composite: weighted blend + thesis boosts
    """

    # Composite weights (sum to 1.0)
    W_BIS = 0.30
    W_PNS = 0.22
    W_EQS = 0.22
    W_GUS = 0.13
    W_CSS = 0.13

    def score(
        self,
        *,
        story_type: str,
        topic_tags: Sequence[str],
        source_count: int,
        trust_score: float,
        source_credibility: float,
        memory_result: Optional[MemoryResult],
        patterns: Sequence[Tuple[str, float]],
        gtm_tags: Sequence[str],
        pattern_matcher: PatternMatcher,
        gtm_classifier: GTMClassifier,
        signal_aggregator: Optional[Any] = None,
        cluster_id: Optional[str] = None,
        source_key: Optional[str] = None,
    ) -> GatingScores:
        """Compute all scores for a cluster."""
        bis = self._score_builder_insight(
            story_type=story_type,
            topic_tags=topic_tags,
            memory_result=memory_result,
            patterns=patterns,
        )
        pns = self._score_pattern_novelty(patterns, pattern_matcher)
        gus = gtm_classifier.get_uniqueness_score(gtm_tags)
        eqs = self._score_evidence_quality(
            source_count=source_count,
            trust_score=trust_score,
            memory_result=memory_result,
        )
        css = self._score_community_signal(
            cluster_id=cluster_id,
            topic_tags=topic_tags,
            source_key=source_key,
            signal_aggregator=signal_aggregator,
        )

        # Composite + thesis boosts
        base = (
            bis * self.W_BIS
            + pns * self.W_PNS
            + eqs * self.W_EQS
            + gus * self.W_GUS
            + css * self.W_CSS
        )
        boosts: Dict[str, float] = {}

        if memory_result and memory_result.has_contradictions:
            boosts["contradiction"] = 1.0

        if memory_result:
            new_on_known = any(
                fc.status == "new_fact" and fc.claim.entity_name
                and any(
                    le.startup_id
                    for le in memory_result.linked_entities
                    if le.entity_name.lower() == (fc.claim.entity_name or "").lower()
                )
                for fc in memory_result.fact_comparisons
            )
            if new_on_known:
                boosts["new_fact_known_entity"] = 0.5

        if source_credibility >= 0.85:
            boosts["high_credibility"] = 0.3

        total_boost = min(2.0, sum(boosts.values()))
        composite = min(5.0, base + total_boost)

        return GatingScores(
            builder_insight=bis,
            pattern_novelty=pns,
            gtm_uniqueness=gus,
            evidence_quality=eqs,
            community_signal=css,
            composite=composite,
            boosts=boosts,
        )

    def _score_community_signal(
        self,
        *,
        cluster_id: Optional[str],
        topic_tags: Sequence[str],
        source_key: Optional[str],
        signal_aggregator: Optional[Any],
    ) -> float:
        """Community Signal Score (0-5). Uses historical signal data."""
        if not signal_aggregator or not getattr(signal_aggregator, "loaded", False):
            return 2.5  # Neutral default when no signal data

        score = 2.5  # Start neutral

        # Direct cluster signal (strongest signal)
        if cluster_id:
            css = signal_aggregator.cluster_signal_score(cluster_id)
            if css > 0.7:
                score += 1.5
            elif css > 0.5:
                score += 0.5
            elif css > 0 and css < 0.3:
                score -= 1.0

        # Topic signal (weaker, aggregate)
        topic_scores = [signal_aggregator.topic_signal_strength(t) for t in topic_tags]
        if topic_scores:
            avg_topic = sum(topic_scores) / len(topic_scores)
            score += (avg_topic - 0.5) * 1.0  # ±0.5 max

        # Source signal (moderate)
        if source_key:
            src = signal_aggregator.source_signal_quality(source_key)
            score += (src - 0.5) * 0.5  # ±0.25 max

        return max(0.0, min(5.0, score))

    def _score_builder_insight(
        self,
        *,
        story_type: str,
        topic_tags: Sequence[str],
        memory_result: Optional[MemoryResult],
        patterns: Sequence[Tuple[str, float]],
    ) -> int:
        score = 1  # Baseline: tangential
        tag_set = {t.lower() for t in topic_tags}

        # Story type signals
        if story_type == "launch":
            score += 1
        if story_type == "funding" and memory_result and any(
            c.fact_key == "funding_amount" for c in memory_result.extracted_claims
        ):
            score += 1

        # Pattern match = actionable insight
        if patterns:
            score += 1

        # Concrete claims extracted (not just PR)
        if memory_result and len(memory_result.extracted_claims) >= 2:
            score += 1

        # AI tag
        if "ai" in tag_set or "machine learning" in tag_set:
            score = max(score, 2)

        return min(5, score)

    def _score_pattern_novelty(
        self,
        patterns: Sequence[Tuple[str, float]],
        pattern_matcher: PatternMatcher,
    ) -> int:
        if not patterns:
            return 0
        return max(pattern_matcher.get_novelty_score(name) for name, _ in patterns)

    def _score_evidence_quality(
        self,
        *,
        source_count: int,
        trust_score: float,
        memory_result: Optional[MemoryResult],
    ) -> int:
        score = 0

        # Source diversity
        if source_count >= 1:
            score += 1
        if source_count >= 3:
            score += 1

        # Concrete claims
        if memory_result:
            claims = memory_result.extracted_claims
            if any(c.fact_key == "funding_amount" for c in claims):
                score += 1
            if any(c.fact_key == "valuation" for c in claims):
                score += 1

            # Memory confirmation
            confirmations = sum(
                1 for fc in memory_result.fact_comparisons if fc.status == "confirmation"
            )
            if confirmations >= 1:
                score += 1

        # Trust score
        if trust_score >= 0.75:
            score += 1

        return min(5, score)


# ---------------------------------------------------------------------------
# GatingRouter — threshold-based bucket routing
# ---------------------------------------------------------------------------

# Default gating thresholds (tunable via calibration).
DEFAULT_GATING_THRESHOLDS = {
    "publish": 3.2,
    "borderline_low": 2.8,   # borderline band: 2.8 to publish
    "watchlist": 2.0,
    "accumulate": 1.0,
}


class GatingRouter:
    """Route clusters to decision buckets based on composite score.

    Buckets: publish, borderline, watchlist, accumulate, drop.
    """

    def __init__(self, thresholds: Optional[Dict[str, float]] = None) -> None:
        self._t = thresholds or dict(DEFAULT_GATING_THRESHOLDS)

    def decide(self, composite: float) -> str:
        """Return gating decision based on composite score."""
        if composite >= self._t["publish"]:
            return "publish"
        if composite >= self._t["borderline_low"]:
            return "borderline"
        if composite >= self._t["watchlist"]:
            return "watchlist"
        if composite >= self._t["accumulate"]:
            return "accumulate"
        return "drop"

    def decide_with_reason(self, scores: GatingScores) -> Tuple[str, str]:
        """Return (decision, reason) with a human-readable explanation."""
        decision = self.decide(scores.composite)
        parts: List[str] = []

        if scores.builder_insight >= 4:
            parts.append("high builder insight")
        if scores.evidence_quality >= 4:
            parts.append("strong evidence")
        if scores.pattern_novelty >= 4:
            parts.append("novel pattern")
        if scores.community_signal >= 4.0:
            parts.append("community-endorsed")
        elif scores.community_signal <= 1.0:
            parts.append("community-rejected")
        if scores.boosts.get("contradiction"):
            parts.append("contradiction detected")
        if scores.boosts.get("new_fact_known_entity"):
            parts.append("new fact on known entity")

        if not parts:
            if decision == "drop":
                parts.append("low signal across all dimensions")
            elif decision == "accumulate":
                parts.append("pattern-only signal")
            else:
                parts.append("moderate signal")

        reason = f"{decision}: {', '.join(parts)} (composite={scores.composite:.2f})"
        return decision, reason


# ---------------------------------------------------------------------------
# Narrative-dup detection
# ---------------------------------------------------------------------------

def detect_narrative_dup(
    *,
    entity_name: Optional[str],
    story_type: str,
    published_at: Any,  # datetime
    existing_decisions: Sequence[Dict[str, Any]],
) -> Optional[str]:
    """Check if this cluster is a narrative duplicate of an existing one.

    A narrative dup is: same primary entity + same story_type + within 48h.
    Returns the cluster_id of the original, or None.
    """
    if not entity_name:
        return None

    entity_lower = entity_name.lower()
    for existing in existing_decisions:
        if not existing.get("primary_entity"):
            continue
        if existing["primary_entity"].lower() != entity_lower:
            continue
        if existing.get("story_type") != story_type:
            continue
        existing_time = existing.get("published_at")
        if existing_time and published_at:
            try:
                delta_h = abs((published_at - existing_time).total_seconds()) / 3600
                if delta_h > 48:
                    continue
            except (TypeError, AttributeError):
                continue
        return existing.get("cluster_id")

    return None
