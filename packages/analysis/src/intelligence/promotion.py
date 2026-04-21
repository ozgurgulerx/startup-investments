"""Reusable startup promotion worker for monthly and live onboarding."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional


PROMOTION_KEY_FIELDS_SQL = (
    "'one_line_summary', 'detailed_product_summary', 'category_vertical', 'icp_buyer', "
    "'team', 'pricing_presence', 'pricing_plan_details', 'docs_api_presence', "
    "'integrations_ecosystem_signals', 'security_compliance_signals', 'tech_stack_signals'"
)
FIRST_PARTY_SOURCE_TYPES_SQL = "'website', 'docs', 'api', 'github', 'startup_record'"
LOW_QUALITY_SOURCE_TYPES_SQL = "'search_grounded', 'news', 'unknown', 'youtube'"


@dataclass
class PromotionDecision:
    startup_id: str
    requested_status: str
    action: str
    apply_status: Optional[str]
    apply_materialization_status: Optional[str]
    reason: str
    coverage_score: float
    explainability: Dict[str, Any]


def _float_env(name: str, default: float) -> float:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def evaluate_promotion(row: Dict[str, object], requested_status: str = "auto") -> PromotionDecision:
    coverage_score = float(row.get("required_field_coverage") or 0.0)
    onboarding_status = str(row.get("onboarding_status") or "verified")
    materialization_status = str(row.get("materialization_status") or "unmaterialized")
    has_analysis = bool(row.get("has_analysis_data"))
    has_state = bool(row.get("has_state_snapshot"))
    startup_id = str(row.get("id"))
    website = str(row.get("website") or "").strip()
    evidence_diversity = int(row.get("evidence_diversity") or 0)
    contradiction_count = int(row.get("contradiction_count") or 0)
    key_field_support_count = int(row.get("key_field_support_count") or 0)
    first_party_key_field_support_count = int(row.get("first_party_key_field_support_count") or 0)
    low_quality_external_only = bool(row.get("low_quality_external_only"))
    quality_metrics_present = any(
        key in row
        for key in (
            "evidence_diversity",
            "contradiction_count",
            "key_field_support_count",
            "first_party_key_field_support_count",
            "low_quality_external_only",
        )
    )

    verified_threshold = _float_env("PROMOTION_VERIFIED_COVERAGE_THRESHOLD", 0.55)
    analysis_ready_threshold = _float_env("PROMOTION_ANALYSIS_READY_COVERAGE_THRESHOLD", 0.65)
    state_ready_threshold = _float_env("PROMOTION_STATE_READY_COVERAGE_THRESHOLD", 0.72)
    min_evidence_diversity = int(_float_env("PROMOTION_MIN_EVIDENCE_DIVERSITY", 2))
    max_contradictions = int(_float_env("PROMOTION_MAX_CONTRADICTIONS", 6))
    min_key_field_support = int(_float_env("PROMOTION_MIN_KEY_FIELD_SUPPORT", 3))
    require_first_party = str(os.getenv("PROMOTION_REQUIRE_FIRST_PARTY_KEY_FIELDS", "true")).strip().lower() not in {"0", "false", "no", "off"}

    explainability: Dict[str, Any] = {
        "coverage_score": coverage_score,
        "thresholds": {
            "verified": verified_threshold,
            "analysis_ready": analysis_ready_threshold,
            "state_ready": state_ready_threshold,
            "min_evidence_diversity": min_evidence_diversity,
            "max_contradictions": max_contradictions,
            "min_key_field_support": min_key_field_support,
            "require_first_party_key_fields": require_first_party,
        },
        "quality": {
            "evidence_diversity": evidence_diversity,
            "contradiction_count": contradiction_count,
            "key_field_support_count": key_field_support_count,
            "first_party_key_field_support_count": first_party_key_field_support_count,
            "low_quality_external_only": low_quality_external_only,
        },
        "blockers": [],
    }

    if onboarding_status in {"merged", "rejected"}:
        explainability["blockers"].append("excluded_status")
        return PromotionDecision(startup_id, requested_status, "skip", None, None, "excluded_status", coverage_score, explainability)

    if quality_metrics_present:
        if evidence_diversity < min_evidence_diversity:
            explainability["blockers"].append("low_evidence_diversity")
        if contradiction_count > max_contradictions:
            explainability["blockers"].append("too_many_contradictions")
        if key_field_support_count < min_key_field_support:
            explainability["blockers"].append("insufficient_key_field_support")
        if low_quality_external_only:
            explainability["blockers"].append("low_quality_external_only")
        if require_first_party and key_field_support_count > 0 and first_party_key_field_support_count == 0:
            explainability["blockers"].append("missing_first_party_key_field_support")
    if explainability["blockers"]:
        return PromotionDecision(startup_id, requested_status, "skip", None, None, "quality_gate_blocked", coverage_score, explainability)

    target = requested_status if requested_status and requested_status != "auto" else None
    if target == "verified":
        if onboarding_status == "stub" and website and coverage_score >= verified_threshold:
            explainability["applied_transition"] = "stub_to_verified"
            return PromotionDecision(startup_id, requested_status, "promote", "verified", None, "coverage_ready_for_verified", coverage_score, explainability)
        return PromotionDecision(startup_id, requested_status, "skip", None, None, "coverage_or_state_insufficient", coverage_score, explainability)

    if target == "analysis_ready":
        if has_analysis and materialization_status == "unmaterialized" and coverage_score >= analysis_ready_threshold:
            explainability["applied_transition"] = "unmaterialized_to_analysis_ready"
            return PromotionDecision(startup_id, requested_status, "promote", None, "analysis_ready", "analysis_materialized_with_coverage", coverage_score, explainability)
        return PromotionDecision(startup_id, requested_status, "skip", None, None, "coverage_or_state_insufficient", coverage_score, explainability)

    if target == "state_ready":
        if has_state and materialization_status != "state_ready" and coverage_score >= state_ready_threshold:
            explainability["applied_transition"] = "analysis_ready_to_state_ready"
            return PromotionDecision(startup_id, requested_status, "promote", None, "state_ready", "state_snapshot_ready", coverage_score, explainability)
        return PromotionDecision(startup_id, requested_status, "skip", None, None, "coverage_or_state_insufficient", coverage_score, explainability)

    if onboarding_status == "stub" and website and coverage_score >= verified_threshold:
        explainability["applied_transition"] = "stub_to_verified"
        return PromotionDecision(startup_id, requested_status, "promote", "verified", None, "coverage_ready_for_verified", coverage_score, explainability)

    if has_analysis and materialization_status == "unmaterialized" and coverage_score >= analysis_ready_threshold:
        explainability["applied_transition"] = "unmaterialized_to_analysis_ready"
        return PromotionDecision(startup_id, requested_status, "promote", None, "analysis_ready", "analysis_materialized_with_coverage", coverage_score, explainability)

    if has_state and materialization_status != "state_ready" and coverage_score >= state_ready_threshold:
        explainability["applied_transition"] = "analysis_ready_to_state_ready"
        return PromotionDecision(startup_id, requested_status, "promote", None, "state_ready", "state_snapshot_ready", coverage_score, explainability)

    return PromotionDecision(startup_id, requested_status, "skip", None, None, "coverage_or_state_insufficient", coverage_score, explainability)


def seed_promotion_queue(
    *,
    database_url: str,
    region: Optional[str] = None,
    period: Optional[str] = None,
    limit: int = 250,
    requested_status: str = "auto",
    source: str = "promotion_worker",
) -> Dict[str, int]:
    import psycopg2

    filters = []
    params = []
    if region:
        filters.append("dataset_region = %s")
        params.append(region)
    if period:
        filters.append("period = %s")
        params.append(period)
    where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id::text, dataset_region, period, required_field_coverage
                FROM startups
                {where_sql}
                ORDER BY required_field_coverage DESC, updated_at DESC
                LIMIT %s
                """,
                (*params, max(1, int(limit))),
            )
            rows = cur.fetchall()
            inserted = 0
            for startup_id, startup_region, startup_period, coverage_score in rows:
                cur.execute(
                    """
                    INSERT INTO startup_promotion_queue (
                        startup_id,
                        requested_status,
                        region,
                        source,
                        reason,
                        period,
                        coverage_score,
                        metadata_json
                    )
                    VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT DO NOTHING
                    """,
                    (
                        startup_id,
                        requested_status,
                        startup_region,
                        source,
                        "promotion_seed",
                        startup_period,
                        float(coverage_score or 0.0),
                        json.dumps({"coverage_score": float(coverage_score or 0.0)}),
                    ),
                )
                inserted += int(cur.rowcount or 0)
    return {"seeded": inserted}


def process_promotion_queue(
    *,
    database_url: str,
    limit: int = 50,
    stale_minutes: int = 45,
    max_retries: int = 3,
) -> Dict[str, int]:
    import psycopg2

    stats = {"claimed": 0, "promoted": 0, "skipped": 0, "failed": 0, "stale_reclaimed": 0}
    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE startup_promotion_queue
                SET status = 'pending',
                    started_at = NULL,
                    retry_count = COALESCE(retry_count, 0) + 1,
                    error_message = COALESCE(error_message, '') || ' | stale processing reset'
                WHERE status = 'processing'
                  AND started_at < NOW() - make_interval(mins => %s)
                  AND COALESCE(retry_count, 0) < %s
                """,
                (max(5, int(stale_minutes)), max(1, int(max_retries))),
            )
            stats["stale_reclaimed"] = int(cur.rowcount or 0)
            cur.execute(
                """
                WITH next_items AS (
                    SELECT id
                    FROM startup_promotion_queue
                    WHERE status = 'pending'
                    ORDER BY priority ASC, queued_at ASC
                    LIMIT %s
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE startup_promotion_queue q
                SET status = 'processing',
                    started_at = NOW()
                FROM next_items ni
                WHERE q.id = ni.id
                RETURNING q.id::text, q.startup_id::text, q.requested_status
                """,
                (max(1, int(limit)),),
            )
            items = cur.fetchall()
            stats["claimed"] = len(items)

        for queue_id, startup_id, requested_status in items:
            try:
                with conn.cursor() as cur:
                    startup_quality_sql = """
                        SELECT
                            s.id::text,
                            COALESCE(s.onboarding_status, 'verified') AS onboarding_status,
                            COALESCE(s.materialization_status, 'unmaterialized') AS materialization_status,
                            s.required_field_coverage,
                            s.website,
                            (s.analysis_data IS NOT NULL AND s.analysis_data::text <> '{{}}') AS has_analysis_data,
                            EXISTS (
                                SELECT 1
                                FROM startup_state_snapshot ss
                                WHERE ss.startup_id = s.id
                            ) AS has_state_snapshot,
                            COALESCE((
                                SELECT COUNT(DISTINCT COALESCE(sd.source_type, 'unknown') || ':' || COALESCE(sd.page_type, 'unknown'))
                                FROM startup_source_documents sd
                                WHERE sd.startup_id = s.id
                            ), 0) AS evidence_diversity,
                            COALESCE((
                                SELECT COUNT(*)
                                FROM startup_claims sc
                                WHERE sc.startup_id = s.id
                                  AND sc.contradiction_state = 'confirmed'
                            ), 0) AS contradiction_count,
                            COALESCE((
                                SELECT COUNT(DISTINCT so.field_name)
                                FROM startup_field_observations so
                                WHERE so.startup_id = s.id
                                  AND so.field_name IN ({promotion_key_fields})
                            ), 0) AS key_field_support_count,
                            COALESCE((
                                SELECT COUNT(DISTINCT so.field_name)
                                FROM startup_field_observations so
                                WHERE so.startup_id = s.id
                                  AND so.field_name IN ({promotion_key_fields})
                                  AND so.source_type IN ({first_party_source_types})
                            ), 0) AS first_party_key_field_support_count,
                            EXISTS (
                                SELECT 1
                                FROM startup_field_observations so
                                WHERE so.startup_id = s.id
                                  AND so.field_name IN ({promotion_key_fields})
                                  AND so.source_type IN ({low_quality_source_types})
                            )
                            AND NOT EXISTS (
                                SELECT 1
                                FROM startup_field_observations so
                                WHERE so.startup_id = s.id
                                  AND so.field_name IN ({promotion_key_fields})
                                  AND so.source_type IN ({first_party_source_types})
                            ) AS low_quality_external_only
                        FROM startups s
                        WHERE s.id = %s::uuid
                        """.format(
                            promotion_key_fields=PROMOTION_KEY_FIELDS_SQL,
                            first_party_source_types=FIRST_PARTY_SOURCE_TYPES_SQL,
                            low_quality_source_types=LOW_QUALITY_SOURCE_TYPES_SQL,
                        )
                    cur.execute(
                        startup_quality_sql,
                        (startup_id,),
                    )
                    row = cur.fetchone()
                    if not row:
                        cur.execute(
                            """
                            UPDATE startup_promotion_queue
                            SET status = 'failed',
                                completed_at = NOW(),
                                error_message = 'startup_missing'
                            WHERE id = %s::uuid
                            """,
                            (queue_id,),
                        )
                        stats["failed"] += 1
                        continue
                    decision = evaluate_promotion(
                        {
                            "id": row[0],
                            "onboarding_status": row[1],
                            "materialization_status": row[2],
                            "required_field_coverage": row[3],
                            "website": row[4],
                            "has_analysis_data": row[5],
                            "has_state_snapshot": row[6],
                            "evidence_diversity": row[7],
                            "contradiction_count": row[8],
                            "key_field_support_count": row[9],
                            "first_party_key_field_support_count": row[10],
                            "low_quality_external_only": row[11],
                        },
                        requested_status=requested_status,
                    )

                    if decision.action == "promote":
                        if decision.apply_status == "verified":
                            cur.execute(
                                """
                                UPDATE startups
                                SET onboarding_status = 'verified',
                                    updated_at = NOW()
                                WHERE id = %s::uuid
                                  AND COALESCE(onboarding_status, 'verified') = 'stub'
                                """,
                                (startup_id,),
                            )
                        if decision.apply_materialization_status == "analysis_ready":
                            cur.execute(
                                """
                                UPDATE startups
                                SET materialization_status = 'analysis_ready',
                                    analysis_materialized_at = COALESCE(analysis_materialized_at, NOW()),
                                    publish_block_reason = COALESCE(publish_block_reason, 'state_snapshot_missing'),
                                    updated_at = NOW()
                                WHERE id = %s::uuid
                                  AND analysis_data IS NOT NULL
                                """,
                                (startup_id,),
                            )
                        if decision.apply_materialization_status == "state_ready":
                            cur.execute(
                                """
                                UPDATE startups
                                SET materialization_status = 'state_ready',
                                    state_snapshot_at = COALESCE(
                                        state_snapshot_at,
                                        (SELECT MAX(snapshot_at) FROM startup_state_snapshot WHERE startup_id = %s::uuid)
                                    ),
                                    publish_block_reason = NULL,
                                    updated_at = NOW()
                                WHERE id = %s::uuid
                                  AND EXISTS (
                                        SELECT 1 FROM startup_state_snapshot WHERE startup_id = %s::uuid
                                  )
                                """,
                                (startup_id, startup_id),
                            )
                        stats["promoted"] += 1
                    else:
                        stats["skipped"] += 1

                    cur.execute(
                        """
                        UPDATE startup_promotion_queue
                        SET status = 'completed',
                            completed_at = NOW(),
                            metadata_json = COALESCE(metadata_json, '{}'::jsonb) || %s::jsonb
                        WHERE id = %s::uuid
                        """,
                        (
                            json.dumps(
                                {
                                    "decision_action": decision.action,
                                    "apply_status": decision.apply_status,
                                    "apply_materialization_status": decision.apply_materialization_status,
                                    "reason": decision.reason,
                                    "coverage_score": decision.coverage_score,
                                    "explainability": decision.explainability,
                                }
                            ),
                            queue_id,
                        ),
                    )
            except Exception as exc:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE startup_promotion_queue
                        SET status = 'failed',
                            completed_at = NOW(),
                            retry_count = COALESCE(retry_count, 0) + 1,
                            error_message = %s
                        WHERE id = %s::uuid
                        """,
                        (str(exc)[:500], queue_id),
                    )
                stats["failed"] += 1
    return stats
