"""Canonical Evidence Object helpers.

This module is intentionally dependency-light (stdlib + asyncpg typing only).

Evidence objects are the system-wide contract of truth. Everything derived
(signals, graphs, narratives) should link back to evidence_objects.evidence_id.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, Optional

if TYPE_CHECKING:
    import asyncpg


def stable_hash(parts: list[str]) -> str:
    """Compute a stable sha256 hash from ordered string parts."""
    joined = "|".join(parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


async def upsert_evidence_object(
    conn: "asyncpg.Connection",
    *,
    evidence_type: str,
    uri: str,
    captured_at: datetime,
    source_weight: float,
    language: str,
    content_ref: Optional[str],
    hash_value: str,
    canonicalization_version: int = 1,
    provenance: Optional[Dict[str, Any]] = None,
) -> str:
    """Upsert an evidence_objects row and return evidence_id (as text)."""
    prov = provenance or {}
    row = await conn.fetchrow(
        """
        INSERT INTO evidence_objects (
            evidence_type, uri, captured_at, source_weight, language,
            content_ref, hash, canonicalization_version, provenance_json
        )
        VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9::jsonb)
        ON CONFLICT (evidence_type, hash) DO UPDATE
        SET uri = EXCLUDED.uri,
            captured_at = LEAST(evidence_objects.captured_at, EXCLUDED.captured_at),
            source_weight = EXCLUDED.source_weight,
            language = EXCLUDED.language,
            content_ref = COALESCE(evidence_objects.content_ref, EXCLUDED.content_ref),
            canonicalization_version = GREATEST(evidence_objects.canonicalization_version, EXCLUDED.canonicalization_version),
            provenance_json = COALESCE(evidence_objects.provenance_json, '{}'::jsonb) || EXCLUDED.provenance_json
        RETURNING evidence_id::text
        """,
        evidence_type,
        uri,
        captured_at,
        float(source_weight),
        language or "en",
        content_ref,
        hash_value,
        int(canonicalization_version),
        json.dumps(prov),
    )
    if not row or not row.get("evidence_id"):
        raise RuntimeError("evidence_objects upsert returned no evidence_id")
    return str(row["evidence_id"])


async def replace_members(
    conn: "asyncpg.Connection",
    *,
    evidence_id: str,
    members: list[tuple[str, bool]],
) -> int:
    """Replace evidence_object_members for evidence_id (delete + insert).

    Args:
      evidence_id: parent evidence object id (uuid as text)
      members: list of (member_evidence_id, is_primary)
    """
    await conn.execute(
        "DELETE FROM evidence_object_members WHERE evidence_id = $1::uuid",
        evidence_id,
    )
    inserted = 0
    for member_id, is_primary in members:
        if not member_id:
            continue
        await conn.execute(
            """
            INSERT INTO evidence_object_members (evidence_id, member_evidence_id, is_primary)
            VALUES ($1::uuid, $2::uuid, $3)
            ON CONFLICT (evidence_id, member_evidence_id) DO UPDATE
            SET is_primary = EXCLUDED.is_primary
            """,
            evidence_id,
            member_id,
            bool(is_primary),
        )
        inserted += 1
    return inserted


async def supports_evidence_objects(conn: "asyncpg.Connection") -> bool:
    """Whether evidence_objects + the expected pointer columns exist."""
    try:
        tbl = await conn.fetchval("SELECT to_regclass('public.evidence_objects')::text")
        mem = await conn.fetchval("SELECT to_regclass('public.evidence_object_members')::text")
        if not tbl or not mem:
            return False
        # Require pointer columns on news tables for this feature to be useful in news ingest.
        nir = await conn.fetchval(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'news_items_raw' AND column_name = 'evidence_object_id'
            LIMIT 1
            """
        )
        nc = await conn.fetchval(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'news_clusters' AND column_name = 'evidence_object_id'
            LIMIT 1
            """
        )
        return bool(nir) and bool(nc)
    except Exception:
        return False

