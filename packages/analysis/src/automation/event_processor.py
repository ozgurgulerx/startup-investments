"""Startup Events Processor.

Routes events from startup_events table to appropriate handlers
based on event_type, triggering re-analysis when needed.
"""

import asyncio
import logging
import os
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

from .db import DatabaseConnection
from .onboarding_trace import emit_trace

logger = logging.getLogger(__name__)


HIGH_IMPACT_EVENT_TYPES = {
    "cap_funding_raised",
    "cap_acquisition_announced",
    "prod_launched",
    "prod_major_update",
    "org_key_hire",
    # Legacy
    "funding_news",
}

MEDIUM_IMPACT_EVENT_TYPES = {
    "arch_pattern_adopted",
    "gtm_enterprise_tier_launched",
    "gtm_channel_launched",
    "gtm_open_source_strategy",
    "gtm_vertical_expansion",
    # Legacy
    "website_change",
    "hackernews_mention",
    "job_posting",
}

ACTIONABLE_ENQUEUE_BLOCK_REASONS = {
    "startup_missing_website",
    "startup_not_crawled_yet",
    "startup_low_crawl_success",
}


@dataclass
class ProcessingResult:
    """Result of processing a single event."""
    event_id: str
    event_type: str
    startup_name: Optional[str]
    success: bool
    action_taken: str
    triggered_reanalysis: bool = False
    error: Optional[str] = None


class StartupEventProcessor:
    """Processes startup events and enqueues gated deep-research jobs."""

    def __init__(
        self,
        db: Optional[DatabaseConnection] = None,
        auto_enqueue_research: bool = True
    ):
        self.db = db or DatabaseConnection()
        self.auto_enqueue_research = auto_enqueue_research
        self.min_event_confidence = float(os.getenv("DEEP_RESEARCH_MIN_EVENT_CONFIDENCE", "0.55"))
        self.min_crawl_success_rate = float(os.getenv("DEEP_RESEARCH_MIN_CRAWL_SUCCESS_RATE", "0.20"))

    async def process_events(self, batch_size: int = 50) -> List[ProcessingResult]:
        """Process a batch of unprocessed events."""
        results = []

        try:
            await self.db.connect()

            # Get unprocessed events
            events = await self.db.get_unprocessed_events(limit=batch_size)
            logger.info(f"Found {len(events)} unprocessed events")

            for event in events:
                result = await self._process_event(event)
                results.append(result)

            return results

        finally:
            await self.db.close()

    async def _process_event(self, event: Dict[str, Any]) -> ProcessingResult:
        """Process a single event."""
        event_id = str(event["id"])
        event_type = str(event.get("event_type") or "")
        startup_name = event.get("startup_name")
        startup_id = event.get("startup_id")
        confidence = event.get("confidence")

        logger.info(f"Processing event {event_id}: {event_type} for {startup_name or 'unknown startup'}")

        try:
            action_taken, should_reanalyze = self._route_event(event_type)

            # Enqueue for deep research if needed
            analysis_id = None
            if should_reanalyze and self.auto_enqueue_research and startup_id:
                await emit_trace(
                    self.db,
                    startup_id=str(startup_id),
                    queue_item_id=None,
                    trace_type="onboarding",
                    stage="research_enqueue_attempt",
                    status="info",
                    severity="info",
                    reason_code=event_type,
                    message=f"Evaluating deep-research enqueue for event {event_type}",
                    payload={"event_id": event_id, "event_type": event_type, "confidence": confidence},
                    dedupe_key=f"research_enqueue_attempt:{event_id}",
                    should_notify=False,
                )
                eligible, gate_reason, gate_payload = await self._eligible_for_research(
                    startup_id=str(startup_id),
                    confidence=confidence,
                )
                if eligible:
                    analysis_id = await self._enqueue_for_research(
                        startup_id=str(startup_id),
                        reason=event_type,
                        priority=self._get_priority_for_event(event_type)
                    )
                    if analysis_id:
                        logger.info("Enqueued %s for research (reason=%s)", startup_name, event_type)
                        await emit_trace(
                            self.db,
                            startup_id=str(startup_id),
                            queue_item_id=str(analysis_id),
                            trace_type="onboarding",
                            stage="research_enqueued",
                            status="success",
                            severity="info",
                            reason_code=event_type,
                            message=f"Deep research queued for {startup_name or startup_id}",
                            payload={"event_id": event_id, "priority": self._get_priority_for_event(event_type)},
                            dedupe_key=f"research_enqueued:{analysis_id}",
                            should_notify=True,
                        )
                    else:
                        action_taken = f"{action_taken}|already_queued_or_not_eligible"
                        await emit_trace(
                            self.db,
                            startup_id=str(startup_id),
                            queue_item_id=None,
                            trace_type="onboarding",
                            stage="research_enqueue_skipped",
                            status="info",
                            severity="info",
                            reason_code="already_queued_or_not_eligible",
                            message=f"Deep research enqueue skipped for {startup_name or startup_id}",
                            payload={"event_id": event_id, "event_type": event_type},
                            dedupe_key=f"research_enqueue_skipped:{event_id}",
                            should_notify=False,
                        )
                else:
                    action_taken = f"{action_taken}|gated"
                    reason = gate_reason or "gated"
                    await emit_trace(
                        self.db,
                        startup_id=str(startup_id),
                        queue_item_id=None,
                        trace_type="onboarding",
                        stage="research_enqueue_blocked",
                        status="warning",
                        severity="warning",
                        reason_code=reason,
                        message=f"Deep research enqueue blocked for {startup_name or startup_id}",
                        payload={
                            "event_id": event_id,
                            "event_type": event_type,
                            "gate_reason": reason,
                            **(gate_payload or {}),
                        },
                        dedupe_key=f"research_enqueue_blocked:{event_id}:{reason}",
                        should_notify=reason in ACTIONABLE_ENQUEUE_BLOCK_REASONS,
                    )
            elif should_reanalyze and self.auto_enqueue_research and not startup_id:
                await emit_trace(
                    self.db,
                    startup_id=None,
                    queue_item_id=None,
                    trace_type="onboarding",
                    stage="research_enqueue_blocked",
                    status="warning",
                    severity="warning",
                    reason_code="missing_startup_id",
                    message="Deep research enqueue blocked because startup_id is missing on event.",
                    payload={"event_id": event_id, "event_type": event_type},
                    dedupe_key=f"research_enqueue_blocked:{event_id}:missing_startup_id",
                    should_notify=False,
                )

            # Mark event as processed
            await self.db.mark_event_processed(
                event_id=event_id,
                triggered_reanalysis=should_reanalyze,
                analysis_id=analysis_id
            )

            return ProcessingResult(
                event_id=event_id,
                event_type=event_type,
                startup_name=startup_name,
                success=True,
                action_taken=action_taken,
                triggered_reanalysis=should_reanalyze
            )

        except Exception as e:
            logger.error(f"Error processing event {event_id}: {e}")
            await emit_trace(
                self.db,
                startup_id=str(startup_id) if startup_id else None,
                queue_item_id=None,
                trace_type="onboarding",
                stage="event_processing_failed",
                status="failure",
                severity="warning",
                reason_code="event_processor_exception",
                message=f"Event processing failed for {event_type}: {e}",
                payload={"event_id": event_id, "event_type": event_type},
                dedupe_key=f"event_processing_failed:{event_id}",
                should_notify=False,
            )

            # Increment retry count instead of marking as permanently processed.
            # After 3 failures, mark as status='failed' for manual review.
            try:
                await self.db.execute("""
                    UPDATE startup_events
                    SET retry_count = COALESCE(retry_count, 0) + 1,
                        last_error = $2,
                        last_error_at = NOW(),
                        status = CASE
                            WHEN COALESCE(retry_count, 0) + 1 >= 3 THEN 'failed'
                            ELSE 'pending'
                        END,
                        processed = CASE
                            WHEN COALESCE(retry_count, 0) + 1 >= 3 THEN true
                            ELSE false
                        END
                    WHERE id = $1
                """, event_id, str(e)[:500])
            except Exception as db_err:
                logger.error(f"Could not update retry count for event {event_id}: {db_err}")

            return ProcessingResult(
                event_id=event_id,
                event_type=event_type,
                startup_name=startup_name,
                success=False,
                action_taken="error",
                error=str(e)
            )

    def _route_event(self, event_type: str) -> tuple[str, bool]:
        """Map event type to processing action + whether research should be considered."""
        if event_type in HIGH_IMPACT_EVENT_TYPES:
            return "high_impact_event", True
        if event_type in MEDIUM_IMPACT_EVENT_TYPES:
            return "medium_impact_event", True
        if event_type.startswith(("cap_", "prod_", "gtm_", "arch_", "org_")):
            return "typed_signal_event", True
        return "logged_only", False

    async def _eligible_for_research(self, startup_id: str, confidence: Any) -> tuple[bool, str, Dict[str, Any]]:
        """Apply conservative queue gates before adding deep-research workload."""
        try:
            conf = float(confidence) if confidence is not None else 0.0
        except Exception:
            conf = 0.0
        if conf and conf < self.min_event_confidence:
            return False, "below_min_event_confidence", {
                "confidence": conf,
                "min_event_confidence": self.min_event_confidence,
            }

        snapshot = await self.db.get_startup_research_snapshot(startup_id)
        if not snapshot:
            return False, "missing_startup_snapshot", {}

        status = str(snapshot.get("onboarding_status") or "verified")
        if status in {"merged", "rejected"}:
            return False, "status_ineligible", {"onboarding_status": status}

        website = str(snapshot.get("website") or "").strip()
        if not website:
            return False, "startup_missing_website", {"onboarding_status": status}

        # For stubs, require at least one crawl before spending research budget.
        if status == "stub" and not snapshot.get("last_crawl_at"):
            return False, "startup_not_crawled_yet", {"onboarding_status": status}

        try:
            csr = float(snapshot.get("crawl_success_rate") or 0.0)
        except Exception:
            csr = 0.0
        if status == "stub" and csr > 0 and csr < self.min_crawl_success_rate:
            return False, "startup_low_crawl_success", {
                "onboarding_status": status,
                "crawl_success_rate": csr,
                "min_crawl_success_rate": self.min_crawl_success_rate,
            }

        return True, "eligible", {
            "onboarding_status": status,
            "has_website": bool(website),
            "crawl_success_rate": csr,
        }

    def _get_priority_for_event(self, event_type: str) -> int:
        """Get research queue priority based on event type."""
        if event_type in {"cap_funding_raised", "cap_acquisition_announced", "funding_news"}:
            return 1
        if event_type in {"prod_launched", "prod_major_update", "org_key_hire"}:
            return 2
        if event_type.startswith(("gtm_", "arch_")):
            return 3
        return 5

    async def _enqueue_for_research(
        self,
        startup_id: str,
        reason: str,
        priority: int = 5
    ) -> Optional[str]:
        """Enqueue a startup for deep research."""
        # Determine research depth based on reason
        if reason in {"cap_funding_raised", "cap_acquisition_announced", "funding_news"}:
            depth = "standard"
            focus = ["funding_impact", "market_position", "growth_signals", "capital_structure"]
        elif reason.startswith("arch_"):
            depth = "quick"
            focus = ["technical_architecture", "moat_assessment"]
        elif reason.startswith("gtm_"):
            depth = "quick"
            focus = ["go_to_market", "pricing", "distribution"]
        elif reason in {"prod_launched", "prod_major_update", "website_change"}:
            depth = "quick"
            focus = ["product_changes", "messaging_updates"]
        else:
            depth = "quick"
            focus = None

        return await self.db.enqueue_research(
            startup_id=startup_id,
            reason=reason,
            priority=priority,
            research_depth=depth,
            focus_areas=focus,
            require_crawled=True,
        )


async def run_event_processor(batch_size: int = 50) -> List[ProcessingResult]:
    """Run the event processor."""
    processor = StartupEventProcessor()
    results = await processor.process_events(batch_size=batch_size)

    success = sum(1 for r in results if r.success)
    reanalyzed = sum(1 for r in results if r.triggered_reanalysis)

    logger.info(f"Event processing complete: {success}/{len(results)} success, {reanalyzed} triggered reanalysis")

    return results
