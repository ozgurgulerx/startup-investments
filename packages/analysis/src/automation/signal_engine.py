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
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional

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
# Claim templates
# ---------------------------------------------------------------------------

_CLAIM_TEMPLATES: Dict[str, str] = {
    "arch_pattern_adopted": "{pattern} adoption trending: {n} companies in {days} days",
    "cap_funding_raised": "Funding activity in {pattern}: ${amount} across {n} deals in {days} days",
    "cap_acquisition_announced": "M&A activity increasing: {n} acquisitions in {days} days",
    "prod_launched": "Product launch surge: {n} new launches in {days} days",
    "prod_major_update": "Product momentum: {n} major updates in {days} days",
    "org_key_hire": "Hiring activity rising: {n} key hires announced in {days} days",
    "gtm_enterprise_tier_launched": "Enterprise GTM shift: {n} companies launched enterprise tiers in {days} days",
    "gtm_open_source_strategy": "Open-source GTM gaining traction: {n} companies adopting in {days} days",
    "gtm_channel_launched": "Distribution expansion: {n} new channels launched in {days} days",
    "gtm_vertical_expansion": "Vertical expansion trending: {n} companies expanding in {days} days",
}


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


def compute_adoption_velocity(company_dates: List[datetime]) -> float:
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
        """Group recent events and generate candidate signal claims."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

        # Query recent structured events
        rows = await conn.fetch(
            """SELECT se.id::text, se.event_type, se.startup_id::text,
                      se.metadata_json, se.cluster_id::text, se.confidence,
                      se.detected_at, se.event_title,
                      er.domain
               FROM startup_events se
               JOIN event_registry er ON se.event_registry_id = er.id
               WHERE se.region = $1
                 AND se.detected_at >= $2
               ORDER BY se.detected_at DESC""",
            region, cutoff,
        )

        if not rows:
            return []

        # Group by event_type + pattern_name (for arch events)
        groups: Dict[str, CandidateSignal] = {}

        for row in rows:
            event_type = row["event_type"]
            metadata = json.loads(row["metadata_json"]) if row["metadata_json"] else {}
            domain = row["domain"]

            # For arch events, group by pattern name
            pattern_name = metadata.get("pattern_name")
            if event_type == "arch_pattern_adopted" and pattern_name:
                group_key = f"{event_type}:{pattern_name}"
                cluster_name = pattern_name
            else:
                group_key = event_type
                cluster_name = None

            if group_key not in groups:
                template = _CLAIM_TEMPLATES.get(event_type, "{n} events of type {event_type} in {days} days")
                groups[group_key] = CandidateSignal(
                    domain=domain,
                    cluster_name=cluster_name,
                    claim=template,  # Will be formatted later
                    region=region,
                    metadata={"event_type": event_type},
                )

            candidate = groups[group_key]
            candidate.evidence_events.append({
                "event_id": row["id"],
                "cluster_id": row["cluster_id"],
                "startup_id": row["startup_id"],
                "confidence": float(row["confidence"]) if row["confidence"] else 0.5,
                "detected_at": row["detected_at"].isoformat() if row["detected_at"] else None,
                "metadata": metadata,
            })
            if row["startup_id"]:
                candidate.unique_companies.add(row["startup_id"])

        # Format claim templates with actual counts
        candidates = []
        for candidate in groups.values():
            n = len(candidate.evidence_events)
            if n < 2:
                continue  # Skip singletons — not yet a signal

            funding_amounts = []
            for evt in candidate.evidence_events:
                amt = evt["metadata"].get("funding_amount", "")
                if isinstance(amt, str):
                    # Parse "$10M" → 10_000_000
                    parsed = self._parse_funding_amount(amt)
                    if parsed:
                        funding_amounts.append(parsed)

            total_amount = sum(funding_amounts) if funding_amounts else 0

            claim = candidate.claim.format(
                pattern=candidate.cluster_name or "pattern",
                n=n,
                days=lookback_days,
                amount=self._format_amount(total_amount),
                event_type=candidate.metadata.get("event_type", ""),
            )
            candidate.claim = claim
            candidate.metadata["funding_amounts"] = funding_amounts
            candidate.metadata["total_amount"] = total_amount
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
        return row["id"]

    async def _attach_evidence(
        self,
        conn: "asyncpg.Connection",
        signal_id: str,
        candidate: CandidateSignal,
    ) -> None:
        """Attach evidence events to a signal and update counts."""
        for evt in candidate.evidence_events:
            try:
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
                    None,
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
            """SELECT id::text, evidence_count, unique_company_count, first_seen_at
               FROM signals
               WHERE region = $1""",
            region,
        )

        now = datetime.now(timezone.utc)
        recent_cutoff = now - timedelta(days=SCORING_LOOKBACK_DAYS)
        prev_cutoff = recent_cutoff - timedelta(days=SCORING_LOOKBACK_DAYS)

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

            # Recent vs previous event counts
            recent_row = await conn.fetchrow(
                """SELECT COUNT(*) AS cnt FROM signal_evidence
                   WHERE signal_id = $1::uuid AND created_at >= $2""",
                signal_id, recent_cutoff,
            )
            prev_row = await conn.fetchrow(
                """SELECT COUNT(*) AS cnt FROM signal_evidence
                   WHERE signal_id = $1::uuid AND created_at >= $2 AND created_at < $3""",
                signal_id, prev_cutoff, recent_cutoff,
            )
            recent_count = recent_row["cnt"] if recent_row else 0
            prev_count = prev_row["cnt"] if prev_row else 0

            # Funding amounts from evidence metadata
            funding_rows = await conn.fetch(
                """SELECT se2.metadata_json
                   FROM startup_events se2
                   JOIN signal_evidence sev ON sev.event_id = se2.id
                   WHERE sev.signal_id = $1::uuid
                     AND se2.event_type = 'cap_funding_raised'""",
                signal_id,
            )
            funding_amounts = []
            has_enterprise = False
            has_hyperscaler = False
            for fr in funding_rows:
                meta = json.loads(fr["metadata_json"]) if fr["metadata_json"] else {}
                amt = self._parse_funding_amount(meta.get("funding_amount", ""))
                if amt:
                    funding_amounts.append(amt)
                # Check enterprise/hyperscaler keywords in snippet
                snippet = meta.get("snippet", "").lower()
                if "enterprise" in snippet:
                    has_enterprise = True
                if any(h in snippet for h in ("aws", "gcp", "azure", "google cloud", "microsoft")):
                    has_hyperscaler = True

            # Company first-seen dates for velocity
            company_dates = await conn.fetch(
                """SELECT MIN(created_at) AS first_seen
                   FROM signal_evidence
                   WHERE signal_id = $1::uuid AND startup_id IS NOT NULL
                   GROUP BY startup_id""",
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

            # Compute scores
            conviction = compute_conviction(
                sig["unique_company_count"], source_diversity, sig["evidence_count"]
            )
            # Diversity bonus: reward signals backed by independent source types
            diversity_multiplier = min(1.3, 1 + 0.1 * (distinct_sources - 1))
            conviction = min(1.0, conviction * diversity_multiplier)

            momentum = compute_momentum(recent_count, prev_count)
            impact_score = compute_impact(funding_amounts, has_enterprise, has_hyperscaler)
            velocity = compute_adoption_velocity(dates)

            # Persist prev_momentum in metadata for lifecycle decay detection
            meta_row = await conn.fetchrow(
                "SELECT metadata_json FROM signals WHERE id = $1::uuid", signal_id
            )
            metadata = json.loads(meta_row["metadata_json"]) if meta_row and meta_row["metadata_json"] else {}
            metadata["prev_momentum"] = round(momentum, 4)

            await conn.execute(
                """UPDATE signals SET
                       conviction = $2, momentum = $3, impact = $4,
                       adoption_velocity = $5, metadata_json = $6::jsonb,
                       last_scored_at = NOW(), updated_at = NOW()
                   WHERE id = $1::uuid""",
                signal_id, round(conviction, 4), round(momentum, 4),
                round(impact_score, 4), round(velocity, 4), json.dumps(metadata),
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
            old_status = sig["status"]
            new_status = self._compute_new_status(
                current=old_status,
                unique_companies=sig["unique_company_count"],
                momentum=float(sig["momentum"]),
                velocity=float(sig["adoption_velocity"]),
                metadata=json.loads(sig["metadata_json"]) if sig["metadata_json"] else {},
            )

            if new_status != old_status:
                # Record transition in metadata
                metadata = json.loads(sig["metadata_json"]) if sig["metadata_json"] else {}
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
    # Helpers
    # ------------------------------------------------------------------

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
        if amount >= 1e9:
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
