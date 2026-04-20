"""Ecosystem memory — long-horizon facts that feed daily-brief commentary.

Extends the per-entity Memory Gate (memory_gate.py) with a third layer:
ecosystem-level facts about a region or sector that don't fit the
per-entity schema ("Turkey has 7 unicorns", "mobile gaming is dominant").

Tables (migration 084):

    news_ecosystem_facts    — the facts themselves, region-aware, with
                              supersession + is_current flag
    news_ecosystem_sources  — provenance for external docs we distilled
                              facts from (KPMG PDFs, blog posts, YouTube
                              transcripts)
    startup_exclusions      — canonical blocklist of non-startup Turkish
                              entities (A101, banks, telcos, media)

This module provides the YAML seed loaders for all three tables plus a
read API for the daily brief's editorial memory fetcher.

Design notes:

* Seed loaders are idempotent. Running twice upserts via the natural
  key (region, sector, fact_key for facts; entity_name_norm + region
  for exclusions). Supersession is manual (is_current flip) rather
  than via a partial unique index, per project rule:
  "Partial unique indexes break ON CONFLICT".
* PDF / blog / YouTube ingestion lives alongside these loaders in
  later phases (PR #4.4–4.6) and writes to the same two fact/source
  tables with `source_type != 'curated'`.
* No LLM calls here — seed loading is a pure YAML → DB operation.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

try:
    import asyncpg
except ImportError:  # pragma: no cover — optional at module load
    asyncpg = None

import yaml

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[4]
SEED_DIR = REPO_ROOT / "database" / "seed"
ECOSYSTEM_FACTS_SEED = SEED_DIR / "ecosystem_facts_seed.yaml"
STARTUP_EXCLUSIONS_SEED = SEED_DIR / "startup_exclusions_seed.yaml"


# ---------------------------------------------------------------------------
# YAML helpers
# ---------------------------------------------------------------------------


def _load_yaml_list(path: Path) -> List[Dict[str, Any]]:
    """Load a YAML file expected to contain a top-level list of dicts."""
    if not path.exists():
        raise FileNotFoundError(f"Seed file not found: {path}")
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or []
    if not isinstance(data, list):
        raise ValueError(f"Seed file must be a YAML list: {path}")
    return [d for d in data if isinstance(d, dict)]


def _to_date(value: Any) -> date:
    """Coerce a YAML date/string into a Python `date`."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        return datetime.strptime(value.strip(), "%Y-%m-%d").date()
    raise TypeError(f"Cannot coerce {value!r} ({type(value).__name__}) to date")


# ---------------------------------------------------------------------------
# Curated source — the umbrella provenance record all seed facts point at
# ---------------------------------------------------------------------------

CURATED_SOURCE_KEY = "seed_curated_v1"


async def _ensure_curated_source(conn: "asyncpg.Connection") -> str:
    """Create or fetch the umbrella 'curated' source record.

    Curated seed facts share one provenance row so callers can query
    "which facts came from curated vs. ingested docs?" with a join.
    """
    row = await conn.fetchrow(
        "SELECT id::text AS id FROM news_ecosystem_sources WHERE source_key = $1",
        CURATED_SOURCE_KEY,
    )
    if row:
        return str(row["id"])
    inserted = await conn.fetchrow(
        """
        INSERT INTO news_ecosystem_sources (
            source_key, source_type, title, publisher, region, content_hash,
            distilled_fact_count, processed_at
        )
        VALUES ($1, 'curated', $2, 'BuildAtlas curation', 'both', $3, 0, now())
        RETURNING id::text AS id
        """,
        CURATED_SOURCE_KEY,
        "Curated baseline ecosystem facts (YAML seed)",
        hashlib.sha256(b"curated-v1").hexdigest(),
    )
    return str(inserted["id"])


# ---------------------------------------------------------------------------
# Ecosystem facts loader
# ---------------------------------------------------------------------------


async def load_ecosystem_facts_seed(
    conn: "asyncpg.Connection",
    *,
    seed_path: Optional[Path] = None,
) -> Dict[str, int]:
    """Upsert curated ecosystem facts from the seed YAML.

    Returns stats: {'inserted': N, 'superseded': M, 'unchanged': K, 'total': T}.
    """
    path = seed_path or ECOSYSTEM_FACTS_SEED
    raw = _load_yaml_list(path)
    curated_source_id = await _ensure_curated_source(conn)

    inserted = 0
    superseded = 0
    unchanged = 0

    for entry in raw:
        region = str(entry["region"]).strip()
        sector = entry.get("sector")
        fact_key = str(entry["fact_key"]).strip()
        fact_value = entry["fact_value"]
        if not isinstance(fact_value, (dict, list)):
            fact_value = {"value": fact_value}
        narrative = str(entry["narrative"]).strip()
        source_type = str(entry.get("source_type", "curated")).strip()
        as_of = _to_date(entry["as_of_date"])
        valid_until = _to_date(entry["valid_until"]) if entry.get("valid_until") else None
        confidence = float(entry.get("confidence", 0.8))

        # Look up the existing current row for this (region, sector, fact_key).
        existing = await conn.fetchrow(
            """
            SELECT id::text AS id, narrative, fact_value::text AS fact_value_text,
                   confidence, as_of_date
            FROM news_ecosystem_facts
            WHERE region = $1
              AND COALESCE(sector, '') = COALESCE($2, '')
              AND fact_key = $3
              AND is_current = TRUE
            """,
            region,
            sector,
            fact_key,
        )

        fact_value_json = json.dumps(fact_value, sort_keys=True, ensure_ascii=False, default=str)
        if existing:
            if (
                existing["narrative"] == narrative
                and existing["fact_value_text"] == fact_value_json
                and abs(float(existing["confidence"]) - confidence) < 1e-6
                and existing["as_of_date"] == as_of
            ):
                unchanged += 1
                continue
            new_id = await conn.fetchval(
                """
                INSERT INTO news_ecosystem_facts (
                    region, sector, fact_key, fact_value, narrative,
                    source_type, source_ref_id, as_of_date, valid_until,
                    confidence, is_current
                )
                VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::uuid, $8, $9, $10, TRUE)
                RETURNING id::text
                """,
                region,
                sector,
                fact_key,
                fact_value_json,
                narrative,
                source_type,
                curated_source_id,
                as_of,
                valid_until,
                confidence,
            )
            await conn.execute(
                """
                UPDATE news_ecosystem_facts
                SET is_current = FALSE, superseded_by = $1::uuid, updated_at = now()
                WHERE id = $2::uuid
                """,
                new_id,
                existing["id"],
            )
            superseded += 1
        else:
            await conn.execute(
                """
                INSERT INTO news_ecosystem_facts (
                    region, sector, fact_key, fact_value, narrative,
                    source_type, source_ref_id, as_of_date, valid_until,
                    confidence, is_current
                )
                VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::uuid, $8, $9, $10, TRUE)
                """,
                region,
                sector,
                fact_key,
                fact_value_json,
                narrative,
                source_type,
                curated_source_id,
                as_of,
                valid_until,
                confidence,
            )
            inserted += 1

    total = inserted + superseded + unchanged
    await conn.execute(
        "UPDATE news_ecosystem_sources SET distilled_fact_count = $1, updated_at = now() "
        "WHERE source_key = $2",
        total,
        CURATED_SOURCE_KEY,
    )
    return {
        "inserted": inserted,
        "superseded": superseded,
        "unchanged": unchanged,
        "total": total,
    }


# ---------------------------------------------------------------------------
# startup_exclusions loader
# ---------------------------------------------------------------------------


async def load_startup_exclusions_seed(
    conn: "asyncpg.Connection",
    *,
    seed_path: Optional[Path] = None,
) -> Dict[str, int]:
    """Upsert the non-startup entity blocklist from the seed YAML.

    Case-insensitive natural key is (lower(entity_name), region). Running
    twice is a no-op on unchanged rows and a category/reason update otherwise.
    """
    path = seed_path or STARTUP_EXCLUSIONS_SEED
    raw = _load_yaml_list(path)
    inserted = 0
    updated = 0
    unchanged = 0

    for entry in raw:
        entity_name = str(entry["entity_name"]).strip()
        if not entity_name:
            continue
        category = str(entry["category"]).strip()
        reason = entry.get("reason")
        region = str(entry.get("region", "turkey")).strip()

        # Normalized form matches the generated column's formula.
        entity_norm = " ".join(entity_name.split()).lower()

        existing = await conn.fetchrow(
            """
            SELECT id::text AS id, category, reason
            FROM startup_exclusions
            WHERE entity_name_norm = $1 AND region = $2
            """,
            entity_norm,
            region,
        )
        if existing:
            if existing["category"] == category and (existing["reason"] or "") == (reason or ""):
                unchanged += 1
                continue
            await conn.execute(
                """
                UPDATE startup_exclusions
                SET category = $1, reason = $2
                WHERE id = $3::uuid
                """,
                category,
                reason,
                existing["id"],
            )
            updated += 1
        else:
            # Postgres's generated `entity_name_norm` column may collapse two
            # visually-different entries (e.g. ASCII "BIM" vs Turkish "BİM")
            # to the same normalized key via its locale-specific lower().
            # Our Python normalization doesn't always match that collapse,
            # so fall back to the unique-index conflict: on dup, update.
            try:
                await conn.execute(
                    """
                    INSERT INTO startup_exclusions (entity_name, category, reason, region)
                    VALUES ($1, $2, $3, $4)
                    """,
                    entity_name,
                    category,
                    reason,
                    region,
                )
                inserted += 1
            except Exception as exc:
                if "idx_startup_exclusions_name" not in str(exc):
                    raise
                # Same normalized key already inserted this run — treat as dup.
                unchanged += 1

    return {
        "inserted": inserted,
        "updated": updated,
        "unchanged": unchanged,
        "total": inserted + updated + unchanged,
    }


# ---------------------------------------------------------------------------
# Reader API — used by daily-brief editorial memory fetcher (PR #4.3)
# ---------------------------------------------------------------------------


async def load_startups_watch_facts(
    conn: "asyncpg.Connection",
    *,
    region: str = "turkey",
    limit: int = 10,
    freshness_months: int = 36,
) -> List[Dict[str, Any]]:
    """Fetch startups.watch-attributed facts specifically.

    Separate from the global ranking because startups.watch quarterly/annual
    reports naturally have older as_of_dates and get outranked on a
    confidence×recency ordering. Daily-brief commentary benefits from a
    guaranteed floor of these benchmark facts (+31% YoY deal count, CVC
    count, sector cadence) as a canonical trend anchor.
    """
    regions: Sequence[str] = ("global",) if region == "global" else ("global", "turkey")
    rows = await conn.fetch(
        """
        SELECT f.region, f.sector, f.fact_key, f.narrative,
               f.as_of_date, f.confidence,
               s.publisher, s.source_type AS source_doc_type,
               s.period_covered
        FROM news_ecosystem_facts f
        JOIN news_ecosystem_sources s ON f.source_ref_id = s.id
        WHERE f.is_current = TRUE
          AND f.region = ANY($1::text[])
          AND f.as_of_date >= (CURRENT_DATE - ($2::int || ' months')::interval)
          AND (
            lower(coalesce(s.publisher,'')) LIKE 'startups.watch%'
            OR lower(coalesce(s.publisher,'')) LIKE '%@startupswatch%'
          )
        ORDER BY f.confidence DESC, f.as_of_date DESC
        LIMIT $3
        """,
        list(regions),
        freshness_months,
        limit,
    )
    return [
        {
            "region": str(r["region"]),
            "sector": r["sector"],
            "fact_key": r["fact_key"],
            "narrative": r["narrative"],
            "as_of_date": r["as_of_date"].isoformat() if r["as_of_date"] else None,
            "confidence": float(r["confidence"]),
            "publisher": r["publisher"],
            "period_covered": r["period_covered"],
        }
        for r in rows
    ]


async def load_ecosystem_facts_for_brief(
    conn: "asyncpg.Connection",
    *,
    region: str,
    limit: int = 15,
    freshness_months: int = 18,
) -> List[Dict[str, Any]]:
    """Return the top-N current ecosystem facts for a given brief region.

    Turkey briefs receive global + turkey facts (one-way merge, same
    convention as news_entity_facts). Ordering favors higher confidence
    and more-recent facts. Publisher info is joined in so callers can
    route startups.watch-derived trend facts into a dedicated prompt
    bucket (PR #4.9).
    """
    regions: Sequence[str] = ("global",) if region == "global" else ("global", "turkey")
    rows = await conn.fetch(
        """
        SELECT f.region, f.sector, f.fact_key, f.narrative,
               f.as_of_date, f.confidence,
               s.publisher, s.source_type AS source_doc_type,
               s.period_covered
        FROM news_ecosystem_facts f
        LEFT JOIN news_ecosystem_sources s ON f.source_ref_id = s.id
        WHERE f.is_current = TRUE
          AND f.region = ANY($1::text[])
          AND f.as_of_date >= (CURRENT_DATE - ($2::int || ' months')::interval)
        ORDER BY (f.confidence * (1.0 / GREATEST(1, CURRENT_DATE - f.as_of_date))) DESC,
                 f.as_of_date DESC
        LIMIT $3
        """,
        list(regions),
        freshness_months,
        limit,
    )
    return [
        {
            "region": str(r["region"]),
            "sector": r["sector"],
            "fact_key": r["fact_key"],
            "narrative": r["narrative"],
            "as_of_date": r["as_of_date"].isoformat() if r["as_of_date"] else None,
            "confidence": float(r["confidence"]),
            "publisher": r["publisher"],
            "source_doc_type": r["source_doc_type"],
            "period_covered": r["period_covered"],
        }
        for r in rows
    ]


async def load_exclusion_index(
    conn: "asyncpg.Connection",
    *,
    region: str = "turkey",
) -> Dict[str, Dict[str, Any]]:
    """Load the exclusion blocklist into a dict keyed by lowercased name.

    Called once at ingest start (PR #4.2). Each value carries the category
    and override startup id so the caller can enforce whitelists.
    """
    rows = await conn.fetch(
        """
        SELECT entity_name, entity_name_norm, category, reason,
               overridden_by_startup_id::text AS override_id
        FROM startup_exclusions
        WHERE region = $1
        """,
        region,
    )
    return {
        str(r["entity_name_norm"]): {
            "entity_name": str(r["entity_name"]),
            "category": str(r["category"]),
            "reason": r["reason"],
            "override_id": r["override_id"],
        }
        for r in rows
    }


# ---------------------------------------------------------------------------
# CLI entry point — `python -m src.intelligence.ecosystem_memory --seed`
# ---------------------------------------------------------------------------


async def _seed_main() -> None:
    if asyncpg is None:
        raise RuntimeError("asyncpg not installed")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL env var is required")

    pool = await asyncpg.create_pool(database_url, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            facts_stats = await load_ecosystem_facts_seed(conn)
            excl_stats = await load_startup_exclusions_seed(conn)
    finally:
        await pool.close()

    print(json.dumps({"facts": facts_stats, "exclusions": excl_stats}, indent=2))


if __name__ == "__main__":  # pragma: no cover
    asyncio.run(_seed_main())
