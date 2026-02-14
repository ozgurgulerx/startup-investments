"""Backfill canonical evidence_objects for existing news rows.

This is intentionally idempotent and safe to re-run.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import asyncpg

from .evidence_objects import replace_members, stable_hash, upsert_evidence_object

logger = logging.getLogger(__name__)


async def backfill_news_evidence_objects(
    conn: asyncpg.Connection,
    *,
    days: int = 30,
    region: str = "all",
    limit: int = 2000,
) -> Dict[str, Any]:
    """Backfill evidence_objects for news_items_raw and news_clusters.

    Args:
      days: lookback window
      region: 'global' | 'turkey' | 'all'
      limit: cap processed rows per table (per run)
    """
    stats: Dict[str, Any] = {
        "raw_items_seen": 0,
        "raw_items_backfilled": 0,
        "clusters_seen": 0,
        "clusters_backfilled": 0,
        "members_written": 0,
        "skipped": False,
        "error": None,
    }

    try:
        ok = await conn.fetchval("SELECT to_regclass('public.evidence_objects') IS NOT NULL AS ok")
        if not ok:
            stats["skipped"] = True
            stats["error"] = "evidence_objects table missing"
            return stats
        ptr_ok = await conn.fetchval(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'news_items_raw' AND column_name = 'evidence_object_id'
            LIMIT 1
            """
        )
        if not ptr_ok:
            stats["skipped"] = True
            stats["error"] = "news_items_raw.evidence_object_id column missing"
            return stats
    except Exception as exc:
        stats["skipped"] = True
        stats["error"] = f"capability check failed: {exc}"
        return stats

    since = datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))
    safe_limit = max(1, min(20_000, int(limit)))

    # ------------------------------------------------------------------
    # 1) news_items_raw -> evidence_objects
    # ------------------------------------------------------------------
    raw_rows = await conn.fetch(
        """
        SELECT
            nir.id::text AS raw_id,
            ns.source_key,
            nir.external_id,
            nir.url,
            nir.canonical_url,
            COALESCE(nir.published_at, nir.fetched_at) AS captured_at,
            nir.language,
            ns.credibility_weight,
            nir.evidence_object_id::text AS evidence_object_id
        FROM news_items_raw nir
        JOIN news_sources ns ON ns.id = nir.source_id
        WHERE nir.evidence_object_id IS NULL
          AND COALESCE(nir.published_at, nir.fetched_at) >= $1::timestamptz
        ORDER BY COALESCE(nir.published_at, nir.fetched_at) DESC
        LIMIT $2
        """,
        since,
        safe_limit,
    )
    stats["raw_items_seen"] = len(raw_rows)

    for r in raw_rows:
        raw_id = str(r["raw_id"])
        source_key = str(r["source_key"] or "")
        external_id = str(r["external_id"] or "")
        canonical_url = str(r["canonical_url"] or "")
        url = str(r["url"] or canonical_url)
        captured_at = r["captured_at"] or datetime.now(timezone.utc)
        language = str(r["language"] or "en")
        weight = float(r["credibility_weight"] or 0.5)

        h = stable_hash(["news_item", source_key, external_id, canonical_url])
        evidence_id = await upsert_evidence_object(
            conn,
            evidence_type="news_item",
            uri=canonical_url or url,
            captured_at=captured_at,
            source_weight=weight,
            language=language,
            content_ref=f"db://news_items_raw/{raw_id}",
            hash_value=h,
            provenance={
                "source_key": source_key,
                "external_id": external_id,
                "url": url,
                "canonical_url": canonical_url,
            },
        )
        await conn.execute(
            """
            UPDATE news_items_raw
            SET evidence_object_id = $2::uuid
            WHERE id = $1::uuid AND evidence_object_id IS NULL
            """,
            raw_id,
            evidence_id,
        )
        stats["raw_items_backfilled"] += 1

    # ------------------------------------------------------------------
    # 2) news_clusters -> evidence_objects (+ members)
    # ------------------------------------------------------------------
    region_norm = (region or "all").strip().lower()
    if region_norm not in {"all", "global", "turkey", "tr"}:
        region_norm = "all"
    if region_norm == "tr":
        region_norm = "turkey"

    has_region = bool(
        await conn.fetchval(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'news_clusters' AND column_name = 'region'
            LIMIT 1
            """
        )
    )

    region_filter = ""
    params = [since, safe_limit]
    if has_region and region_norm in {"global", "turkey"}:
        region_filter = " AND c.region = $3"
        params.append(region_norm)

    cluster_rows = await conn.fetch(
        f"""
        SELECT
            c.id::text AS cluster_id,
            c.cluster_key,
            COALESCE(c.region, 'global') AS region,
            c.canonical_url,
            c.published_at AS captured_at,
            c.trust_score,
            c.evidence_object_id::text AS evidence_object_id
        FROM news_clusters c
        WHERE c.evidence_object_id IS NULL
          AND c.published_at >= $1::timestamptz
          {region_filter}
        ORDER BY c.published_at DESC
        LIMIT $2
        """,
        *params,
    )
    stats["clusters_seen"] = len(cluster_rows)

    for c in cluster_rows:
        cluster_id = str(c["cluster_id"])
        cluster_key = str(c["cluster_key"] or "")
        cluster_region = str(c["region"] or "global")
        uri = str(c["canonical_url"] or f"news_cluster:{cluster_key}")
        captured_at = c["captured_at"] or datetime.now(timezone.utc)
        weight = float(c["trust_score"] or 0.5)

        h = stable_hash(["news_cluster", cluster_key, cluster_region])
        cluster_evidence_id = await upsert_evidence_object(
            conn,
            evidence_type="news_cluster",
            uri=uri,
            captured_at=captured_at,
            source_weight=weight,
            language="en",
            content_ref=f"db://news_clusters/{cluster_id}",
            hash_value=h,
            provenance={
                "cluster_key": cluster_key,
                "region": cluster_region,
                "cluster_id": cluster_id,
            },
        )
        await conn.execute(
            """
            UPDATE news_clusters
            SET evidence_object_id = $2::uuid
            WHERE id = $1::uuid AND evidence_object_id IS NULL
            """,
            cluster_id,
            cluster_evidence_id,
        )
        stats["clusters_backfilled"] += 1

        # Member mapping (best-effort; only for members with raw evidence objects)
        try:
            member_rows = await conn.fetch(
                """
                SELECT
                    nir.evidence_object_id::text AS member_evidence_id,
                    nci.is_primary
                FROM news_cluster_items nci
                JOIN news_items_raw nir ON nir.id = nci.raw_item_id
                WHERE nci.cluster_id = $1::uuid
                  AND nir.evidence_object_id IS NOT NULL
                """,
                cluster_id,
            )
            members = [
                (str(m["member_evidence_id"]), bool(m["is_primary"]))
                for m in member_rows
                if m.get("member_evidence_id")
            ]
            written = await replace_members(conn, evidence_id=cluster_evidence_id, members=members)
            stats["members_written"] += int(written or 0)
        except Exception:
            continue

    return stats


def run_backfill_news_evidence_objects_sync(
    *,
    database_url: str,
    days: int = 30,
    region: str = "all",
    limit: int = 2000,
) -> Dict[str, Any]:
    """Sync wrapper for CLI."""

    async def _run() -> Dict[str, Any]:
        conn = await asyncpg.connect(database_url)
        try:
            return await backfill_news_evidence_objects(conn, days=days, region=region, limit=limit)
        finally:
            await conn.close()

    import asyncio

    return asyncio.run(_run())

