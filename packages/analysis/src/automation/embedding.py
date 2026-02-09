"""Embedding generation for news clusters using Azure OpenAI.

Generates text-embedding-3-small (1536d) vectors for semantic search
and editorial memory.  Non-blocking: if Azure OpenAI is unavailable,
clusters are created without embeddings.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
BATCH_SIZE = 100  # Azure OpenAI supports up to 2048 inputs per batch
RELATED_SIMILARITY_THRESHOLD = 0.50


class EmbeddingService:
    """Generate and store embeddings for news clusters."""

    def __init__(
        self,
        azure_client: Optional[Any] = None,
        deployment_name: str = EMBEDDING_MODEL,
    ):
        self.azure_client = azure_client
        self.deployment_name = deployment_name
        self._stats: Dict[str, Any] = {
            "attempted": 0,
            "succeeded": 0,
            "failed": 0,
            "related_populated": 0,
        }

    # ------------------------------------------------------------------
    # Text preparation
    # ------------------------------------------------------------------

    @staticmethod
    def prepare_text(
        title: str,
        summary: Optional[str] = None,
        entities: Optional[Sequence[str]] = None,
    ) -> str:
        """Create embedding input text from cluster fields.

        Concatenates title + summary + top entities, truncated to stay
        within the model's 8 191-token context window.
        """
        parts = [title]
        if summary:
            parts.append(summary)
        if entities:
            parts.append("Entities: " + ", ".join(list(entities)[:10]))
        return " ".join(parts)[:8000]

    # ------------------------------------------------------------------
    # Batch embedding
    # ------------------------------------------------------------------

    async def embed_texts(self, texts: Sequence[str]) -> List[Optional[List[float]]]:
        """Generate embeddings for a batch of texts.

        Returns a list of float vectors (or ``None`` for failed items).
        """
        if not self.azure_client:
            return [None] * len(texts)

        try:
            response = await self.azure_client.embeddings.create(
                input=list(texts),
                model=self.deployment_name,
            )
            result: List[Optional[List[float]]] = [None] * len(texts)
            for item in response.data:
                result[item.index] = item.embedding
            return result
        except Exception as exc:
            logger.warning("Embedding batch failed: %s", exc)
            return [None] * len(texts)

    # ------------------------------------------------------------------
    # Cluster embedding (called during ingest)
    # ------------------------------------------------------------------

    async def embed_clusters(
        self,
        conn: Any,  # asyncpg.Connection
        clusters: Sequence[Any],  # StoryCluster objects
        cluster_ids: Dict[str, str],  # cluster_key -> DB uuid
    ) -> Dict[str, Any]:
        """Embed newly persisted clusters and store vectors.

        Non-blocking: failures are logged but never prevent cluster creation.
        """
        if not self.azure_client:
            return {"skipped": True, "reason": "no_client"}

        to_embed: list[tuple[str, str]] = []  # (db_id, text)
        for cluster in clusters:
            cid = cluster_ids.get(cluster.cluster_key)
            if cid:
                text = self.prepare_text(
                    cluster.title,
                    cluster.summary,
                    cluster.entities,
                )
                to_embed.append((cid, text))

        if not to_embed:
            return dict(self._stats)

        for batch_start in range(0, len(to_embed), BATCH_SIZE):
            batch = to_embed[batch_start : batch_start + BATCH_SIZE]
            texts = [t[1] for t in batch]
            self._stats["attempted"] += len(batch)

            embeddings = await self.embed_texts(texts)

            for (cid, _), embedding in zip(batch, embeddings):
                if embedding is None:
                    self._stats["failed"] += 1
                    continue
                try:
                    await conn.execute(
                        """
                        UPDATE news_clusters
                        SET embedding = $1::vector,
                            embedded_at = NOW()
                        WHERE id = $2::uuid
                          AND embedding IS NULL
                        """,
                        str(embedding),
                        cid,
                    )
                    self._stats["succeeded"] += 1
                except Exception as exc:
                    logger.warning("Failed to store embedding for %s: %s", cid, exc)
                    self._stats["failed"] += 1

        return dict(self._stats)

    # ------------------------------------------------------------------
    # Similarity search
    # ------------------------------------------------------------------

    async def find_similar(
        self,
        conn: Any,  # asyncpg.Connection
        embedding: List[float],
        *,
        limit: int = 5,
        exclude_ids: Optional[Sequence[str]] = None,
        min_date: Optional[str] = None,
        max_date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Find top-N similar clusters by cosine similarity."""
        conditions = ["embedding IS NOT NULL"]
        params: list[Any] = [str(embedding)]  # $1 = query vector as text
        idx = 2

        if exclude_ids:
            placeholders = ", ".join(f"${idx + i}::uuid" for i in range(len(exclude_ids)))
            conditions.append(f"id NOT IN ({placeholders})")
            params.extend(exclude_ids)
            idx += len(exclude_ids)

        if min_date:
            conditions.append(f"published_at >= ${idx}::date")
            params.append(min_date)
            idx += 1

        if max_date:
            conditions.append(f"published_at <= ${idx}::date")
            params.append(max_date)
            idx += 1

        where = " AND ".join(conditions)
        params.append(limit)

        query = f"""
            SELECT id::text, title, summary, story_type, topic_tags,
                   entities, published_at::text,
                   1 - (embedding <=> $1::vector) AS similarity
            FROM news_clusters
            WHERE {where}
            ORDER BY embedding <=> $1::vector
            LIMIT ${idx}
        """

        rows = await conn.fetch(query, *params)
        return [
            {
                "id": row["id"],
                "title": row["title"],
                "summary": row["summary"],
                "story_type": row["story_type"],
                "topic_tags": list(row["topic_tags"] or []),
                "entities": list(row["entities"] or []),
                "published_at": row["published_at"],
                "similarity": float(row["similarity"]),
            }
            for row in rows
        ]

    # ------------------------------------------------------------------
    # Editorial memory: populate related_cluster_ids
    # ------------------------------------------------------------------

    async def populate_related_clusters(
        self,
        conn: Any,  # asyncpg.Connection
        cluster_ids: Sequence[str],
        top_n: int = 5,
    ) -> int:
        """For each cluster, find top-N similar past clusters and store
        in ``related_cluster_ids``.  Returns count of clusters updated.
        """
        updated = 0
        for cid in cluster_ids:
            row = await conn.fetchrow(
                "SELECT embedding::text FROM news_clusters WHERE id = $1::uuid AND embedding IS NOT NULL",
                cid,
            )
            if not row or not row["embedding"]:
                continue

            emb_text = row["embedding"]
            embedding = [float(x) for x in emb_text.strip("[]").split(",")]

            similar = await self.find_similar(
                conn, embedding, limit=top_n, exclude_ids=[cid],
            )
            related_ids = [s["id"] for s in similar if s["similarity"] >= RELATED_SIMILARITY_THRESHOLD]

            if related_ids:
                await conn.execute(
                    """
                    UPDATE news_clusters
                    SET related_cluster_ids = $1::uuid[]
                    WHERE id = $2::uuid
                    """,
                    related_ids,
                    cid,
                )
                updated += 1

        self._stats["related_populated"] = updated
        return updated

    @property
    def stats(self) -> Dict[str, Any]:
        return dict(self._stats)
