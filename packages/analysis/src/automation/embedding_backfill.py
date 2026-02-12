"""Backfill embeddings for news clusters missing vectors.

Extracted from the ``embed-backfill`` CLI command so the logic is
testable and reusable.  Three public entry-points:

* ``fetch_unembedded_clusters`` — query rows needing embeddings
* ``store_embedding``          — idempotent single-row UPDATE
* ``backfill_cluster_embeddings`` — orchestrator (batch embed + store + related)
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

EXPECTED_DIMENSIONS = 1536


# ------------------------------------------------------------------
# Data transfer object
# ------------------------------------------------------------------

@dataclass(frozen=True)
class ClusterRow:
    id: str
    title: str
    summary: Optional[str]
    entities: List[str]


# ------------------------------------------------------------------
# fetch_unembedded_clusters
# ------------------------------------------------------------------

async def fetch_unembedded_clusters(
    conn: Any,
    *,
    limit: int = 0,
    order: str = "newest",
    days: int = 0,
) -> List[ClusterRow]:
    """Return clusters that have no embedding yet.

    Parameters
    ----------
    conn : asyncpg.Connection
    limit : int
        Max rows to return (0 = unlimited).
    order : ``"newest"`` or ``"oldest"``
    days : int
        If > 0, restrict to ``published_at >= NOW() - N days``.
    """
    conditions = ["embedding IS NULL"]
    params: list[Any] = []
    idx = 1

    if days > 0:
        conditions.append(f"published_at >= NOW() - (${idx} || ' days')::interval")
        params.append(str(days))
        idx += 1

    where = "WHERE " + " AND ".join(conditions)
    direction = "ASC" if order == "oldest" else "DESC"

    limit_clause = ""
    if limit > 0:
        limit_clause = f"LIMIT ${idx}"
        params.append(limit)

    query = f"""
        SELECT id::text, title, summary,
               COALESCE(entities, '{{}}'::text[]) AS entities
        FROM news_clusters
        {where}
        ORDER BY published_at {direction}
        {limit_clause}
    """

    rows = await conn.fetch(query, *params)
    return [
        ClusterRow(
            id=row["id"],
            title=row["title"],
            summary=row["summary"],
            entities=list(row["entities"] or []),
        )
        for row in rows
    ]


# ------------------------------------------------------------------
# store_embedding
# ------------------------------------------------------------------

async def store_embedding(
    conn: Any,
    cluster_id: str,
    embedding: Sequence[float],
) -> bool:
    """Idempotent UPDATE — sets embedding only if still NULL.

    Returns True if the row was actually updated.
    Rejects embeddings with wrong dimensionality.
    """
    if len(embedding) != EXPECTED_DIMENSIONS:
        logger.warning(
            "Skipping cluster %s: got %d dims, expected %d",
            cluster_id, len(embedding), EXPECTED_DIMENSIONS,
        )
        return False
    result = await conn.execute(
        """UPDATE news_clusters
           SET embedding = $1::vector, embedded_at = NOW()
           WHERE id = $2::uuid AND embedding IS NULL""",
        str(list(embedding)),
        cluster_id,
    )
    # asyncpg returns e.g. "UPDATE 1" or "UPDATE 0"
    return result.endswith("1")


# ------------------------------------------------------------------
# backfill_cluster_embeddings (orchestrator)
# ------------------------------------------------------------------

async def backfill_cluster_embeddings(
    conn: Any,
    embedding_service: Any,
    *,
    limit: int = 0,
    batch_size: int = 100,
    order: str = "newest",
    days: int = 0,
    sleep_ms: int = 0,
    populate_related: bool = True,
    related_top_n: int = 5,
    related_chunk_size: int = 50,
) -> Dict[str, Any]:
    """Embed all unembedded clusters and optionally populate related links.

    Parameters
    ----------
    conn : asyncpg.Connection
    embedding_service : EmbeddingService
    limit : int
        Cap on clusters to process (0 = all).
    batch_size : int
        How many texts to send per API call.
    order : ``"newest"`` | ``"oldest"``
    days : int
        Restrict to last N days (0 = all).
    sleep_ms : int
        Milliseconds to sleep between batches (0 = no throttle).
    populate_related : bool
        Whether to run ``populate_related_clusters`` after embedding.
    related_top_n : int
        Top-N related clusters per item.
    related_chunk_size : int
        Chunk size for related-cluster population queries.
    """
    clusters = await fetch_unembedded_clusters(
        conn, limit=limit, order=order, days=days,
    )

    stats: Dict[str, Any] = {
        "selected": len(clusters),
        "attempted": 0,
        "stored": 0,
        "failed": 0,
        "populate_related_updated": 0,
    }

    if not clusters:
        return stats

    embedded_ids: List[str] = []

    for b_start in range(0, len(clusters), batch_size):
        batch = clusters[b_start : b_start + batch_size]
        texts = [
            embedding_service.prepare_text(
                c.title, c.summary, c.entities,
            )
            for c in batch
        ]

        embeddings = await embedding_service.embed_texts(texts)
        stats["attempted"] += len(batch)

        for cluster, emb in zip(batch, embeddings):
            if emb is None:
                stats["failed"] += 1
                continue
            try:
                stored = await store_embedding(conn, cluster.id, emb)
                if stored:
                    stats["stored"] += 1
                    embedded_ids.append(cluster.id)
                else:
                    # Already embedded by another process — not a failure
                    stats["stored"] += 1
            except Exception as exc:
                logger.warning("Failed to store embedding for %s: %s", cluster.id, exc)
                stats["failed"] += 1

        progress = min(b_start + batch_size, len(clusters))
        logger.info("Embedded %d/%d clusters", progress, len(clusters))

        if sleep_ms > 0 and (b_start + batch_size) < len(clusters):
            await asyncio.sleep(sleep_ms / 1000)

    # Populate related clusters in chunks
    if populate_related and embedded_ids:
        total_related = 0
        for chunk_start in range(0, len(embedded_ids), related_chunk_size):
            chunk = embedded_ids[chunk_start : chunk_start + related_chunk_size]
            updated = await embedding_service.populate_related_clusters(
                conn, chunk, top_n=related_top_n,
            )
            total_related += updated
        stats["populate_related_updated"] = total_related

    return stats
