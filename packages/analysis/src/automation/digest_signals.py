"""Signal intelligence context for the daily email digest.

Fetches top signals by momentum, maps clusters to linked signals,
and optionally generates an LLM narrative connecting stories to trends.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from src.automation.json_utils import ensure_json_object

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class DigestSignal:
    id: str
    domain: str
    cluster_name: Optional[str]
    claim: str
    status: str  # candidate/emerging/accelerating/established/decaying
    conviction: float
    momentum: float
    impact: float
    evidence_count: int
    unique_company_count: int
    lifecycle_transition: Optional[str] = None  # e.g. "emerging → accelerating"
    transition_recency: Optional[str] = None    # e.g. "2d ago"


@dataclass
class DigestSignalContext:
    top_signals: List[DigestSignal]                                  # Top 3-5 by momentum
    cluster_signal_map: Dict[str, List[DigestSignal]] = field(default_factory=dict)  # cluster_id → linked signals
    narrative: Optional[str] = None                                  # LLM-generated paragraph
    new_transitions: List[DigestSignal] = field(default_factory=list)  # Signals with transitions in last 48h


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_lifecycle_transition(
    metadata_json: Any,
    *,
    cutoff: datetime,
) -> tuple[Optional[str], Optional[str]]:
    """Extract the most recent lifecycle transition from metadata_json if within cutoff."""
    if not metadata_json:
        return None, None
    meta = ensure_json_object(metadata_json)
    transitions = meta.get("lifecycle_transitions", [])
    if not transitions:
        return None, None

    now = datetime.now(timezone.utc)
    for t in reversed(transitions):  # newest last in the list
        at_str = t.get("at")
        if not at_str:
            continue
        try:
            at = datetime.fromisoformat(at_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        if at >= cutoff:
            from_s = t.get("from", "?")
            to_s = t.get("to", "?")
            delta = now - at
            if delta.days >= 1:
                recency = f"{delta.days}d ago"
            else:
                hours = max(1, int(delta.total_seconds() // 3600))
                recency = f"{hours}h ago"
            return f"{from_s} → {to_s}", recency
    return None, None


def _row_to_digest_signal(row: Any, *, cutoff: datetime) -> DigestSignal:
    """Convert an asyncpg Record to DigestSignal."""
    transition, recency = _extract_lifecycle_transition(
        row.get("metadata_json") if hasattr(row, "get") else row["metadata_json"],
        cutoff=cutoff,
    )
    return DigestSignal(
        id=str(row["id"]),
        domain=str(row["domain"]),
        cluster_name=row["cluster_name"],
        claim=str(row["claim"]),
        status=str(row["status"]),
        conviction=float(row["conviction"]),
        momentum=float(row["momentum"]),
        impact=float(row["impact"]),
        evidence_count=int(row["evidence_count"]),
        unique_company_count=int(row["unique_company_count"]),
        lifecycle_transition=transition,
        transition_recency=recency,
    )


# ---------------------------------------------------------------------------
# DB queries
# ---------------------------------------------------------------------------

async def _fetch_top_signals(
    conn: Any,
    *,
    region: str,
    limit: int = 5,
) -> List[DigestSignal]:
    """Fetch top signals by momentum for the Signal Radar section."""
    rows = await conn.fetch(
        """
        SELECT id::text, domain, cluster_name, claim, status,
               conviction, momentum, impact,
               evidence_count, unique_company_count,
               first_seen_at, metadata_json
        FROM signals
        WHERE region = $1 AND status IN ('emerging', 'accelerating')
        ORDER BY momentum DESC, conviction DESC
        LIMIT $2
        """,
        region,
        limit,
    )
    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
    return [_row_to_digest_signal(r, cutoff=cutoff) for r in rows]


async def _fetch_cluster_signal_map(
    conn: Any,
    *,
    cluster_ids: List[str],
    region: str,
) -> Dict[str, List[DigestSignal]]:
    """Map each cluster_id to its linked non-decaying signals."""
    if not cluster_ids:
        return {}
    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (se.cluster_id, s.id)
               se.cluster_id::text, s.id::text AS id,
               s.domain, s.cluster_name, s.claim, s.status,
               s.conviction, s.momentum, s.impact,
               s.evidence_count, s.unique_company_count,
               s.metadata_json
        FROM signal_evidence se
        JOIN signals s ON s.id = se.signal_id
        WHERE se.cluster_id = ANY($1::uuid[])
          AND s.region = $2
          AND s.status != 'decaying'
        ORDER BY se.cluster_id, s.id
        """,
        cluster_ids,
        region,
    )
    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
    mapping: Dict[str, List[DigestSignal]] = {}
    for r in rows:
        cid = str(r["cluster_id"])
        sig = _row_to_digest_signal(r, cutoff=cutoff)
        mapping.setdefault(cid, []).append(sig)
    return mapping


async def fetch_cluster_ids_for_edition(
    conn: Any,
    edition_date: Any,
    *,
    region: str,
    limit: int = 10,
) -> List[str]:
    """Get the top_cluster_ids array from a daily edition."""
    row = await conn.fetchrow(
        """
        SELECT top_cluster_ids
        FROM news_daily_editions
        WHERE edition_date = $1::date AND region = $2
        """,
        edition_date,
        region,
    )
    if not row or not row["top_cluster_ids"]:
        return []
    ids = row["top_cluster_ids"]
    return [str(cid) for cid in ids[:limit]]


# ---------------------------------------------------------------------------
# LLM narrative
# ---------------------------------------------------------------------------

async def _generate_signal_narrative(
    azure_client: Any,
    model_name: str,
    top_signals: List[DigestSignal],
    story_titles: List[str],
) -> Optional[str]:
    """Generate a short narrative connecting today's stories to signal trends."""
    if not azure_client or not top_signals:
        return None

    from src.config import llm_kwargs

    signals_text = "\n".join(
        f"- [{s.status.upper()}] {s.claim} (momentum={s.momentum:.2f}, "
        f"companies={s.unique_company_count})"
        for s in top_signals
    )
    stories_text = "\n".join(f"- {t}" for t in story_titles[:10])

    system_prompt = (
        "You write concise, insightful signal intelligence for startup builders. "
        "Connect today's stories to the broader trend signals below. "
        "Write 2-4 sentences. Be specific — reference signal names and story themes. "
        "Do NOT use bullet points. Output only the paragraph, no preamble."
    )
    user_prompt = (
        f"Today's top stories:\n{stories_text}\n\n"
        f"Active signals:\n{signals_text}\n\n"
        "Write a short Signal Radar paragraph for the daily digest email."
    )

    try:
        kwargs = llm_kwargs(model_name, max_tokens=300)
        response = await azure_client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            **kwargs,
        )
        text = response.choices[0].message.content
        return text.strip() if text else None
    except Exception as exc:
        logger.warning("Signal narrative LLM call failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def load_digest_signal_context(
    conn: Any,
    *,
    region: str,
    cluster_ids: List[str],
    max_signals: int = 5,
    azure_client: Any = None,
    model_name: Optional[str] = None,
    story_titles: Optional[List[str]] = None,
) -> Optional[DigestSignalContext]:
    """Load all signal context needed for the digest email.

    Returns None if no signals exist or feature is disabled upstream.
    """
    top_signals = await _fetch_top_signals(conn, region=region, limit=max_signals)
    if not top_signals:
        return None

    cluster_signal_map = await _fetch_cluster_signal_map(
        conn, cluster_ids=cluster_ids, region=region,
    )

    # Narrative (best-effort LLM call)
    narrative: Optional[str] = None
    if azure_client and model_name and story_titles:
        narrative = await _generate_signal_narrative(
            azure_client, model_name, top_signals, story_titles,
        )

    # Signals with recent transitions
    new_transitions = [s for s in top_signals if s.lifecycle_transition]

    return DigestSignalContext(
        top_signals=top_signals,
        cluster_signal_map=cluster_signal_map,
        narrative=narrative,
        new_transitions=new_transitions,
    )
