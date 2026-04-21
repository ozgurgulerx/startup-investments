"""Persistence helpers for startup evidence bundles."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from psycopg2.extras import Json

from src.data.ingestion import load_unique_startups_from_csv
from src.intelligence.evidence_pipeline import StartupEvidenceBundle, build_startup_evidence_bundle


@dataclass
class EvidenceSyncStats:
    startups_seen: int = 0
    startups_synced: int = 0
    documents_written: int = 0
    observations_written: int = 0
    claims_written: int = 0
    claim_evidence_written: int = 0
    promotion_seeded: int = 0

    def to_dict(self) -> Dict[str, int]:
        return {
            "startups_seen": self.startups_seen,
            "startups_synced": self.startups_synced,
            "documents_written": self.documents_written,
            "observations_written": self.observations_written,
            "claims_written": self.claims_written,
            "claim_evidence_written": self.claim_evidence_written,
            "promotion_seeded": self.promotion_seeded,
        }


def sync_startup_evidence_for_period(
    *,
    csv_path: Path,
    cache_dir: Path,
    database_url: str,
    period: str,
    region: str = "global",
    run_key: Optional[str] = None,
    enqueue_promotion: bool = True,
) -> Dict[str, int]:
    """Build and persist evidence bundles for startups already present in Postgres."""
    import psycopg2

    stable_run_key = run_key or f"{period}:{region}:evidence"
    startups = load_unique_startups_from_csv(csv_path)
    stats = EvidenceSyncStats(startups_seen=len(startups))
    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, name, slug
                FROM startups
                WHERE dataset_region = %s AND period = %s
                """,
                (region, period),
            )
            startup_map = {str(row[1]).strip().lower(): {"id": row[0], "slug": row[2]} for row in cur.fetchall()}

        for startup in startups:
            startup_row = startup_map.get(startup.name.strip().lower())
            if not startup_row:
                continue
            bundle = build_startup_evidence_bundle(startup, cache_dir=cache_dir)
            _replace_startup_evidence(
                conn,
                startup_id=str(startup_row["id"]),
                bundle=bundle,
                period=period,
                run_key=stable_run_key,
            )
            stats.startups_synced += 1
            stats.documents_written += len(bundle.documents)
            stats.observations_written += len(bundle.observations)
            stats.claims_written += len(bundle.claims)
            stats.claim_evidence_written += sum(len(claim.evidence) for claim in bundle.claims)
            if enqueue_promotion:
                stats.promotion_seeded += seed_promotion_request(
                    conn,
                    startup_id=str(startup_row["id"]),
                    region=region,
                    period=period,
                    run_key=stable_run_key,
                    coverage_score=bundle.coverage.coverage_score,
                    reason="evidence_sync",
                )
    return stats.to_dict()


def seed_promotion_request(
    conn,
    *,
    startup_id: str,
    region: str,
    period: str,
    run_key: str,
    coverage_score: float,
    reason: str,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO startup_promotion_queue (
                startup_id,
                requested_status,
                region,
                priority,
                source,
                reason,
                period,
                run_key,
                coverage_score,
                metadata_json
            )
            VALUES (%s::uuid, 'auto', %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT DO NOTHING
            """,
            (
                startup_id,
                region,
                5,
                "evidence_sync",
                reason,
                period,
                run_key,
                coverage_score,
                json.dumps({"coverage_score": coverage_score}),
            ),
        )
        return int(cur.rowcount or 0)


def _replace_startup_evidence(
    conn,
    *,
    startup_id: str,
    bundle: StartupEvidenceBundle,
    period: str,
    run_key: str,
) -> None:
    with conn.cursor() as cur:
        # Replace semantics are scoped to the startup-period pair. Reruns use a
        # unique run_key, so keeping old run_key rows would leave stale evidence
        # behind and pollute later research/promotion reads.
        cur.execute(
            "DELETE FROM startup_claim_evidence WHERE startup_id = %s::uuid AND period = %s",
            (startup_id, period),
        )
        cur.execute(
            "DELETE FROM startup_claims WHERE startup_id = %s::uuid AND period = %s",
            (startup_id, period),
        )
        cur.execute(
            "DELETE FROM startup_field_observations WHERE startup_id = %s::uuid AND period = %s",
            (startup_id, period),
        )
        cur.execute(
            "DELETE FROM startup_source_documents WHERE startup_id = %s::uuid AND period = %s",
            (startup_id, period),
        )

        doc_ids: Dict[tuple[str, str], str] = {}
        for document in bundle.documents:
            cur.execute(
                """
                INSERT INTO startup_source_documents (
                    startup_id,
                    period,
                    run_key,
                    source_url,
                    canonical_url,
                    source_type,
                    page_type,
                    fetched_at,
                    content_hash,
                    snippet,
                    locator_json,
                    extractor_type,
                    extractor_version,
                    confidence,
                    metadata_json
                )
                VALUES (
                    %s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s::jsonb
                )
                RETURNING id::text
                """,
                (
                    startup_id,
                    period,
                    run_key,
                    document.source_url,
                    document.canonical_url,
                    document.source_type,
                    document.page_type,
                    document.fetched_at,
                    document.content_hash,
                    document.snippet,
                    Json(document.locator),
                    document.extractor_type,
                    document.extractor_version,
                    document.confidence,
                    Json(document.metadata),
                ),
            )
            doc_id = cur.fetchone()[0]
            doc_ids[(document.canonical_url, document.content_hash or "")] = doc_id

        observation_ids: Dict[tuple[str, str, str], str] = {}
        for observation in bundle.observations:
            source_document_id = doc_ids.get((observation.canonical_url, observation.content_hash or ""))
            cur.execute(
                """
                INSERT INTO startup_field_observations (
                    startup_id,
                    source_document_id,
                    period,
                    run_key,
                    field_name,
                    value_json,
                    normalized_value,
                    source_url,
                    canonical_url,
                    source_type,
                    page_type,
                    fetched_at,
                    content_hash,
                    snippet,
                    locator_json,
                    extractor_type,
                    extractor_version,
                    confidence,
                    metadata_json
                )
                VALUES (
                    %s::uuid, %s::uuid, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s::jsonb
                )
                RETURNING id::text
                """,
                (
                    startup_id,
                    source_document_id,
                    period,
                    run_key,
                    observation.field_name,
                    Json(observation.value),
                    observation.normalized_value,
                    observation.source_url,
                    observation.canonical_url,
                    observation.source_type,
                    observation.page_type,
                    observation.fetched_at,
                    observation.content_hash,
                    observation.snippet,
                    Json(observation.locator),
                    observation.extractor_type,
                    observation.extractor_version,
                    observation.confidence,
                    Json(observation.metadata),
                ),
            )
            observation_id = cur.fetchone()[0]
            observation_ids[(observation.field_name, observation.normalized_value, observation.canonical_url)] = observation_id

        for claim in bundle.claims:
            cur.execute(
                """
                INSERT INTO startup_claims (
                    startup_id,
                    period,
                    run_key,
                    claim_type,
                    claim_value_json,
                    normalized_value,
                    thesis,
                    confidence,
                    contradiction_state,
                    source_count,
                    extractor_type,
                    extractor_version,
                    metadata_json
                )
                VALUES (
                    %s::uuid, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                )
                RETURNING id::text
                """,
                (
                    startup_id,
                    period,
                    run_key,
                    claim.claim_type,
                    Json(claim.value),
                    claim.normalized_value,
                    claim.thesis,
                    claim.confidence,
                    claim.contradiction_state,
                    len(claim.evidence),
                    "claim_consolidation",
                    "schema-v1",
                    Json(claim.metadata),
                ),
            )
            claim_id = cur.fetchone()[0]
            for evidence in claim.evidence:
                source_document_id = doc_ids.get((evidence.canonical_url, evidence.content_hash or ""))
                field_observation_id = observation_ids.get((claim.claim_type, claim.normalized_value, evidence.canonical_url))
                cur.execute(
                    """
                    INSERT INTO startup_claim_evidence (
                        claim_id,
                        startup_id,
                        source_document_id,
                        field_observation_id,
                        period,
                        run_key,
                        source_url,
                        canonical_url,
                        source_type,
                        page_type,
                        fetched_at,
                        content_hash,
                        snippet,
                        locator_json,
                        extractor_type,
                        extractor_version,
                        confidence,
                        metadata_json
                    )
                    VALUES (
                        %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s, '{}'::jsonb, %s, %s, %s, '{}'::jsonb
                    )
                    """,
                    (
                        claim_id,
                        startup_id,
                        source_document_id,
                        field_observation_id,
                        period,
                        run_key,
                        evidence.source_url,
                        evidence.canonical_url,
                        evidence.source_type,
                        evidence.page_type,
                        evidence.fetched_at,
                        evidence.content_hash,
                        evidence.snippet,
                        evidence.extractor_type,
                        evidence.extractor_version,
                        evidence.confidence,
                    ),
                )

        cur.execute(
            """
            UPDATE startups
            SET required_field_coverage = %s,
                required_field_coverage_updated_at = NOW()
            WHERE id = %s::uuid
            """,
            (bundle.coverage.coverage_score, startup_id),
        )
