"""
Signal Deep Dive Engine.

Phases 3-6 of the deep dive pipeline:
  - Phase 3: Evidence enrichment (populate structured_json/tags on signal_evidence)
  - Phase 4: Per-startup occurrence scoring (deterministic, zero LLM)
  - Phase 5: Move extraction (batched LLM)
  - Phase 6: Deep dive synthesis (single LLM call per signal)
"""

import hashlib
import json
import logging
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import asyncpg

from src.config import settings, llm_kwargs

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Occurrence scoring weights
W_EVIDENCE_COUNT = 0.30
W_SOURCE_DIVERSITY = 0.20
W_RECENCY = 0.25
W_CONFIDENCE = 0.15
W_SOURCE_MIX = 0.10
SIGMOID_CENTER = 1.5

# Move extraction
MOVE_TYPES = [
    "oss_launch", "integration_push", "community_funnel", "pricing_wedge",
    "enterprise_pivot", "vertical_expansion", "platform_play",
    "developer_advocacy", "data_moat", "compliance_push", "hiring_signal",
    "partnership", "product_launch", "architecture_shift", "funding_milestone",
]
MAX_MOVES_PER_STARTUP = 5
MAX_EVIDENCE_PER_PACK = 12
BATCH_SIZE_STARTUPS = 3  # startups per LLM call
MAX_SAMPLE_STARTUPS = 12
MAX_PER_STAGE = 4  # diversity constraint

# Synthesis
MAX_SIGNALS_PER_RUN = 15


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class OccurrenceFeatures:
    """Features used for per-startup signal occurrence scoring."""
    evidence_count: int = 0
    source_diversity: int = 0  # distinct evidence_types
    recency_score: float = 0.0  # exponential decay
    confidence_avg: float = 0.0
    has_crawl_diff: bool = False
    has_news: bool = False
    has_github: bool = False
    funding_amount: float = 0.0
    github_stars_30d_delta: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "evidence_count": self.evidence_count,
            "source_diversity": self.source_diversity,
            "recency_score": round(self.recency_score, 4),
            "confidence_avg": round(self.confidence_avg, 4),
            "has_crawl_diff": self.has_crawl_diff,
            "has_news": self.has_news,
            "has_github": self.has_github,
            "funding_amount": self.funding_amount,
            "github_stars_30d_delta": self.github_stars_30d_delta,
        }


@dataclass
class EvidencePack:
    """Evidence pack for a startup within a signal."""
    startup_id: str
    startup_name: str
    startup_slug: str
    funding_stage: Optional[str] = None
    region: str = "global"
    snippets: List[Dict[str, Any]] = field(default_factory=list)
    evidence_ids: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Azure OpenAI client (reuses pattern from signal_engine.py)
# ---------------------------------------------------------------------------

def _create_llm_client() -> Optional[Any]:
    """Create Azure OpenAI async client for move extraction + synthesis."""
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


# ---------------------------------------------------------------------------
# Phase 3: Evidence Enrichment
# ---------------------------------------------------------------------------

async def enrich_evidence(conn: asyncpg.Connection, signal_id: Optional[str] = None) -> int:
    """Populate structured_json, tags, source_url, observed_at on signal_evidence rows.

    Enriches from the linked event/cluster metadata.
    Returns count of enriched rows.
    """
    where = "WHERE se.structured_json = '{}'::jsonb"
    params: List[Any] = []
    if signal_id:
        where += " AND se.signal_id = $1::uuid"
        params.append(signal_id)

    rows = await conn.fetch(
        f"""SELECT se.id::text, se.event_id::text, se.cluster_id::text,
                   se.evidence_type, se.snippet,
                   ev.metadata_json AS event_meta,
                   ev.event_type AS event_type,
                   ev.source_type AS event_source_type,
                   ev.detected_at AS event_detected_at,
                   nc.canonical_url AS cluster_url,
                   nc.builder_takeaway AS cluster_takeaway,
                   nc.published_at AS cluster_published_at
            FROM signal_evidence se
            LEFT JOIN startup_events ev ON ev.id = se.event_id
            LEFT JOIN news_clusters nc ON nc.id = se.cluster_id
            {where}
            LIMIT 5000""",
        *params,
    )

    enriched = 0
    for row in rows:
        structured: Dict[str, Any] = {}
        tags: List[str] = []
        source_url: Optional[str] = None
        observed_at: Optional[datetime] = None

        # Enrich from event metadata
        if row["event_meta"]:
            meta = row["event_meta"] if isinstance(row["event_meta"], dict) else json.loads(row["event_meta"])
            event_type = row["event_type"] or ""

            if event_type == "github_metrics":
                structured["github"] = {
                    k: meta.get(k) for k in [
                        "total_stars", "total_forks", "total_releases_90d",
                        "total_contributors_30d", "total_prs_merged_30d",
                    ] if meta.get(k) is not None
                }
                tags.append("github")
            elif "crawl" in event_type or row["evidence_type"] == "crawl_diff":
                structured["crawl_diff"] = {
                    k: meta.get(k) for k in ["url", "change_type", "change_summary"]
                    if meta.get(k) is not None
                }
                tags.append("crawl-diff")
            else:
                structured["event"] = {
                    "type": event_type,
                    "source": row["event_source_type"],
                }

            if row["event_detected_at"]:
                observed_at = row["event_detected_at"]

            # Auto-tag based on event type
            if "job" in event_type or "hiring" in event_type:
                tags.append("hiring")
            if "funding" in event_type or "capital" in event_type:
                tags.append("funding")
            if "partnership" in event_type:
                tags.append("partnership")
            if "product" in event_type or "launch" in event_type:
                tags.append("product")

        # Enrich from cluster
        if row["cluster_url"]:
            source_url = row["cluster_url"]
        if row["cluster_takeaway"]:
            structured["news"] = {"builder_takeaway": row["cluster_takeaway"]}
            tags.append("news")
        if row["cluster_published_at"]:
            observed_at = observed_at or row["cluster_published_at"]

        # Content hash for dedup/change detection
        content_hash = hashlib.sha256(
            (row["snippet"] or "").encode()
        ).hexdigest()[:16]

        # Remove duplicates from tags
        tags = list(dict.fromkeys(tags))

        await conn.execute(
            """UPDATE signal_evidence
               SET structured_json = $2::jsonb,
                   tags = $3,
                   source_url = $4,
                   observed_at = $5,
                   content_hash = $6
               WHERE id = $1::uuid""",
            row["id"],
            json.dumps(structured),
            tags,
            source_url,
            observed_at,
            content_hash,
        )
        enriched += 1

    logger.info("Enriched %d signal_evidence rows", enriched)
    return enriched


# ---------------------------------------------------------------------------
# Phase 4: Per-Startup Occurrence Scoring
# ---------------------------------------------------------------------------

def _compute_recency_score(dates: List[datetime], now: Optional[datetime] = None) -> float:
    """Exponential decay-weighted recency score (0-1)."""
    if not dates:
        return 0.0
    now = now or datetime.now(timezone.utc)
    scores = []
    for dt in dates:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        days_ago = max(0, (now - dt).total_seconds() / 86400)
        scores.append(math.exp(-days_ago / 30))  # half-life ~21 days
    return sum(scores) / len(scores) if scores else 0.0


def _sigmoid(x: float, center: float = SIGMOID_CENTER) -> float:
    """Standard sigmoid centered at `center`."""
    return 1.0 / (1.0 + math.exp(-(x - center)))


def compute_occurrence_score(features: OccurrenceFeatures) -> float:
    """Compute weighted sigmoid score from occurrence features."""
    raw = (
        W_EVIDENCE_COUNT * math.log1p(features.evidence_count)
        + W_SOURCE_DIVERSITY * math.log1p(features.source_diversity)
        + W_RECENCY * features.recency_score
        + W_CONFIDENCE * features.confidence_avg
        + W_SOURCE_MIX * (
            (1.0 if features.has_crawl_diff else 0.0)
            + (1.0 if features.has_news else 0.0)
        ) / 2.0
    )
    return round(_sigmoid(raw), 4)


async def compute_signal_occurrences(
    conn: asyncpg.Connection,
    signal_id: Optional[str] = None,
    region: Optional[str] = None,
) -> Dict[str, Any]:
    """Compute per-startup occurrence scores for signals.

    Deterministic, zero LLM cost.
    Returns stats dict.
    """
    # Get target signals
    conditions = ["status IN ('emerging', 'accelerating', 'established')"]
    params: List[Any] = []
    idx = 1

    if signal_id:
        conditions.append(f"id = ${idx}::uuid")
        params.append(signal_id)
        idx += 1
    if region:
        conditions.append(f"region = ${idx}")
        params.append(region)
        idx += 1

    where = " AND ".join(conditions)
    signals = await conn.fetch(
        f"SELECT id::text, claim, region FROM signals WHERE {where}",
        *params,
    )

    stats = {"signals_processed": 0, "occurrences_upserted": 0}

    for sig_row in signals:
        sid = sig_row["id"]
        stats["signals_processed"] += 1

        # Get all evidence grouped by startup
        evidence_rows = await conn.fetch(
            """SELECT se.id::text AS evidence_id,
                      se.startup_id::text,
                      se.evidence_type,
                      se.weight,
                      se.created_at,
                      se.tags,
                      s.name AS startup_name
               FROM signal_evidence se
               JOIN startups s ON s.id = se.startup_id
               WHERE se.signal_id = $1::uuid
                 AND se.startup_id IS NOT NULL
               ORDER BY se.startup_id, se.created_at DESC""",
            sid,
        )

        # Group by startup
        startup_evidence: Dict[str, List[Dict]] = {}
        startup_names: Dict[str, str] = {}
        for r in evidence_rows:
            su_id = r["startup_id"]
            startup_evidence.setdefault(su_id, []).append(dict(r))
            startup_names[su_id] = r["startup_name"]

        now = datetime.now(timezone.utc)

        for su_id, ev_list in startup_evidence.items():
            if len(ev_list) < 2:
                continue  # Require >= 2 evidence items

            # Compute features
            evidence_types = set(e["evidence_type"] for e in ev_list)
            dates = [e["created_at"] for e in ev_list if e.get("created_at")]
            weights = [float(e["weight"]) for e in ev_list if e.get("weight")]
            all_tags = set()
            for e in ev_list:
                if e.get("tags"):
                    all_tags.update(e["tags"])

            features = OccurrenceFeatures(
                evidence_count=len(ev_list),
                source_diversity=len(evidence_types),
                recency_score=_compute_recency_score(dates, now),
                confidence_avg=sum(weights) / len(weights) if weights else 0.5,
                has_crawl_diff="crawl_diff" in evidence_types,
                has_news="cluster" in evidence_types,
                has_github="github" in all_tags,
            )

            score = compute_occurrence_score(features)
            evidence_ids = [e["evidence_id"] for e in ev_list]
            evidence_hash = hashlib.sha256(
                "|".join(sorted(evidence_ids)).encode()
            ).hexdigest()

            # Template-based explain (zero LLM)
            days_ago = 0
            if dates:
                most_recent = max(dates)
                if most_recent.tzinfo is None:
                    most_recent = most_recent.replace(tzinfo=timezone.utc)
                days_ago = max(0, int((now - most_recent).total_seconds() / 86400))

            startup_name = startup_names.get(su_id, "Unknown")
            one_liner = (
                f"{startup_name}: {len(ev_list)} evidence items across "
                f"{len(evidence_types)} sources, latest {days_ago}d ago"
            )
            explain_json = {"one_liner": one_liner, "top_drivers": list(evidence_types)}

            # Upsert
            await conn.execute(
                """INSERT INTO signal_occurrences
                   (signal_id, startup_id, score, features_json, evidence_ids,
                    evidence_hash, explain_json, computed_at)
                   VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7::jsonb, NOW())
                   ON CONFLICT (signal_id, startup_id) DO UPDATE SET
                     score = EXCLUDED.score,
                     features_json = EXCLUDED.features_json,
                     evidence_ids = EXCLUDED.evidence_ids,
                     evidence_hash = EXCLUDED.evidence_hash,
                     explain_json = EXCLUDED.explain_json,
                     computed_at = NOW()""",
                sid,
                su_id,
                score,
                json.dumps(features.to_dict()),
                evidence_ids,
                evidence_hash,
                json.dumps(explain_json),
            )
            stats["occurrences_upserted"] += 1

    logger.info("Occurrence scoring complete: %s", stats)
    return stats


# ---------------------------------------------------------------------------
# Phase 5: Move Extraction (LLM)
# ---------------------------------------------------------------------------

async def _select_sample_startups(
    conn: asyncpg.Connection,
    signal_id: str,
    max_count: int = MAX_SAMPLE_STARTUPS,
) -> List[Dict[str, Any]]:
    """Select top startups by occurrence score with diversity constraints."""
    rows = await conn.fetch(
        """SELECT so.startup_id::text, so.score, so.evidence_hash,
                  s.name, s.slug, s.funding_stage,
                  COALESCE(s.dataset_region, 'global') AS region
           FROM signal_occurrences so
           JOIN startups s ON s.id = so.startup_id
           WHERE so.signal_id = $1::uuid
           ORDER BY so.score DESC
           LIMIT 50""",
        signal_id,
    )

    selected = []
    stage_counts: Dict[str, int] = {}

    for row in rows:
        stage = row.get("funding_stage") or "unknown"
        if stage_counts.get(stage, 0) >= MAX_PER_STAGE:
            continue

        # Require min 3 evidence items (from occurrence scoring threshold of 2+)
        selected.append({
            "startup_id": row["startup_id"],
            "name": row["name"],
            "slug": row["slug"],
            "score": float(row["score"]),
            "evidence_hash": row["evidence_hash"],
            "funding_stage": stage,
            "region": row.get("region", "global"),
        })
        stage_counts[stage] = stage_counts.get(stage, 0) + 1

        if len(selected) >= max_count:
            break

    return selected


async def _build_evidence_pack(
    conn: asyncpg.Connection,
    signal_id: str,
    startup_id: str,
    startup_name: str,
    startup_slug: str,
    funding_stage: Optional[str] = None,
    region: str = "global",
) -> EvidencePack:
    """Gather evidence snippets for one startup within a signal."""
    pack = EvidencePack(
        startup_id=startup_id,
        startup_name=startup_name,
        startup_slug=startup_slug,
        funding_stage=funding_stage,
        region=region,
    )

    # Get signal evidence (with enriched fields)
    evidence_rows = await conn.fetch(
        """SELECT se.id::text, se.snippet, se.evidence_type, se.source_url,
                  se.tags, se.structured_json, se.created_at,
                  nc.title AS cluster_title,
                  nc.builder_takeaway
           FROM signal_evidence se
           LEFT JOIN news_clusters nc ON nc.id = se.cluster_id
           WHERE se.signal_id = $1::uuid AND se.startup_id = $2::uuid
           ORDER BY se.created_at DESC
           LIMIT $3""",
        signal_id,
        startup_id,
        MAX_EVIDENCE_PER_PACK,
    )

    for r in evidence_rows:
        snippet = r["snippet"] or r.get("cluster_title") or r.get("builder_takeaway") or ""
        if not snippet.strip():
            continue
        pack.snippets.append({
            "id": r["id"],
            "snippet": snippet[:500],
            "type": r["evidence_type"],
            "source_url": r["source_url"],
            "tags": r["tags"] or [],
            "date": r["created_at"].isoformat() if r.get("created_at") else None,
        })
        pack.evidence_ids.append(r["id"])

    return pack


def _build_move_extraction_prompt(
    signal_claim: str,
    packs: List[EvidencePack],
) -> str:
    """Build the LLM prompt for batched move extraction."""
    companies_section = ""
    for pack in packs:
        snippets_text = "\n".join(
            f"  [{s['id'][:8]}] ({s['type']}) {s['snippet']}"
            for s in pack.snippets
        )
        companies_section += f"""
---
Company: {pack.startup_name} ({pack.startup_slug})
Stage: {pack.funding_stage or 'unknown'}
Evidence:
{snippets_text}
"""

    move_types_str = ", ".join(MOVE_TYPES)

    return f"""You are an expert startup analyst. Extract strategic moves from evidence.

SIGNAL: {signal_claim}

COMPANIES AND THEIR EVIDENCE:
{companies_section}

For EACH company, extract up to {MAX_MOVES_PER_STARTUP} strategic moves that demonstrate how they leveraged this signal/trend. Each move MUST cite at least one evidence_id (the 8-char prefix in brackets).

MOVE TYPES (pick one per move): {move_types_str}

Respond with ONLY valid JSON in this exact format:
{{
  "companies": [
    {{
      "slug": "company-slug",
      "moves": [
        {{
          "move_type": "one_of_the_types",
          "what_happened": "1-2 sentence description of what the company did",
          "why_it_worked": "1-2 sentence explanation of why this was effective",
          "unique_angle": "What made this approach distinctive (optional, null if nothing unique)",
          "timestamp_hint": "Approximate timeframe if evident from evidence (optional, null otherwise)",
          "evidence_ids": ["full-evidence-id-1"],
          "confidence": 0.85
        }}
      ]
    }}
  ]
}}

RULES:
- If you can't cite an evidence_id for a move, OMIT the move entirely.
- Be specific and factual. No speculation.
- Confidence should reflect how well-supported the move is (0.5-1.0).
- Return empty moves array [] if evidence is insufficient for a company."""


async def extract_moves_for_signal(
    conn: asyncpg.Connection,
    signal_id: str,
    signal_claim: str,
    sample_startups: List[Dict[str, Any]],
    force: bool = False,
) -> Dict[str, Any]:
    """Extract strategic moves for a signal's top startups using LLM.

    Returns stats dict.
    """
    client = _create_llm_client()
    if not client:
        logger.warning("No LLM client available, skipping move extraction")
        return {"extracted": 0, "skipped": "no_llm_client"}

    model = settings.azure_openai.fast_model
    stats = {"extracted": 0, "skipped": 0, "errors": 0}

    # Build evidence packs
    packs: List[EvidencePack] = []
    for startup in sample_startups:
        # Check if evidence hash unchanged (skip if cached)
        if not force:
            existing = await conn.fetchrow(
                """SELECT evidence_hash FROM signal_moves
                   WHERE signal_id = $1::uuid AND startup_id = $2::uuid
                   LIMIT 1""",
                signal_id, startup["startup_id"],
            )
            if existing and existing["evidence_hash"] == startup.get("evidence_hash"):
                stats["skipped"] += 1
                continue

        pack = await _build_evidence_pack(
            conn, signal_id, startup["startup_id"],
            startup["name"], startup["slug"],
            startup.get("funding_stage"), startup.get("region", "global"),
        )
        if len(pack.snippets) >= 2:
            packs.append(pack)

    if not packs:
        logger.info("No packs to process for signal %s", signal_id[:8])
        return stats

    # Process in batches
    for batch_start in range(0, len(packs), BATCH_SIZE_STARTUPS):
        batch = packs[batch_start:batch_start + BATCH_SIZE_STARTUPS]

        prompt = _build_move_extraction_prompt(signal_claim, batch)

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You extract structured strategic moves from startup evidence. Respond only with valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
                **llm_kwargs(model, max_tokens=2000),
            )

            content = response.choices[0].message.content
            if not content:
                stats["errors"] += 1
                continue

            parsed = json.loads(content)
            companies = parsed.get("companies", [])

            # Map slugs to packs for evidence_hash
            slug_to_pack = {p.startup_slug: p for p in batch}

            for company_data in companies:
                slug = company_data.get("slug", "")
                pack = slug_to_pack.get(slug)
                if not pack:
                    continue

                evidence_hash = hashlib.sha256(
                    "|".join(sorted(pack.evidence_ids)).encode()
                ).hexdigest()

                # Delete old moves for this startup+signal
                await conn.execute(
                    "DELETE FROM signal_moves WHERE signal_id = $1::uuid AND startup_id = $2::uuid",
                    signal_id, pack.startup_id,
                )

                for move in company_data.get("moves", [])[:MAX_MOVES_PER_STARTUP]:
                    move_type = move.get("move_type", "")
                    if move_type not in MOVE_TYPES:
                        continue

                    # Validate evidence_ids reference actual evidence
                    cited_ids = move.get("evidence_ids", [])
                    valid_ids = [eid for eid in cited_ids if any(
                        eid.startswith(pe[:8]) or eid == pe for pe in pack.evidence_ids
                    )]
                    # Resolve short IDs to full IDs
                    resolved_ids = []
                    for cid in valid_ids:
                        for full_id in pack.evidence_ids:
                            if full_id.startswith(cid) or full_id == cid:
                                resolved_ids.append(full_id)
                                break

                    if not resolved_ids:
                        continue  # Hard rule: must cite evidence

                    await conn.execute(
                        """INSERT INTO signal_moves
                           (signal_id, startup_id, move_type, what_happened,
                            why_it_worked, unique_angle, timestamp_hint,
                            evidence_ids, evidence_hash, extraction_model,
                            confidence, extracted_at)
                           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7,
                                   $8, $9, $10, $11, NOW())""",
                        signal_id,
                        pack.startup_id,
                        move_type,
                        move.get("what_happened", ""),
                        move.get("why_it_worked"),
                        move.get("unique_angle"),
                        move.get("timestamp_hint"),
                        resolved_ids,
                        evidence_hash,
                        model,
                        move.get("confidence", 0.5),
                    )
                    stats["extracted"] += 1

        except Exception as exc:
            logger.error("Move extraction failed for batch: %s", exc)
            stats["errors"] += 1

    logger.info("Move extraction for signal %s: %s", signal_id[:8], stats)
    return stats


# ---------------------------------------------------------------------------
# Phase 6: Deep Dive Synthesis (LLM)
# ---------------------------------------------------------------------------

def _build_synthesis_prompt(
    signal: Dict[str, Any],
    sample_companies: List[Dict[str, Any]],
    moves_by_startup: Dict[str, List[Dict[str, Any]]],
    aggregate_stats: Dict[str, Any],
) -> str:
    """Build the LLM prompt for deep dive synthesis."""
    companies_section = ""
    for company in sample_companies:
        slug = company["slug"]
        moves = moves_by_startup.get(company["startup_id"], [])
        moves_text = "\n".join(
            f"  - [{m['move_type']}] {m['what_happened']}"
            + (f" → {m['why_it_worked']}" if m.get('why_it_worked') else "")
            for m in moves
        )
        companies_section += f"""
Company: {company['name']} ({slug}) | Stage: {company.get('funding_stage', 'unknown')} | Score: {company['score']:.2f}
Moves:
{moves_text or '  (no extracted moves)'}
"""

    return f"""You are a senior investment analyst creating a deep dive report on a startup signal.

SIGNAL:
- Claim: {signal['claim']}
- Domain: {signal['domain']}
- Status: {signal['status']}
- Conviction: {signal['conviction']:.0%}
- Momentum: {signal['momentum']:.0%}
- Impact: {signal['impact']:.0%}
- Companies tracked: {signal['unique_company_count']}
- Evidence items: {signal['evidence_count']}

AGGREGATE STATS:
- Stage distribution: {json.dumps(aggregate_stats.get('stage_distribution', {}))}
- Source mix: {json.dumps(aggregate_stats.get('source_mix', {}))}
- Average score: {aggregate_stats.get('avg_score', 0):.2f}

SAMPLE COMPANIES AND MOVES:
{companies_section}

Generate a complete deep dive report as JSON with this exact structure:
{{
  "tldr": "2-3 sentence executive summary (max 300 chars)",
  "mechanism": "What this signal measures and why it matters (2-3 paragraphs, max 800 chars)",
  "patterns": [
    {{"archetype": "Name of pattern (e.g. 'The Open Source Wedge')", "description": "How this archetype plays out", "startups": ["slug1", "slug2"]}}
  ],
  "case_studies": [
    {{
      "startup_slug": "slug",
      "startup_name": "Company Name",
      "summary": "2-3 sentence overview of how they leveraged this trend",
      "key_moves": ["Move 1 description", "Move 2 description"]
    }}
  ],
  "thresholds": [
    {{"metric": "Metric name", "value": "Threshold value", "action": "What to do when threshold is crossed"}}
  ],
  "failure_modes": [
    {{"mode": "Failure mode name", "description": "What goes wrong and why", "example": "Optional real example or null"}}
  ],
  "watchlist": [
    {{"startup_slug": "slug", "why": "Why this company is worth watching"}}
  ]
}}

RULES:
- Be specific and actionable. Avoid generic advice.
- Case studies must reference companies from the sample list above.
- Patterns should generalize across the sample companies.
- Thresholds should be concrete metrics investors/builders can track.
- Failure modes should be realistic based on the evidence.
- Watchlist should highlight 2-4 companies showing early signs of breaking out.
- Keep total response under 5000 tokens."""


async def synthesize_deep_dive(
    conn: asyncpg.Connection,
    signal_id: str,
    sample_startups: List[Dict[str, Any]],
    force: bool = False,
) -> Optional[Dict[str, Any]]:
    """Synthesize a deep dive for a single signal.

    Returns the content_json if successful, None otherwise.
    """
    # Get signal info
    signal = await conn.fetchrow(
        """SELECT id::text, claim, domain, status, conviction, momentum, impact,
                  adoption_velocity, evidence_count, unique_company_count, region
           FROM signals WHERE id = $1::uuid""",
        signal_id,
    )
    if not signal:
        logger.warning("Signal %s not found", signal_id[:8])
        return None

    # Check if we can skip (evidence hash unchanged)
    current_hash = hashlib.sha256(
        "|".join(sorted(s["startup_id"] for s in sample_startups)).encode()
    ).hexdigest()

    if not force:
        latest = await conn.fetchrow(
            """SELECT evidence_hash, version FROM signal_deep_dives
               WHERE signal_id = $1::uuid AND status = 'ready'
               ORDER BY version DESC LIMIT 1""",
            signal_id,
        )
        if latest and latest["evidence_hash"] == current_hash:
            logger.info("Deep dive for signal %s unchanged, skipping", signal_id[:8])
            return None

    # Get moves for sample startups
    moves_by_startup: Dict[str, List[Dict[str, Any]]] = {}
    for s in sample_startups:
        move_rows = await conn.fetch(
            """SELECT move_type, what_happened, why_it_worked, unique_angle,
                      confidence
               FROM signal_moves
               WHERE signal_id = $1::uuid AND startup_id = $2::uuid
               ORDER BY confidence DESC""",
            signal_id, s["startup_id"],
        )
        moves_by_startup[s["startup_id"]] = [dict(r) for r in move_rows]

    # Compute aggregate stats
    occ_rows = await conn.fetch(
        """SELECT so.score, s.funding_stage
           FROM signal_occurrences so
           JOIN startups s ON s.id = so.startup_id
           WHERE so.signal_id = $1::uuid""",
        signal_id,
    )
    stage_dist: Dict[str, int] = {}
    scores = []
    for r in occ_rows:
        stage = r.get("funding_stage") or "unknown"
        stage_dist[stage] = stage_dist.get(stage, 0) + 1
        scores.append(float(r["score"]))

    # Source mix from evidence
    source_rows = await conn.fetch(
        """SELECT evidence_type, COUNT(*) AS cnt
           FROM signal_evidence
           WHERE signal_id = $1::uuid
           GROUP BY evidence_type""",
        signal_id,
    )
    source_mix = {r["evidence_type"]: r["cnt"] for r in source_rows}

    aggregate_stats = {
        "stage_distribution": stage_dist,
        "source_mix": source_mix,
        "avg_score": sum(scores) / len(scores) if scores else 0,
    }

    # Determine next version
    last_version = await conn.fetchval(
        "SELECT COALESCE(MAX(version), 0) FROM signal_deep_dives WHERE signal_id = $1::uuid",
        signal_id,
    )
    new_version = last_version + 1

    # Create placeholder row
    dive_id = await conn.fetchval(
        """INSERT INTO signal_deep_dives
           (signal_id, version, status, sample_startup_ids, sample_count, evidence_hash)
           VALUES ($1::uuid, $2, 'generating', $3, $4, $5)
           RETURNING id::text""",
        signal_id, new_version,
        [s["startup_id"] for s in sample_startups],
        len(sample_startups),
        current_hash,
    )

    # Call LLM
    client = _create_llm_client()
    if not client:
        await conn.execute(
            "UPDATE signal_deep_dives SET status = 'failed' WHERE id = $1::uuid",
            dive_id,
        )
        return None

    model = settings.azure_openai.fast_model
    prompt = _build_synthesis_prompt(
        dict(signal), sample_startups, moves_by_startup, aggregate_stats,
    )

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a senior investment analyst. Generate structured deep dive reports as JSON."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            **llm_kwargs(model, max_tokens=4000),
        )

        content = response.choices[0].message.content
        if not content:
            raise ValueError("Empty LLM response")

        content_json = json.loads(content)
        total_tokens = (
            (response.usage.prompt_tokens if response.usage else 0)
            + (response.usage.completion_tokens if response.usage else 0)
        )

        # Update deep dive row
        await conn.execute(
            """UPDATE signal_deep_dives
               SET status = 'ready',
                   content_json = $2::jsonb,
                   generation_model = $3,
                   generation_cost_tokens = $4
               WHERE id = $1::uuid""",
            dive_id,
            json.dumps(content_json),
            model,
            total_tokens,
        )

        # Compute diff from previous version
        if last_version > 0:
            await _compute_version_diff(conn, signal_id, last_version, new_version)

        logger.info(
            "Deep dive synthesized for signal %s v%d (%d tokens)",
            signal_id[:8], new_version, total_tokens,
        )
        return content_json

    except Exception as exc:
        logger.error("Deep dive synthesis failed for signal %s: %s", signal_id[:8], exc)
        await conn.execute(
            "UPDATE signal_deep_dives SET status = 'failed' WHERE id = $1::uuid",
            dive_id,
        )
        return None


async def _compute_version_diff(
    conn: asyncpg.Connection,
    signal_id: str,
    from_version: int,
    to_version: int,
) -> None:
    """Compute diff between two deep dive versions."""
    rows = await conn.fetch(
        """SELECT version, sample_startup_ids, content_json
           FROM signal_deep_dives
           WHERE signal_id = $1::uuid AND version IN ($2, $3) AND status = 'ready'
           ORDER BY version""",
        signal_id, from_version, to_version,
    )
    if len(rows) < 2:
        return

    old_row, new_row = rows[0], rows[1]
    old_samples = set(old_row["sample_startup_ids"] or [])
    new_samples = set(new_row["sample_startup_ids"] or [])

    old_content = old_row["content_json"] if isinstance(old_row["content_json"], dict) else json.loads(old_row["content_json"])
    new_content = new_row["content_json"] if isinstance(new_row["content_json"], dict) else json.loads(new_row["content_json"])

    diff = {
        "samples_added": list(new_samples - old_samples),
        "samples_removed": list(old_samples - new_samples),
        "case_studies_count_old": len(old_content.get("case_studies", [])),
        "case_studies_count_new": len(new_content.get("case_studies", [])),
        "patterns_count_old": len(old_content.get("patterns", [])),
        "patterns_count_new": len(new_content.get("patterns", [])),
    }

    await conn.execute(
        """INSERT INTO signal_deep_dive_diffs
           (signal_id, from_version, to_version, diff_json)
           VALUES ($1::uuid, $2, $3, $4::jsonb)
           ON CONFLICT (signal_id, from_version, to_version) DO UPDATE SET
             diff_json = EXCLUDED.diff_json""",
        signal_id, from_version, to_version, json.dumps(diff),
    )


# ---------------------------------------------------------------------------
# Full pipeline orchestrator
# ---------------------------------------------------------------------------

async def generate_deep_dives(
    signal_id: Optional[str] = None,
    top_n: int = MAX_SIGNALS_PER_RUN,
    region: Optional[str] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Run the full deep dive pipeline: evidence enrichment → occurrence scoring →
    move extraction → synthesis.

    Args:
        signal_id: Optional specific signal.
        top_n: Max signals to process.
        region: Filter by region.
        force: Force re-generation even if evidence unchanged.

    Returns:
        Stats dict.
    """
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    conn = await asyncpg.connect(database_url)
    stats = {
        "evidence_enriched": 0,
        "occurrences_computed": 0,
        "moves_extracted": 0,
        "dives_synthesized": 0,
        "errors": 0,
    }

    try:
        # Phase 3: Enrich evidence
        enriched = await enrich_evidence(conn, signal_id)
        stats["evidence_enriched"] = enriched

        # Phase 4: Compute occurrences
        occ_stats = await compute_signal_occurrences(conn, signal_id, region)
        stats["occurrences_computed"] = occ_stats.get("occurrences_upserted", 0)

        # Get target signals for phases 5-6
        conditions = ["status IN ('emerging', 'accelerating', 'established')"]
        params: List[Any] = []
        idx = 1
        if signal_id:
            conditions.append(f"id = ${idx}::uuid")
            params.append(signal_id)
            idx += 1
        if region:
            conditions.append(f"region = ${idx}")
            params.append(region)
            idx += 1

        where = " AND ".join(conditions)
        signals = await conn.fetch(
            f"""SELECT id::text, claim
                FROM signals
                WHERE {where}
                ORDER BY conviction DESC
                LIMIT {top_n}""",
            *params,
        )

        for sig in signals:
            try:
                # Select sample startups
                samples = await _select_sample_startups(conn, sig["id"])
                if len(samples) < 2:
                    logger.debug("Signal %s has too few samples (%d), skipping", sig["id"][:8], len(samples))
                    continue

                # Phase 5: Extract moves
                move_stats = await extract_moves_for_signal(
                    conn, sig["id"], sig["claim"], samples, force,
                )
                stats["moves_extracted"] += move_stats.get("extracted", 0)

                # Phase 6: Synthesize deep dive
                content = await synthesize_deep_dive(conn, sig["id"], samples, force)
                if content:
                    stats["dives_synthesized"] += 1

            except Exception as exc:
                logger.error("Error processing signal %s: %s", sig["id"][:8], exc)
                stats["errors"] += 1

    finally:
        await conn.close()

    logger.info("Deep dive generation complete: %s", stats)
    return stats
