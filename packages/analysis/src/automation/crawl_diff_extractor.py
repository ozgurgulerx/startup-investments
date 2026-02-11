"""Crawl Diff Event Extractor.

Performs heuristic diff analysis when website_monitor detects a content change.
Compares the new page text against the stored last_content_sample to extract
structured events: pricing changes, product launches, hiring signals, open-source
announcements.

Zero LLM cost — uses keyword/regex matching on the textual diff.

Integration: called from WebsiteContentMonitor._monitor_startup() when
content_changed = True. Events are persisted with source_type='crawl_diff'
and picked up by the next signal aggregation run.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class CrawlDiffEvent:
    """A structured event extracted from a website content diff."""
    event_type: str           # Must match event_registry.event_type
    confidence: float         # 0.0 - 1.0
    startup_id: Optional[str] = None
    entity_name: Optional[str] = None
    snippet: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Keyword patterns by event type
# ---------------------------------------------------------------------------

# Pricing page signals → gtm_pricing_changed / gtm_enterprise_tier_launched
_PRICING_KEYWORDS = [
    r"\bpricing\b", r"\bprice\b", r"\bplan[s]?\b", r"\btier[s]?\b",
    r"\bsubscription[s]?\b", r"\bfree\s+trial\b", r"\benterprise\s+plan\b",
    r"\bpro\s+plan\b", r"\bstarter\s+plan\b", r"\bper\s+month\b",
    r"\bper\s+seat\b", r"\bper\s+user\b", r"\$/mo\b", r"\$/yr\b",
]
_PRICING_RE = re.compile("|".join(_PRICING_KEYWORDS), re.IGNORECASE)

_ENTERPRISE_KEYWORDS = [
    r"\benterprise\b", r"\bcustom\s+pricing\b", r"\bcontact\s+sales\b",
    r"\bsso\b", r"\bsla\b", r"\bsoc\s*2\b", r"\bhipaa\b",
    r"\bdedicated\s+support\b", r"\bon-prem(?:ise)?\b",
]
_ENTERPRISE_RE = re.compile("|".join(_ENTERPRISE_KEYWORDS), re.IGNORECASE)

# Product launch signals → prod_launched / prod_major_update
_LAUNCH_KEYWORDS = [
    r"\blaunching\b", r"\bjust\s+launched\b", r"\bnow\s+available\b",
    r"\bintroducing\b", r"\bannouncing\b", r"\bbeta\b", r"\bga\b",
    r"\bgeneral\s+availability\b", r"\bv\d+\.\d+\b", r"\brelease\b",
    r"\bnew\s+feature\b", r"\bwhat'?s\s+new\b", r"\bchangelog\b",
    r"\bupdate[sd]?\b",
]
_LAUNCH_RE = re.compile("|".join(_LAUNCH_KEYWORDS), re.IGNORECASE)

# Hiring signals → org_key_hire
_HIRING_KEYWORDS = [
    r"\bwe'?re\s+hiring\b", r"\bjoin\s+(?:our|the)\s+team\b",
    r"\bopen\s+(?:roles?|positions?)\b", r"\bcareers?\b",
    r"\bhead\s+of\b", r"\bvp\s+of\b", r"\bchief\b",
    r"\bcto\b", r"\bcmo\b", r"\bcfo\b", r"\bcoo\b",
]
_HIRING_RE = re.compile("|".join(_HIRING_KEYWORDS), re.IGNORECASE)

# Open-source signals → arch_open_sourced
_OPEN_SOURCE_KEYWORDS = [
    r"\bopen[\s-]?source[d]?\b", r"\bgithub\.com\b",
    r"\bmit\s+license\b", r"\bapache\s+license\b",
    r"\bstar\s+us\s+on\s+github\b", r"\bcontribut(?:e|ing|or)\b",
    r"\bself[\s-]?host(?:ed)?\b",
]
_OPEN_SOURCE_RE = re.compile("|".join(_OPEN_SOURCE_KEYWORDS), re.IGNORECASE)


# ---------------------------------------------------------------------------
# Differ
# ---------------------------------------------------------------------------

def _compute_added_text(old_text: str, new_text: str) -> str:
    """Compute a rough 'added text' by finding lines in new_text not in old_text.

    This is a simplified diff — we split into sentences/phrases and find
    what's new. Not line-by-line (web text isn't line-structured), but
    chunk-by-chunk (split on sentence boundaries).
    """
    old_chunks = set(_split_chunks(old_text))
    new_chunks = _split_chunks(new_text)
    added = [c for c in new_chunks if c not in old_chunks]
    return " ".join(added)


def _split_chunks(text: str) -> List[str]:
    """Split text into sentence-like chunks for comparison."""
    # Split on sentence boundaries (. ! ? ;) and newlines
    parts = re.split(r'[.!?;\n]+', text)
    # Normalize whitespace and filter short chunks
    return [" ".join(p.split()).lower() for p in parts if len(p.strip()) > 20]


# ---------------------------------------------------------------------------
# CrawlDiffExtractor
# ---------------------------------------------------------------------------

class CrawlDiffExtractor:
    """Extract structured events from website content diffs.

    Compares old content sample vs new content sample using keyword
    pattern matching on the added text.
    """

    def __init__(self) -> None:
        self._registry: Dict[str, str] = {}   # event_type → registry_id
        self._loaded = False

    async def load(self, conn: "asyncpg.Connection") -> None:
        """Load active event types from event_registry."""
        rows = await conn.fetch(
            "SELECT id::text, event_type FROM event_registry WHERE active = TRUE"
        )
        self._registry = {row["event_type"]: row["id"] for row in rows}
        self._loaded = True

    def extract_from_diff(
        self,
        old_text: Optional[str],
        new_text: str,
        startup_id: Optional[str] = None,
        startup_name: Optional[str] = None,
    ) -> List[CrawlDiffEvent]:
        """Analyze content diff and extract structured events.

        Args:
            old_text: Previous content sample (None if first crawl)
            new_text: Current content text (first 2000 chars)
            startup_id: UUID of the startup, if known
            startup_name: Human-readable name

        Returns:
            List of CrawlDiffEvent (may be empty)
        """
        if not old_text or not new_text:
            return []

        added = _compute_added_text(old_text, new_text)
        if not added:
            return []

        events: List[CrawlDiffEvent] = []
        seen_types: set = set()

        # --- Pricing / Enterprise tier ---
        pricing_matches = _PRICING_RE.findall(added)
        if pricing_matches:
            enterprise_matches = _ENTERPRISE_RE.findall(added)
            if enterprise_matches:
                event_type = "gtm_enterprise_tier_launched"
                confidence = min(0.5 + 0.05 * len(enterprise_matches), 0.85)
            else:
                event_type = "gtm_pricing_changed"
                confidence = min(0.4 + 0.05 * len(pricing_matches), 0.75)

            if event_type in self._registry and event_type not in seen_types:
                snippet_text = added[:200]
                events.append(CrawlDiffEvent(
                    event_type=event_type,
                    confidence=confidence,
                    startup_id=startup_id,
                    entity_name=startup_name,
                    snippet=snippet_text,
                    metadata={
                        "source": "crawl_diff",
                        "pricing_signals": pricing_matches[:5],
                        "enterprise_signals": enterprise_matches[:5] if enterprise_matches else [],
                    },
                ))
                seen_types.add(event_type)

        # --- Product launch / major update ---
        launch_matches = _LAUNCH_RE.findall(added)
        if launch_matches:
            # Distinguish launch vs update by keyword specificity
            launch_specific = any(
                re.search(r"\blaunching|just\s+launched|now\s+available|introducing|announcing", m, re.IGNORECASE)
                for m in launch_matches
            )
            event_type = "prod_launched" if launch_specific else "prod_major_update"
            confidence = min(0.4 + 0.05 * len(launch_matches), 0.75)

            if event_type in self._registry and event_type not in seen_types:
                events.append(CrawlDiffEvent(
                    event_type=event_type,
                    confidence=confidence,
                    startup_id=startup_id,
                    entity_name=startup_name,
                    snippet=added[:200],
                    metadata={
                        "source": "crawl_diff",
                        "launch_signals": launch_matches[:5],
                    },
                ))
                seen_types.add(event_type)

        # --- Hiring signals ---
        hiring_matches = _HIRING_RE.findall(added)
        if hiring_matches:
            event_type = "org_key_hire"
            confidence = min(0.35 + 0.05 * len(hiring_matches), 0.65)

            if event_type in self._registry and event_type not in seen_types:
                events.append(CrawlDiffEvent(
                    event_type=event_type,
                    confidence=confidence,
                    startup_id=startup_id,
                    entity_name=startup_name,
                    snippet=added[:200],
                    metadata={
                        "source": "crawl_diff",
                        "hiring_signals": hiring_matches[:5],
                    },
                ))
                seen_types.add(event_type)

        # --- Open-source signals ---
        oss_matches = _OPEN_SOURCE_RE.findall(added)
        if oss_matches:
            event_type = "arch_open_sourced"
            confidence = min(0.4 + 0.05 * len(oss_matches), 0.75)

            if event_type in self._registry and event_type not in seen_types:
                events.append(CrawlDiffEvent(
                    event_type=event_type,
                    confidence=confidence,
                    startup_id=startup_id,
                    entity_name=startup_name,
                    snippet=added[:200],
                    metadata={
                        "source": "crawl_diff",
                        "oss_signals": oss_matches[:5],
                    },
                ))
                seen_types.add(event_type)

        return events


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

async def persist_crawl_diff_events(
    conn: "asyncpg.Connection",
    events: List[CrawlDiffEvent],
    registry: Dict[str, str],
) -> int:
    """Persist crawl diff events to startup_events. Returns count inserted."""
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
                        metadata_json, region)
                   VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, 'crawl_diff',
                           $7::jsonb, 'global')""",
                evt.startup_id,
                evt.event_type,
                evt.snippet[:255] if evt.snippet else None,
                evt.snippet,
                registry_id,
                evt.confidence,
                json.dumps(evt.metadata),
            )
            inserted += 1
        except Exception:
            logger.warning(
                "Failed to persist crawl_diff event %s for startup %s",
                evt.event_type, evt.startup_id, exc_info=True,
            )

    return inserted
