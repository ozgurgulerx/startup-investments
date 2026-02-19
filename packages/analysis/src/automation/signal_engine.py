"""Signal aggregation, merging, scoring, and lifecycle management.

Aggregates structured events (from event_extractor.py) into signals —
statistical claims about pattern adoption acceleration.

Uses pgvector for signal merge detection: new candidate claims are embedded
and compared against existing signals via ANN search. Similar claims are
merged as evidence; novel claims create new signals.

Scoring formulas:
  - Conviction = sigmoid(log(1+U) + 0.4*log(1+D) + 0.3*log(1+E))
  - Momentum = (T_recent - T_prev) / max(1, T_prev)
  - Impact = avg(funding_normalized) + enterprise_weight + hyperscaler_bonus
  - Adoption Velocity = d(U)/dt (slope over time)

Lifecycle: candidate → emerging → accelerating → established → decaying

Integration: Called via CLI `python main.py aggregate-signals` or cron job.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Union

from src.automation.json_utils import ensure_json_object

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MERGE_SIMILARITY_THRESHOLD = 0.82
SCORING_LOOKBACK_DAYS = 30
LIFECYCLE_MIN_COMPANIES_EMERGING = 3
LIFECYCLE_MIN_MOMENTUM_ACCELERATING = 0.4
LIFECYCLE_MIN_COMPANIES_ESTABLISHED = 20
LIFECYCLE_DECAYING_MOMENTUM_THRESHOLD = -0.3


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class CandidateSignal:
    """A candidate signal claim to be merged or created."""
    domain: str
    cluster_name: Optional[str]
    claim: str
    region: str
    pattern_id: Optional[str] = None
    evidence_events: List[Dict[str, Any]] = field(default_factory=list)
    unique_companies: set = field(default_factory=set)
    metadata: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Aggregation constants
# ---------------------------------------------------------------------------

MAX_EVIDENCE_PER_SIGNAL = 50


# ---------------------------------------------------------------------------
# Scoring functions
# ---------------------------------------------------------------------------

def compute_conviction(unique_companies: int, source_diversity: int, evidence_count: int) -> float:
    """Conviction = sigmoid(log(1+U) + 0.4*log(1+D) + 0.3*log(1+E)), centered at raw=2."""
    raw = math.log1p(unique_companies) + 0.4 * math.log1p(source_diversity) + 0.3 * math.log1p(evidence_count)
    return 1 / (1 + math.exp(-(raw - 2)))


def compute_momentum(recent_events: int, prev_events: int) -> float:
    """Momentum = (T_recent - T_prev) / max(1, T_prev), clamped to [-1, 1]."""
    if recent_events == 0 and prev_events == 0:
        return 0.0
    delta = (recent_events - prev_events) / max(1, prev_events)
    return max(-1.0, min(1.0, delta))


def compute_impact(funding_amounts: List[float], has_enterprise: bool, has_hyperscaler: bool) -> float:
    """Impact proxy based on funding, enterprise signals, and hyperscaler association."""
    # Funding normalization: log-scale relative to $10M median
    if funding_amounts:
        avg_log_funding = sum(math.log1p(a / 1e6) for a in funding_amounts) / len(funding_amounts)
        funding_score = min(1.0, avg_log_funding / 5.0)  # Normalize: log(1+100M/$1M) ≈ 4.6
    else:
        funding_score = 0.0

    enterprise_weight = 0.2 if has_enterprise else 0.0
    hyperscaler_bonus = 0.1 if has_hyperscaler else 0.0

    return min(1.0, funding_score + enterprise_weight + hyperscaler_bonus)


def compute_adoption_velocity(company_dates: List[Union[date, datetime]]) -> float:
    """d(U)/dt — slope of cumulative unique company count over time.

    Returns companies/day normalized to [0, 1] range. 1.0 ≈ 10+ companies/day.
    """
    if len(company_dates) < 2:
        return 0.0

    sorted_dates = sorted(company_dates)
    time_span_days = max(1, (sorted_dates[-1] - sorted_dates[0]).days)
    raw_velocity = len(company_dates) / time_span_days
    return min(1.0, raw_velocity / 10.0)


# ---------------------------------------------------------------------------
# SignalEngine
# ---------------------------------------------------------------------------

class SignalEngine:
    """Aggregates events into signals, scores them, and manages lifecycle."""

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or os.getenv("DATABASE_URL")
        if not self.database_url:
            raise RuntimeError("DATABASE_URL is required for signal aggregation")
        self.pool: Optional[Any] = None
        self._embedding_service: Optional[Any] = None
        self._has_embedding: bool = False

    async def init(self) -> None:
        """Initialize connection pool and embedding service."""
        import asyncpg
        self.pool = await asyncpg.create_pool(self.database_url, min_size=1, max_size=4)

        # Check if signals table has the embedding vector column (requires pgvector)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'signals'
                     AND column_name = 'embedding'
                     AND udt_name = 'vector'""",
            )
            self._has_embedding = row is not None

        if not self._has_embedding:
            logger.info("signals.embedding column not found (pgvector not enabled) — signal merging disabled")
            self._embedding_service = None
            return

        # Initialize embedding service for signal merge detection
        try:
            from .embedding import EmbeddingService
            azure_client = self._create_azure_client()
            embedding_deployment = os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-small")
            self._embedding_service = EmbeddingService(
                azure_client=azure_client,
                deployment_name=embedding_deployment,
            )
        except Exception as exc:
            logger.warning("Embedding service unavailable (signal merging disabled): %s", exc)
            self._embedding_service = None

    def _create_azure_client(self) -> Optional[Any]:
        """Create Azure OpenAI client for embeddings (same pattern as news_ingest.py)."""
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        if not endpoint:
            return None
        try:
            from openai import AsyncAzureOpenAI
            try:
                from azure.identity.aio import DefaultAzureCredential, get_bearer_token_provider
                credential = DefaultAzureCredential()
                token_provider = get_bearer_token_provider(
                    credential, "https://cognitiveservices.azure.com/.default"
                )
                return AsyncAzureOpenAI(
                    azure_ad_token_provider=token_provider,
                    api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01"),
                    azure_endpoint=endpoint,
                )
            except ImportError:
                api_key = os.getenv("AZURE_OPENAI_API_KEY")
                if api_key:
                    return AsyncAzureOpenAI(
                        api_key=api_key,
                        api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01"),
                        azure_endpoint=endpoint,
                    )
        except ImportError:
            pass
        return None

    async def close(self) -> None:
        if self.pool:
            await self.pool.close()

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def run(self, region: str = "global", lookback_days: int = 30) -> Dict[str, Any]:
        """Full pipeline: aggregate → merge/create → score → lifecycle."""
        await self.init()
        stats: Dict[str, Any] = {"region": region, "lookback_days": lookback_days}

        assert self.pool is not None, "Call init() first"
        async with self.pool.acquire() as conn:
            # 1. Aggregate events into candidate signals
            candidates = await self.aggregate_events(conn, region, lookback_days)
            stats["candidates"] = len(candidates)

            # 2. Merge or create signals
            merged, created = 0, 0
            for candidate in candidates:
                action = await self.merge_or_create(conn, candidate, region)
                if action == "merged":
                    merged += 1
                else:
                    created += 1
            stats["merged"] = merged
            stats["created"] = created

            # 3. Score all active signals
            scored = await self.score_signals(conn, region)
            stats["scored"] = scored

            # 4. Update lifecycle statuses
            transitions = await self.update_lifecycle(conn, region)
            stats["lifecycle_transitions"] = transitions

            # 5. Compute stage-aware context for signals with pattern_id
            stage_enriched = await self.compute_stage_context(conn, region)
            stats["stage_enriched"] = stage_enriched

            # 6. Compute explain_json and evidence_timeline for all signals
            explain_enriched = await self.compute_explain_and_timeline(conn, region)
            stats["explain_enriched"] = explain_enriched

        await self.close()
        logger.info("Signal aggregation complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 1. Aggregate events into candidate signals
    # ------------------------------------------------------------------

    async def aggregate_events(
        self,
        conn: "asyncpg.Connection",
        region: str,
        lookback_days: int,
    ) -> List[CandidateSignal]:
        """Group recent events by event_type + meaningful discriminator.

        Instead of lumping all events of the same type into one signal,
        sub-groups by pattern_name, round_type, or other metadata so that
        each signal carries a specific, actionable claim.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

        # Query recent structured events (using effective_date for real event timing)
        try:
            rows = await conn.fetch(
                """SELECT se.id::text, se.event_type, se.startup_id::text,
                          se.metadata_json, se.cluster_id::text, se.confidence,
                          se.detected_at, se.effective_date, se.event_title, se.event_key,
                          se.evidence_ids,
                          er.domain
                   FROM startup_events se
                   JOIN event_registry er ON se.event_registry_id = er.id
                   WHERE se.region = $1
                     AND se.effective_date >= $2::date
                   ORDER BY se.effective_date DESC""",
                region, cutoff.date(),
            )
        except Exception:
            # Back-compat: evidence_ids column may not exist yet.
            rows = await conn.fetch(
                """SELECT se.id::text, se.event_type, se.startup_id::text,
                          se.metadata_json, se.cluster_id::text, se.confidence,
                          se.detected_at, se.effective_date, se.event_title, se.event_key,
                          er.domain
                   FROM startup_events se
                   JOIN event_registry er ON se.event_registry_id = er.id
                   WHERE se.region = $1
                     AND se.effective_date >= $2::date
                   ORDER BY se.effective_date DESC""",
                region, cutoff.date(),
            )

        if not rows:
            return []

        # Batch-fetch startup names for company-enriched claims
        startup_ids = list({row["startup_id"] for row in rows if row["startup_id"]})
        startup_names: Dict[str, str] = {}
        if startup_ids:
            name_rows = await conn.fetch(
                "SELECT id::text, name FROM startups WHERE id = ANY($1::uuid[])",
                startup_ids,
            )
            startup_names = {r["id"]: r["name"] for r in name_rows}

        # Group by event_type + meaningful discriminator from metadata
        groups: Dict[str, Dict[str, Any]] = {}

        for row in rows:
            event_type = row["event_type"]
            metadata = ensure_json_object(row["metadata_json"])
            domain = row["domain"]

            # Determine sub-group discriminator — prefer event_key (set at
            # write time by event_extractor), fall back to metadata parsing
            # for legacy rows that predate migration 042.
            event_key = row["event_key"] or ""

            if event_key:
                discriminator = event_key
                group_key = f"{event_type}:{event_key}"
            else:
                pattern_name = metadata.get("pattern_name")
                if pattern_name:
                    discriminator = pattern_name
                    group_key = f"{event_type}:{pattern_name}"
                elif event_type == "cap_funding_raised":
                    round_type = metadata.get("round_type") or "all"
                    discriminator = round_type
                    group_key = f"{event_type}:{round_type}"
                else:
                    discriminator = None
                    group_key = event_type

            if group_key not in groups:
                groups[group_key] = {
                    "domain": domain,
                    "event_type": event_type,
                    "discriminator": discriminator,
                    "events": [],
                    "companies": set(),
                }

            g = groups[group_key]
            evidence_ids: list[str] = []
            try:
                raw_evidence = row.get("evidence_ids")
                if isinstance(raw_evidence, list):
                    evidence_ids = [str(x) for x in raw_evidence if x]
            except Exception:
                evidence_ids = []

            g["events"].append({
                "event_id": row["id"],
                "cluster_id": row["cluster_id"],
                "startup_id": row["startup_id"],
                "confidence": float(row["confidence"]) if row["confidence"] else 0.5,
                "detected_at": row["detected_at"].isoformat() if row["detected_at"] else None,
                "metadata": metadata,
                "event_title": row["event_title"],
                "evidence_ids": evidence_ids,
            })
            if row["startup_id"]:
                g["companies"].add(row["startup_id"])

        # Build candidate signals from groups
        candidates: List[CandidateSignal] = []

        for g in groups.values():
            events = g["events"]
            n = len(events)
            if n < 2:
                continue  # Skip singletons — not yet a signal

            # Cap evidence per signal (keep highest confidence first)
            if n > MAX_EVIDENCE_PER_SIGNAL:
                events = sorted(events, key=lambda e: e["confidence"], reverse=True)[
                    :MAX_EVIDENCE_PER_SIGNAL
                ]

            unique_companies: set = g["companies"]

            # Collect funding amounts, deduplicated by company (max per startup)
            # Multiple news articles about the same round would otherwise inflate totals
            _funding_by_company: Dict[str, float] = {}
            for evt in events:
                amt_raw = evt["metadata"].get("funding_amount", "")
                amt_val: Optional[float] = None
                if isinstance(amt_raw, (int, float)) and amt_raw > 0:
                    amt_val = float(amt_raw)
                elif isinstance(amt_raw, str):
                    amt_val = self._parse_funding_amount(amt_raw)
                if amt_val and amt_val > 0:
                    sid = evt.get("startup_id") or "unknown"
                    _funding_by_company[sid] = max(_funding_by_company.get(sid, 0), amt_val)
            funding_amounts: List[float] = list(_funding_by_company.values())

            # Resolve company names for claim enrichment
            company_names = [
                startup_names[sid]
                for sid in unique_companies
                if sid in startup_names and startup_names[sid]
            ]

            claim = self._build_claim(
                event_type=g["event_type"],
                discriminator=g["discriminator"],
                n_events=len(events),
                n_companies=len(unique_companies),
                company_names=company_names,
                funding_amounts=funding_amounts,
                lookback_days=lookback_days,
            )

            candidate = CandidateSignal(
                domain=g["domain"],
                cluster_name=g["discriminator"],
                claim=claim,
                region=region,
                evidence_events=events,
                unique_companies=unique_companies,
                metadata={
                    "event_type": g["event_type"],
                    "funding_amounts": funding_amounts,
                    "total_amount": sum(funding_amounts) if funding_amounts else 0,
                },
            )
            candidates.append(candidate)

        logger.info("[signals:%s] Aggregated %d candidate signals from %d events",
                     region, len(candidates), len(rows))
        return candidates

    # ------------------------------------------------------------------
    # 2. Merge or create signals via vector similarity
    # ------------------------------------------------------------------

    async def merge_or_create(
        self,
        conn: "asyncpg.Connection",
        candidate: CandidateSignal,
        region: str,
    ) -> str:
        """Merge candidate into existing signal or create new one.

        Returns 'merged' or 'created'.
        """
        # Try to find pattern_id from pattern_registry
        pattern_id = None
        if candidate.cluster_name:
            row = await conn.fetchrow(
                "SELECT id::text FROM pattern_registry WHERE pattern_name = $1 AND domain = $2 AND status = 'active' LIMIT 1",
                candidate.cluster_name, candidate.domain,
            )
            if row:
                pattern_id = row["id"]

        # Embed the claim for similarity search
        embedding = None
        if self._embedding_service:
            try:
                embeddings = await self._embedding_service.embed_texts([candidate.claim])
                embedding = embeddings[0] if embeddings else None
            except Exception:
                logger.warning("Failed to embed signal claim, creating without embedding")

        # ANN search against existing signals
        existing_signal_id = None
        if embedding:
            similar = await conn.fetchrow(
                """SELECT id::text, claim,
                          1 - (embedding <=> $1::vector) AS similarity
                   FROM signals
                   WHERE region = $2 AND status != 'decaying'
                     AND embedding IS NOT NULL
                   ORDER BY embedding <=> $1::vector
                   LIMIT 1""",
                str(embedding), region,
            )
            if similar and similar["similarity"] >= MERGE_SIMILARITY_THRESHOLD:
                existing_signal_id = similar["id"]
                logger.debug("Merging into existing signal %s (sim=%.3f): %s",
                             existing_signal_id, similar["similarity"], similar["claim"])

        # Text fallback: exact domain+claim match when embedding unavailable
        if not existing_signal_id and not embedding:
            fallback = await conn.fetchrow(
                """SELECT id::text FROM signals
                   WHERE region = $1 AND status != 'decaying'
                     AND domain = $2 AND claim = $3
                   LIMIT 1""",
                region, candidate.domain, candidate.claim,
            )
            if fallback:
                existing_signal_id = fallback["id"]

        if existing_signal_id:
            # Attach evidence to existing signal
            await self._attach_evidence(conn, existing_signal_id, candidate)
            return "merged"
        else:
            # Create new signal
            signal_id = await self._create_signal(conn, candidate, pattern_id, embedding, region)
            await self._attach_evidence(conn, signal_id, candidate)
            return "created"

    async def _create_signal(
        self,
        conn: "asyncpg.Connection",
        candidate: CandidateSignal,
        pattern_id: Optional[str],
        embedding: Optional[List[float]],
        region: str,
    ) -> str:
        """Insert a new signal and return its ID."""
        if self._has_embedding and embedding is not None:
            row = await conn.fetchrow(
                """INSERT INTO signals
                       (domain, cluster_name, pattern_id, claim, region,
                        evidence_count, unique_company_count,
                        embedding, embedded_at, metadata_json)
                   VALUES ($1, $2, $3::uuid, $4, $5,
                           $6, $7,
                           $8::vector, NOW(),
                           $9::jsonb)
                   RETURNING id::text""",
                candidate.domain,
                candidate.cluster_name,
                pattern_id,
                candidate.claim,
                region,
                len(candidate.evidence_events),
                len(candidate.unique_companies),
                str(embedding),
                json.dumps(candidate.metadata),
            )
        else:
            row = await conn.fetchrow(
                """INSERT INTO signals
                       (domain, cluster_name, pattern_id, claim, region,
                        evidence_count, unique_company_count,
                        metadata_json)
                   VALUES ($1, $2, $3::uuid, $4, $5,
                           $6, $7,
                           $8::jsonb)
                   RETURNING id::text""",
                candidate.domain,
                candidate.cluster_name,
                pattern_id,
                candidate.claim,
                region,
                len(candidate.evidence_events),
                len(candidate.unique_companies),
                json.dumps(candidate.metadata),
            )

        signal_id = row["id"]

        # Emit signal_updates row for 'created'
        await self._emit_signal_update(conn, signal_id, "created")

        return signal_id

    async def _attach_evidence(
        self,
        conn: "asyncpg.Connection",
        signal_id: str,
        candidate: CandidateSignal,
    ) -> None:
        """Attach evidence events to a signal and update counts."""
        supports_evidence_object_id = False
        try:
            supports_evidence_object_id = bool(
                await conn.fetchval(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'signal_evidence' AND column_name = 'evidence_object_id'
                    LIMIT 1
                    """
                )
            )
        except Exception:
            supports_evidence_object_id = False

        for evt in candidate.evidence_events:
            # Extract snippet from event_title or metadata
            snippet = (
                evt.get("event_title")
                or evt.get("metadata", {}).get("snippet")
            )
            evidence_object_id = None
            if supports_evidence_object_id:
                ev_list = evt.get("evidence_ids") or []
                if isinstance(ev_list, list) and ev_list:
                    evidence_object_id = ev_list[0]
            try:
                if supports_evidence_object_id:
                    await conn.execute(
                        """INSERT INTO signal_evidence
                               (signal_id, event_id, cluster_id, startup_id, weight, evidence_type, snippet, evidence_object_id)
                           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::uuid)
                           ON CONFLICT (signal_id, event_id) WHERE event_id IS NOT NULL DO UPDATE
                           SET evidence_object_id = COALESCE(signal_evidence.evidence_object_id, EXCLUDED.evidence_object_id)""",
                        signal_id,
                        evt.get("event_id"),
                        evt.get("cluster_id"),
                        evt.get("startup_id"),
                        evt.get("confidence", 1.0),
                        "event",
                        snippet,
                        evidence_object_id,
                    )
                else:
                    await conn.execute(
                        """INSERT INTO signal_evidence
                               (signal_id, event_id, cluster_id, startup_id, weight, evidence_type, snippet)
                           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)
                           ON CONFLICT (signal_id, event_id) WHERE event_id IS NOT NULL DO NOTHING""",
                        signal_id,
                        evt.get("event_id"),
                        evt.get("cluster_id"),
                        evt.get("startup_id"),
                        evt.get("confidence", 1.0),
                        "event",
                        snippet,
                    )
            except Exception:
                logger.debug("Evidence attach failed for signal %s", signal_id, exc_info=True)

        # Update signal counts
        await conn.execute(
            """UPDATE signals SET
                   evidence_count = (SELECT COUNT(*) FROM signal_evidence WHERE signal_id = $1::uuid),
                   unique_company_count = (
                       SELECT COUNT(DISTINCT startup_id) FROM signal_evidence
                       WHERE signal_id = $1::uuid AND startup_id IS NOT NULL
                   ),
                   last_evidence_at = NOW(),
                   updated_at = NOW()
               WHERE id = $1::uuid""",
            signal_id,
        )

    # ------------------------------------------------------------------
    # 3. Score all active signals
    # ------------------------------------------------------------------

    async def score_signals(self, conn: "asyncpg.Connection", region: str) -> int:
        """Recompute scores for all non-decaying signals."""
        signals = await conn.fetch(
            """SELECT id::text, evidence_count, unique_company_count, first_seen_at,
                      domain, metadata_json
               FROM signals
               WHERE region = $1""",
            region,
        )

        now = datetime.now(timezone.utc)
        recent_cutoff = now - timedelta(days=SCORING_LOOKBACK_DAYS)
        prev_cutoff = recent_cutoff - timedelta(days=SCORING_LOOKBACK_DAYS)
        # Domain signal counts for rarity weighting (batch 3.2)
        domain_counts: Dict[str, int] = {}
        total_signals = len(signals)
        for sig in signals:
            d = sig["domain"] or "architecture"
            domain_counts[d] = domain_counts.get(d, 0) + 1

        scored = 0
        for sig in signals:
            signal_id = sig["id"]

            # Source diversity: distinct source types in evidence
            diversity_row = await conn.fetchrow(
                """SELECT COUNT(DISTINCT se.evidence_type) AS diversity
                   FROM signal_evidence se
                   WHERE se.signal_id = $1::uuid""",
                signal_id,
            )
            source_diversity = diversity_row["diversity"] if diversity_row else 1

            # Recent vs previous event counts (by event effective_date, not evidence creation time)
            recent_row = await conn.fetchrow(
                """SELECT COUNT(*) AS cnt FROM signal_evidence sev
                   JOIN startup_events se ON sev.event_id = se.id
                   WHERE sev.signal_id = $1::uuid
                     AND se.effective_date >= $2::date""",
                signal_id, recent_cutoff.date(),
            )
            prev_row = await conn.fetchrow(
                """SELECT COUNT(*) AS cnt FROM signal_evidence sev
                   JOIN startup_events se ON sev.event_id = se.id
                   WHERE sev.signal_id = $1::uuid
                     AND se.effective_date >= $2::date
                     AND se.effective_date < $3::date""",
                signal_id, prev_cutoff.date(), recent_cutoff.date(),
            )
            recent_count = recent_row["cnt"] if recent_row else 0
            prev_count = prev_row["cnt"] if prev_row else 0

            # Funding amounts from evidence metadata (deduplicated by company)
            funding_rows = await conn.fetch(
                """SELECT se2.metadata_json, se2.startup_id::text AS startup_id
                   FROM startup_events se2
                   JOIN signal_evidence sev ON sev.event_id = se2.id
                   WHERE sev.signal_id = $1::uuid
                     AND se2.event_type = 'cap_funding_raised'""",
                signal_id,
            )
            _funding_by_co: Dict[str, float] = {}
            has_enterprise = False
            has_hyperscaler = False
            for fr in funding_rows:
                meta = ensure_json_object(fr["metadata_json"])
                amt = self._parse_funding_amount(meta.get("funding_amount", ""))
                if amt:
                    sid = fr["startup_id"] or "unknown"
                    _funding_by_co[sid] = max(_funding_by_co.get(sid, 0), amt)
                snippet = meta.get("snippet", "").lower()
                if "enterprise" in snippet:
                    has_enterprise = True
                if any(h in snippet for h in ("aws", "gcp", "azure", "google cloud", "microsoft")):
                    has_hyperscaler = True
            funding_amounts = list(_funding_by_co.values())

            # Company first-seen dates for velocity (by event effective_date)
            company_dates = await conn.fetch(
                """SELECT MIN(se.effective_date) AS first_seen
                   FROM signal_evidence sev
                   JOIN startup_events se ON sev.event_id = se.id
                   WHERE sev.signal_id = $1::uuid AND sev.startup_id IS NOT NULL
                   GROUP BY sev.startup_id""",
                signal_id,
            )
            dates = [r["first_seen"] for r in company_dates if r["first_seen"]]

            # Evidence source diversity: distinct source_type in linked events
            ev_source_row = await conn.fetchrow(
                """SELECT COUNT(DISTINCT se2.source_type) AS src_cnt
                   FROM signal_evidence sev
                   JOIN startup_events se2 ON sev.event_id = se2.id
                   WHERE sev.signal_id = $1::uuid AND se2.source_type IS NOT NULL""",
                signal_id,
            )
            distinct_sources = ev_source_row["src_cnt"] if ev_source_row else 1

            # Compute conviction with rarity bonus (3.2)
            conviction = compute_conviction(
                sig["unique_company_count"], source_diversity, sig["evidence_count"]
            )
            diversity_multiplier = min(1.3, 1 + 0.1 * (distinct_sources - 1))
            conviction = min(1.0, conviction * diversity_multiplier)

            # Rarity bonus: signals in less-populated domains get small boost
            sig_domain = sig["domain"] or "architecture"
            domain_count = domain_counts.get(sig_domain, 1)
            if total_signals > 0:
                rarity_bonus = 0.1 * (1.0 - domain_count / total_signals)
            else:
                rarity_bonus = 0.0
            conviction = min(1.0, conviction + rarity_bonus)

            # Momentum with EMA smoothing (3.1)
            raw_momentum = compute_momentum(recent_count, prev_count)

            # Load prev_momentum from metadata for EMA
            metadata = ensure_json_object(sig["metadata_json"])
            old_momentum = metadata.get("prev_momentum")
            old_conviction = metadata.get("prev_conviction")

            alpha = 0.3
            if old_momentum is not None:
                momentum = alpha * raw_momentum + (1 - alpha) * float(old_momentum)
            else:
                momentum = raw_momentum
            momentum = max(-1.0, min(1.0, momentum))

            impact_score = compute_impact(funding_amounts, has_enterprise, has_hyperscaler)
            velocity = compute_adoption_velocity(dates)

            # Persist smoothed values in metadata
            metadata["prev_momentum"] = round(momentum, 4)
            metadata["prev_conviction"] = round(conviction, 4)

            await conn.execute(
                """UPDATE signals SET
                       conviction = $2, momentum = $3, impact = $4,
                       adoption_velocity = $5, metadata_json = $6::jsonb,
                       last_scored_at = NOW(), updated_at = NOW()
                   WHERE id = $1::uuid""",
                signal_id, round(conviction, 4), round(momentum, 4),
                round(impact_score, 4), round(velocity, 4), json.dumps(metadata),
            )

            # Emit score_change update if significant change
            if old_momentum is not None:
                momentum_delta = abs(momentum - float(old_momentum))
                conviction_delta = abs(conviction - float(old_conviction)) if old_conviction is not None else 0
                if momentum_delta > 0.2 or conviction_delta > 0.15:
                    await self._emit_signal_update(
                        conn, signal_id, "score_change",
                        metadata_json={
                            "momentum_delta": round(momentum_delta, 4),
                            "conviction_delta": round(conviction_delta, 4),
                        },
                    )

            scored += 1

        logger.info("[signals:%s] Scored %d signals", region, scored)
        return scored

    # ------------------------------------------------------------------
    # 4. Lifecycle transitions
    # ------------------------------------------------------------------

    async def update_lifecycle(self, conn: "asyncpg.Connection", region: str) -> int:
        """Evaluate and apply lifecycle status transitions."""
        signals = await conn.fetch(
            """SELECT id::text, status, conviction, momentum,
                      unique_company_count, adoption_velocity, metadata_json
               FROM signals
               WHERE region = $1""",
            region,
        )

        transitions = 0
        for sig in signals:
            metadata = ensure_json_object(sig["metadata_json"])
            old_status = sig["status"]
            new_status = self._compute_new_status(
                current=old_status,
                unique_companies=sig["unique_company_count"],
                momentum=float(sig["momentum"]),
                velocity=float(sig["adoption_velocity"]),
                metadata=metadata,
            )

            if new_status != old_status:
                # Record transition in metadata
                lifecycle_history = metadata.get("lifecycle_transitions", [])
                lifecycle_history.append({
                    "from": old_status,
                    "to": new_status,
                    "at": datetime.now(timezone.utc).isoformat(),
                })
                metadata["lifecycle_transitions"] = lifecycle_history

                await conn.execute(
                    """UPDATE signals SET
                           status = $2, metadata_json = $3::jsonb, updated_at = NOW()
                       WHERE id = $1::uuid""",
                    sig["id"], new_status, json.dumps(metadata),
                )

                # Emit signal_updates row for status change
                await self._emit_signal_update(
                    conn, sig["id"], "status_change",
                    old_value=old_status, new_value=new_status,
                )

                transitions += 1
                logger.info("Signal %s: %s → %s", sig["id"][:8], old_status, new_status)

        logger.info("[signals:%s] %d lifecycle transitions", region, transitions)
        return transitions

    def _compute_new_status(
        self,
        current: str,
        unique_companies: int,
        momentum: float,
        velocity: float,
        metadata: Dict[str, Any],
    ) -> str:
        """Determine the next lifecycle status based on scoring metrics."""

        # Decaying check applies from any status
        prev_momentum = metadata.get("prev_momentum")
        if (momentum < LIFECYCLE_DECAYING_MOMENTUM_THRESHOLD
                and prev_momentum is not None
                and prev_momentum < LIFECYCLE_DECAYING_MOMENTUM_THRESHOLD):
            return "decaying"

        if current == "candidate":
            if unique_companies >= LIFECYCLE_MIN_COMPANIES_EMERGING:
                return "emerging"

        elif current == "emerging":
            if momentum >= LIFECYCLE_MIN_MOMENTUM_ACCELERATING:
                return "accelerating"

        elif current == "accelerating":
            # Established requires many companies + stable momentum/velocity
            if (unique_companies >= LIFECYCLE_MIN_COMPANIES_ESTABLISHED
                    and abs(momentum) < 0.1
                    and velocity >= 0):
                return "established"

        elif current == "decaying":
            # Can recover to emerging if momentum turns positive
            if momentum > 0 and unique_companies >= LIFECYCLE_MIN_COMPANIES_EMERGING:
                return "emerging"

        return current

    # ------------------------------------------------------------------
    # 5. Stage-aware context enrichment
    # ------------------------------------------------------------------

    async def compute_stage_context(
        self,
        conn: "asyncpg.Connection",
        region: str,
    ) -> int:
        """Compute per-stage adoption baselines and enrich signal metadata.

        For each active signal with a pattern_id, queries startup_state_snapshot
        to compute adoption percentages by funding stage, then stores the result
        in signals.metadata_json as 'stage_context'.

        Returns count of signals enriched.
        """
        # Check if startup_state_snapshot table exists
        table_exists = await conn.fetchval(
            """SELECT EXISTS (
                   SELECT 1 FROM information_schema.tables
                   WHERE table_name = 'startup_state_snapshot'
               )"""
        )
        if not table_exists:
            return 0

        # Get all active signals with pattern_id
        signals = await conn.fetch(
            """SELECT s.id::text, s.pattern_id::text, pr.pattern_name
               FROM signals s
               JOIN pattern_registry pr ON pr.id = s.pattern_id
               WHERE s.region = $1
                 AND s.status NOT IN ('decaying')
                 AND s.pattern_id IS NOT NULL""",
            region,
        )

        if not signals:
            return 0

        enriched = 0

        for sig in signals:
            pattern_name = sig["pattern_name"]
            signal_id = sig["id"]

            # Compute adoption by funding stage
            stage_rows = await conn.fetch(
                """SELECT
                       ss.funding_stage,
                       COUNT(*) FILTER (WHERE $1 = ANY(ss.build_patterns)
                                           OR $1 = ANY(ss.discovered_patterns)) AS adopters,
                       COUNT(*) AS total
                   FROM startup_state_snapshot ss
                   WHERE ss.snapshot_at >= NOW() - INTERVAL '90 days'
                     AND ss.funding_stage IS NOT NULL
                   GROUP BY ss.funding_stage
                   HAVING COUNT(*) >= 2
                   ORDER BY COUNT(*) FILTER (WHERE $1 = ANY(ss.build_patterns)
                                                OR $1 = ANY(ss.discovered_patterns))::float
                            / NULLIF(COUNT(*), 0) DESC""",
                pattern_name,
            )

            if not stage_rows:
                continue

            adoption_by_stage = {}
            for row in stage_rows:
                stage = row["funding_stage"]
                total = row["total"]
                adopters = row["adopters"]
                pct = round(100.0 * adopters / total, 1) if total > 0 else 0
                adoption_by_stage[stage] = {
                    "adopters": adopters,
                    "total": total,
                    "pct": pct,
                }

            # Find stage with highest adoption acceleration
            sorted_stages = sorted(
                adoption_by_stage.items(),
                key=lambda x: x[1]["pct"],
                reverse=True,
            )
            stage_acceleration = sorted_stages[0][0] if sorted_stages else None

            stage_context = {
                "adoption_by_stage": adoption_by_stage,
                "stage_acceleration": stage_acceleration,
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }

            # Merge into existing metadata
            meta_row = await conn.fetchrow(
                "SELECT metadata_json FROM signals WHERE id = $1::uuid",
                signal_id,
            )
            metadata = ensure_json_object(meta_row["metadata_json"] if meta_row else None)
            metadata["stage_context"] = stage_context

            await conn.execute(
                """UPDATE signals SET metadata_json = $2::jsonb, updated_at = NOW()
                   WHERE id = $1::uuid""",
                signal_id,
                json.dumps(metadata),
            )
            enriched += 1

        logger.info("[signals:%s] Enriched %d signals with stage context", region, enriched)
        return enriched

    # ------------------------------------------------------------------
    # 6. Explain JSON + Evidence Timeline (zero LLM cost)
    # ------------------------------------------------------------------

    DEFINITION_TEMPLATES: Dict[str, str] = {
        "architecture": "A technical infrastructure pattern where {claim_summary}",
        "gtm": "A go-to-market strategy where {claim_summary}",
        "capital": "A funding pattern where {claim_summary}",
        "org": "An organizational pattern where {claim_summary}",
        "product": "A product development approach where {claim_summary}",
    }

    DOMAIN_RISK_TEMPLATES: Dict[str, str] = {
        "architecture": "Technical complexity may slow adoption; lock-in risk if pattern becomes unfashionable",
        "gtm": "Market conditions may shift; messaging that resonates today may not in 6 months",
        "capital": "Funding patterns are cyclical; current trends may not sustain",
        "org": "Organizational changes take time to validate; correlation vs. causation risk",
        "product": "Product trends may reflect noise; need sustained adoption to confirm",
    }

    DOMAIN_HORIZON_TEMPLATES: Dict[str, str] = {
        "architecture": "6-18 months",
        "gtm": "3-12 months",
        "capital": "0-6 months",
        "org": "12-24 months",
        "product": "3-12 months",
    }

    STATUS_WHY_TEMPLATES: Dict[str, str] = {
        "candidate": "Early signal with limited evidence — worth monitoring",
        "emerging": "Growing adoption with positive momentum — gaining traction",
        "accelerating": "Strong momentum and increasing conviction — high confidence trend",
        "established": "Widely adopted pattern — consider implications for your strategy",
        "decaying": "Declining adoption — may be losing relevance or being superseded",
    }

    async def compute_explain_and_timeline(
        self,
        conn: "asyncpg.Connection",
        region: str,
    ) -> int:
        """Build explain_json and evidence_timeline for all signals (zero LLM cost).

        explain_json is template-derived from existing data:
          - definition from claim text + domain (using DEFINITION_TEMPLATES)
          - why from status + momentum
          - examples from top company names in evidence
          - risk from domain templates
          - time_horizon from domain
          - top_evidence from evidence snippets

        evidence_timeline is an 8-bin histogram of evidence counts over 30 days,
        stored as an object with bin metadata for frontend display.

        Includes explain_version for cache invalidation — only regenerates if
        version < 2 or explain is >24h stale.
        """
        CURRENT_EXPLAIN_VERSION = 2

        signals = await conn.fetch(
            """SELECT id::text, domain, claim, status, conviction, momentum,
                      metadata_json
               FROM signals WHERE region = $1""",
            region,
        )

        now = datetime.now(timezone.utc)
        enriched = 0
        for sig in signals:
            signal_id = sig["id"]
            domain = sig["domain"] or "architecture"
            claim = sig["claim"] or ""
            status = sig["status"] or "candidate"
            momentum = float(sig["momentum"] or 0)

            # Check if we can skip (version current + not stale)
            metadata = ensure_json_object(sig["metadata_json"])
            existing_version = 0
            if metadata.get("explain_json"):
                existing_version = metadata["explain_json"].get("explain_version", 1)
            existing_generated = metadata.get("explain_generated_at")
            if existing_version >= CURRENT_EXPLAIN_VERSION and existing_generated:
                try:
                    gen_time = datetime.fromisoformat(existing_generated.replace("Z", "+00:00"))
                    if (now - gen_time).total_seconds() < 86400:
                        continue  # Fresh enough, skip
                except (ValueError, TypeError):
                    pass

            # --- Build explain_json ---

            # Definition: domain-specific template with claim summary
            claim_summary = claim.split(".")[0].strip().lower()[:120]
            template = self.DEFINITION_TEMPLATES.get(domain, "{claim_summary}")
            definition = template.format(claim_summary=claim_summary)

            # Why: based on status and momentum direction
            why_base = self.STATUS_WHY_TEMPLATES.get(status, "Signal detected")
            mom_dir = "accelerating" if momentum > 0.1 else "slowing" if momentum < -0.1 else "steady"
            why = f"{why_base}. Momentum is {mom_dir}."

            # Examples: top 3 company names from evidence
            company_rows = await conn.fetch(
                """SELECT DISTINCT s.name
                   FROM signal_evidence se
                   JOIN startups s ON s.id = se.startup_id
                   WHERE se.signal_id = $1::uuid AND se.startup_id IS NOT NULL
                   ORDER BY s.name
                   LIMIT 3""",
                signal_id,
            )
            examples = [r["name"] for r in company_rows]

            # Risk + horizon from domain templates
            risk = self.DOMAIN_RISK_TEMPLATES.get(domain, "Limited data on long-term viability")
            time_horizon = self.DOMAIN_HORIZON_TEMPLATES.get(domain, "6-18 months")

            # Top evidence: snippets from recent evidence
            evidence_rows = await conn.fetch(
                """SELECT se.snippet, se.evidence_type AS source, se.created_at
                   FROM signal_evidence se
                   WHERE se.signal_id = $1::uuid AND se.snippet IS NOT NULL
                   ORDER BY se.created_at DESC
                   LIMIT 3""",
                signal_id,
            )
            top_evidence = []
            for ev in evidence_rows:
                top_evidence.append({
                    "snippet": (ev["snippet"] or "")[:200],
                    "source": ev["source"] or "unknown",
                    "date": ev["created_at"].strftime("%b %d") if ev["created_at"] else "",
                })

            explain_json = {
                "definition": definition,
                "why": why,
                "examples": examples,
                "risk": risk,
                "time_horizon": time_horizon,
                "top_evidence": top_evidence,
                "explain_version": CURRENT_EXPLAIN_VERSION,
            }

            # --- Build evidence_timeline (8 bins over 30 days) with metadata ---
            timeline_start = (now - timedelta(days=30)).date()
            timeline_end = now.date()

            timeline_rows = await conn.fetch(
                """SELECT width_bucket(
                       EXTRACT(EPOCH FROM se.created_at),
                       EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 days')),
                       EXTRACT(EPOCH FROM NOW()), 8
                   ) AS bin, COUNT(*) AS cnt
                   FROM signal_evidence se
                   WHERE se.signal_id = $1::uuid
                     AND se.created_at >= NOW() - INTERVAL '30 days'
                   GROUP BY bin ORDER BY bin""",
                signal_id,
            )
            bins = [0] * 8
            for row in timeline_rows:
                b = int(row["bin"])
                if 1 <= b <= 8:
                    bins[b - 1] = int(row["cnt"])

            evidence_timeline = {
                "bins": bins,
                "bin_count": 8,
                "timeline_start": timeline_start.isoformat(),
                "timeline_end": timeline_end.isoformat(),
            }

            # --- Merge into metadata ---
            metadata["explain_json"] = explain_json
            metadata["explain_generated_at"] = now.isoformat()
            metadata["evidence_timeline"] = evidence_timeline

            await conn.execute(
                """UPDATE signals SET metadata_json = $2::jsonb, updated_at = NOW()
                   WHERE id = $1::uuid""",
                signal_id,
                json.dumps(metadata),
            )
            enriched += 1

        logger.info("[signals:%s] Enriched %d signals with explain + timeline", region, enriched)
        return enriched

    # ------------------------------------------------------------------
    # Signal update emission
    # ------------------------------------------------------------------

    async def _emit_signal_update(
        self,
        conn: "asyncpg.Connection",
        signal_id: str,
        update_type: str,
        old_value: Optional[str] = None,
        new_value: Optional[str] = None,
        metadata_json: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Insert a row into signal_updates (best-effort, swallows errors if table missing)."""
        try:
            await conn.execute(
                """INSERT INTO signal_updates (signal_id, update_type, old_value, new_value, metadata_json)
                   VALUES ($1::uuid, $2, $3, $4, $5::jsonb)""",
                signal_id,
                update_type,
                old_value,
                new_value,
                json.dumps(metadata_json) if metadata_json else None,
            )
        except Exception:
            # Table may not exist yet (migration 049 not applied) — log and continue
            logger.debug("Failed to emit signal_update (table may not exist)", exc_info=True)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _sanitize_claim_text(text: str) -> str:
        """Normalize claim text formatting for display consistency."""
        s = str(text or "").strip()
        if not s:
            return s
        # Guard against duplicate "$" prefixes (e.g., "$$4.7B").
        s = re.sub(r"\${2,}(?=\d)", "$", s)
        # Normalize stray spaces between currency symbol and amount.
        s = re.sub(r"\$\s+(?=\d)", "$", s)
        return s

    @staticmethod
    def _build_claim(
        event_type: str,
        discriminator: Optional[str],
        n_events: int,
        n_companies: int,
        company_names: List[str],
        funding_amounts: List[float],
        lookback_days: int,
    ) -> str:
        """Build a specific, readable signal claim from aggregated event data.

        Returns a human-readable claim string (~120 chars) that includes
        the actual pattern/stage name and top company names.
        """
        # Build company name suffix (up to 3 names)
        names_part = ""
        if company_names:
            top = sorted(company_names)[:3]
            names_part = " including " + ", ".join(top)
            remaining = n_companies - len(top)
            if remaining > 0:
                names_part += f" +{remaining} more"

        label = discriminator or "pattern"

        # --- Architecture events ---
        if event_type == "arch_pattern_adopted":
            claim = f"{label} adoption trending: {n_companies} companies{names_part} in {lookback_days} days"

        elif event_type == "arch_state_pattern_added":
            claim = f"{label} detected in analysis: {n_companies} companies adopted {label}"

        elif event_type == "arch_state_pattern_removed":
            claim = f"{label} being dropped: {n_companies} companies removed {label}"

        elif event_type == "arch_migration_announced":
            claim = f"Architecture migration: {n_events} announcements{names_part} in {lookback_days} days"

        elif event_type == "arch_open_sourced":
            claim = f"Open-source releases: {n_events} projects{names_part} in {lookback_days} days"

        # --- Capital events ---
        elif event_type == "cap_funding_raised":
            total = sum(funding_amounts) if funding_amounts else 0
            amount_str = SignalEngine._format_amount(total)
            stage = discriminator if discriminator and discriminator != "all" else "AI"
            deal_count = len(funding_amounts) if funding_amounts else n_companies
            claim = f"{stage} funding: {amount_str} across {deal_count} deals in {lookback_days} days"

        elif event_type == "cap_acquisition_announced":
            claim = f"M&A activity: {n_events} acquisitions{names_part} in {lookback_days} days"

        # --- Product events ---
        elif event_type == "prod_launched":
            claim = f"Product launches accelerating: {n_events} new products{names_part} in {lookback_days} days"

        elif event_type == "prod_major_update":
            claim = f"Product momentum: {n_events} major updates{names_part} in {lookback_days} days"

        # --- GTM events ---
        elif event_type == "gtm_enterprise_tier_launched":
            claim = f"Enterprise GTM shift: {n_companies} companies launched enterprise tiers{names_part}"

        elif event_type == "gtm_open_source_strategy":
            claim = f"Open-source GTM gaining traction: {n_companies} companies{names_part} in {lookback_days} days"

        elif event_type == "gtm_channel_launched":
            claim = f"Distribution expansion: {n_events} new channels{names_part} in {lookback_days} days"

        elif event_type == "gtm_vertical_expansion":
            claim = f"Vertical expansion: {n_companies} companies expanding{names_part} in {lookback_days} days"

        elif event_type == "gtm_state_strategy_changed":
            claim = f"GTM pivot to {label}: {n_companies} companies shifted strategy"

        elif event_type == "gtm_pricing_changed":
            claim = f"Pricing changes: {n_events} companies updated pricing{names_part} in {lookback_days} days"

        elif event_type == "gtm_customer_signed":
            claim = f"Customer wins: {n_events} notable signings{names_part} in {lookback_days} days"

        elif event_type == "gtm_partnership_announced":
            claim = f"Partnership momentum: {n_events} partnerships{names_part} in {lookback_days} days"

        # --- Org events ---
        elif event_type == "org_key_hire":
            claim = f"Key hires rising: {n_events} announcements{names_part} in {lookback_days} days"

        # --- Tech state change (analysis diff) ---
        elif event_type == "tech_state_model_changed":
            claim = f"{label} adoption rising: {n_companies} new integrations{names_part}"

        # --- Fallback ---
        else:
            readable = event_type.replace("_", " ")
            for prefix in ("arch ", "cap ", "prod ", "gtm ", "org "):
                readable = readable.replace(prefix, "", 1)
            claim = f"{readable}: {n_events} events across {n_companies} companies in {lookback_days} days"

        claim = SignalEngine._sanitize_claim_text(claim)

        # Truncate to ~200 chars for DB readability
        if len(claim) > 200:
            claim = claim[:197] + "..."

        return claim

    @staticmethod
    def _parse_funding_amount(amount_str: str) -> Optional[float]:
        """Parse funding amount string like '$10M', '$1.5B' to float."""
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

    @staticmethod
    def _format_amount(amount: float) -> str:
        """Format amount as human-readable string."""
        if amount >= 1e12:
            return f"${amount / 1e12:.1f}T"
        elif amount >= 1e9:
            return f"${amount / 1e9:.1f}B"
        elif amount >= 1e6:
            return f"${amount / 1e6:.1f}M"
        elif amount >= 1e3:
            return f"${amount / 1e3:.0f}K"
        elif amount > 0:
            return f"${amount:.0f}"
        return "$0"


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

async def run_signal_aggregation(
    lookback_days: int = 30,
    region: Optional[str] = None,
) -> Dict[str, Any]:
    """Run signal aggregation for one or both regions."""
    regions = [region] if region else ["global", "turkey"]
    all_stats = {}

    for r in regions:
        engine = SignalEngine()
        stats = await engine.run(region=r, lookback_days=lookback_days)
        all_stats[r] = stats

    return all_stats
