"""Unified entity_nodes helpers (actor/target references).

This module is intentionally dependency-light (stdlib + asyncpg typing only).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Dict, Iterable

if TYPE_CHECKING:
    import asyncpg


async def ensure_entity_nodes(
    conn: "asyncpg.Connection",
    *,
    entity_type: str,
    entity_ids: Iterable[str],
) -> Dict[str, str]:
    """Ensure entity_nodes exist for (entity_type, entity_id) and return a mapping.

    Returns: entity_id (uuid as text) -> entity_nodes.id (uuid as text)
    """
    ids = [eid for eid in set(entity_ids) if eid]
    if not ids:
        return {}

    # Insert missing rows (idempotent), then read back the full mapping.
    await conn.execute(
        """
        INSERT INTO entity_nodes (entity_type, entity_id)
        SELECT $1, x::uuid
        FROM UNNEST($2::uuid[]) AS x
        ON CONFLICT (entity_type, entity_id) DO NOTHING
        """,
        entity_type,
        ids,
    )

    rows = await conn.fetch(
        """
        SELECT entity_id::text, id::text
        FROM entity_nodes
        WHERE entity_type = $1 AND entity_id = ANY($2::uuid[])
        """,
        entity_type,
        ids,
    )
    return {r["entity_id"]: r["id"] for r in rows}


async def supports_entity_nodes(conn: "asyncpg.Connection") -> bool:
    try:
        val = await conn.fetchval("SELECT to_regclass('public.entity_nodes')::text")
        return bool(val)
    except Exception:
        return False

