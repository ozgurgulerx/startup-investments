"""Onboarding/deep-research trace utilities."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


ACTIONABLE_REASON_GUIDANCE: Dict[str, str] = {
    "missing_openai_library": "Install the python `openai` package in the worker environment (e.g., pip install -r packages/analysis/requirements.txt).",
    "missing_openai_credentials": "Configure Azure OpenAI credentials (endpoint + AAD role or API key) on the worker environment.",
    "startup_missing_website": "Add a website for this startup so crawl/research gates can pass.",
    "startup_not_crawled_yet": "Wait for crawl-frontier to complete at least one crawl, then requeue research.",
    "startup_low_crawl_success": "Improve crawlability or website quality, then requeue research.",
    "retry_exhausted": "Review the error payload and provide manual context, then requeue this startup.",
    "schema_or_parse_blocker": "Provide human context and verify parser assumptions for this startup.",
}


def build_dedupe_key(*parts: Optional[str]) -> str:
    """Build a compact deterministic dedupe key."""
    base = "||".join([(p or "").strip() for p in parts if (p or "").strip()])
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()
    return digest


def guidance_for_reason(reason_code: Optional[str]) -> str:
    return ACTIONABLE_REASON_GUIDANCE.get(reason_code or "", "Review details and provide context if needed.")


def classify_research_failure(
    error_message: str,
    *,
    retry_count: int = 0,
    max_retries: int = 3,
) -> Dict[str, Any]:
    """Classify deep-research failures into actionable/non-actionable buckets."""
    msg = (error_message or "").strip()
    lowered = msg.lower()

    if "missing credentials" in lowered or "azure client is unavailable" in lowered:
        return {
            "actionable": True,
            "reason_code": "missing_openai_credentials",
            "severity": "critical",
        }

    if "timeout" in lowered or "timed out" in lowered:
        return {
            "actionable": False,
            "reason_code": "transient_timeout",
            "severity": "warning",
        }

    if "rate limit" in lowered or "429" in lowered:
        return {
            "actionable": False,
            "reason_code": "provider_rate_limit",
            "severity": "warning",
        }

    if retry_count >= max_retries:
        return {
            "actionable": True,
            "reason_code": "retry_exhausted",
            "severity": "warning",
        }

    if "json" in lowered or "parse" in lowered or "schema" in lowered:
        return {
            "actionable": True,
            "reason_code": "schema_or_parse_blocker",
            "severity": "warning",
        }

    return {
        "actionable": False,
        "reason_code": "generic_failure",
        "severity": "warning",
    }


async def emit_trace(
    target: Any,
    *,
    startup_id: Optional[str],
    investor_id: Optional[str] = None,
    queue_item_id: Optional[str],
    investor_queue_item_id: Optional[str] = None,
    trace_type: str,
    stage: str,
    status: str,
    severity: str = "info",
    reason_code: Optional[str] = None,
    message: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    dedupe_key: Optional[str] = None,
    should_notify: bool = False,
    notification_channel: str = "slack",
) -> bool:
    """Best-effort trace insert.

    `target` can be an asyncpg connection or DatabaseConnection-like object
    exposing `execute(sql, *args)`.
    """
    execute = getattr(target, "execute", None)
    if execute is None:
        return False

    payload_json = payload or {}
    final_dedupe = dedupe_key or build_dedupe_key(
        trace_type,
        stage,
        status,
        startup_id,
        investor_id,
        queue_item_id,
        investor_queue_item_id,
        reason_code,
        message,
    )

    try:
        try:
            # Newer schema (068+) supports investor trace linkage.
            await execute(
                """
                INSERT INTO onboarding_trace_events (
                    startup_id,
                    investor_id,
                    queue_item_id,
                    investor_queue_item_id,
                    trace_type,
                    stage,
                    status,
                    severity,
                    reason_code,
                    message,
                    payload_json,
                    dedupe_key,
                    should_notify,
                    notification_channel
                )
                VALUES (
                    $1::uuid,
                    $2::uuid,
                    $3::uuid,
                    $4::uuid,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    $11::jsonb,
                    $12,
                    $13,
                    $14
                )
                ON CONFLICT (dedupe_key)
                DO NOTHING
                """,
                startup_id,
                investor_id,
                queue_item_id,
                investor_queue_item_id,
                trace_type,
                stage,
                status,
                severity,
                reason_code,
                (message or "")[:1200],
                json.dumps(payload_json),
                final_dedupe,
                bool(should_notify),
                notification_channel,
            )
        except Exception:
            # Back-compat: older schema supports only startup linkage.
            await execute(
                """
                INSERT INTO onboarding_trace_events (
                    startup_id,
                    queue_item_id,
                    trace_type,
                    stage,
                    status,
                    severity,
                    reason_code,
                    message,
                    payload_json,
                    dedupe_key,
                    should_notify,
                    notification_channel
                )
                VALUES (
                    $1::uuid,
                    $2::uuid,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9::jsonb,
                    $10,
                    $11,
                    $12
                )
                ON CONFLICT (dedupe_key)
                DO NOTHING
                """,
                startup_id,
                queue_item_id,
                trace_type,
                stage,
                status,
                severity,
                reason_code,
                (message or "")[:1200],
                json.dumps(payload_json),
                final_dedupe,
                bool(should_notify),
                notification_channel,
            )
        return True
    except Exception:
        # Table may not exist yet on partially migrated environments.
        logger.debug("Trace insert skipped (table missing or write failed).", exc_info=True)
        return False
