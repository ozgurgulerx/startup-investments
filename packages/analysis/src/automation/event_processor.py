"""Startup Events Processor.

Routes events from startup_events table to appropriate handlers
based on event_type, triggering re-analysis when needed.
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional, Callable
from datetime import datetime, timezone
from dataclasses import dataclass
from enum import Enum

from .db import DatabaseConnection

logger = logging.getLogger(__name__)


class EventType(str, Enum):
    FUNDING_NEWS = "funding_news"
    WEBSITE_CHANGE = "website_change"
    HACKERNEWS_MENTION = "hackernews_mention"
    JOB_POSTING = "job_posting"


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
    """Processes startup events and routes to appropriate handlers."""

    def __init__(
        self,
        db: Optional[DatabaseConnection] = None,
        auto_enqueue_research: bool = True
    ):
        self.db = db or DatabaseConnection()
        self.auto_enqueue_research = auto_enqueue_research

        # Event handlers registry
        self._handlers: Dict[str, Callable] = {
            EventType.FUNDING_NEWS: self._handle_funding_news,
            EventType.WEBSITE_CHANGE: self._handle_website_change,
            EventType.HACKERNEWS_MENTION: self._handle_hackernews_mention,
            EventType.JOB_POSTING: self._handle_job_posting,
        }

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
        event_type = event["event_type"]
        startup_name = event.get("startup_name")
        startup_id = event.get("startup_id")

        logger.info(f"Processing event {event_id}: {event_type} for {startup_name or 'unknown startup'}")

        try:
            # Get handler for event type
            handler = self._handlers.get(event_type)

            if not handler:
                logger.warning(f"No handler for event type: {event_type}")
                await self.db.mark_event_processed(event_id, triggered_reanalysis=False)
                return ProcessingResult(
                    event_id=event_id,
                    event_type=event_type,
                    startup_name=startup_name,
                    success=True,
                    action_taken="no_handler",
                    triggered_reanalysis=False
                )

            # Execute handler
            action_taken, should_reanalyze = await handler(event)

            # Enqueue for deep research if needed
            analysis_id = None
            if should_reanalyze and self.auto_enqueue_research and startup_id:
                analysis_id = await self._enqueue_for_research(
                    startup_id=startup_id,
                    reason=event_type,
                    priority=self._get_priority_for_event(event_type)
                )
                logger.info(f"Enqueued {startup_name} for research (reason: {event_type})")

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

            # Mark as processed to avoid retry loop (could add retry logic)
            await self.db.mark_event_processed(event_id, triggered_reanalysis=False)

            return ProcessingResult(
                event_id=event_id,
                event_type=event_type,
                startup_name=startup_name,
                success=False,
                action_taken="error",
                error=str(e)
            )

    async def _handle_funding_news(self, event: Dict[str, Any]) -> tuple[str, bool]:
        """Handle funding news events - high priority, always re-analyze."""
        event_title = event.get("event_title", "")
        event_content = event.get("event_content", "")

        # Log the funding event details
        logger.info(f"Funding news detected: {event_title}")

        # Funding events always trigger re-analysis
        return "funding_detected", True

    async def _handle_website_change(self, event: Dict[str, Any]) -> tuple[str, bool]:
        """Handle website change events - re-analyze if significant."""
        event_content = event.get("event_content", "")

        # Determine if change is significant
        # For now, always re-analyze on website changes
        # Could add logic to check content hash diff significance
        significant = True

        if significant:
            logger.info(f"Significant website change detected for {event.get('startup_name')}")
            return "website_change_significant", True
        else:
            return "website_change_minor", False

    async def _handle_hackernews_mention(self, event: Dict[str, Any]) -> tuple[str, bool]:
        """Handle HackerNews mention events - re-analyze if high engagement."""
        event_url = event.get("event_url", "")
        event_content = event.get("event_content", "")

        # Check for high engagement signals in content
        # This would ideally parse the HN data for points/comments
        high_engagement = "points" in event_content.lower() or "comments" in event_content.lower()

        if high_engagement:
            logger.info(f"High engagement HN mention for {event.get('startup_name')}")
            return "hackernews_high_engagement", True
        else:
            return "hackernews_mention_logged", False

    async def _handle_job_posting(self, event: Dict[str, Any]) -> tuple[str, bool]:
        """Handle job posting events - re-analyze for tech stack updates."""
        event_content = event.get("event_content", "")

        # Job postings can reveal tech stack changes
        # Re-analyze if it mentions interesting tech
        tech_keywords = ["llm", "gpt", "claude", "vector", "embeddings", "ml", "ai"]
        mentions_tech = any(kw in event_content.lower() for kw in tech_keywords)

        if mentions_tech:
            logger.info(f"Tech-focused job posting detected for {event.get('startup_name')}")
            return "job_posting_tech", True
        else:
            return "job_posting_logged", False

    def _get_priority_for_event(self, event_type: str) -> int:
        """Get research queue priority based on event type."""
        priorities = {
            EventType.FUNDING_NEWS: 1,      # Highest priority
            EventType.WEBSITE_CHANGE: 3,
            EventType.HACKERNEWS_MENTION: 4,
            EventType.JOB_POSTING: 5,
        }
        return priorities.get(event_type, 5)

    async def _enqueue_for_research(
        self,
        startup_id: str,
        reason: str,
        priority: int = 5
    ) -> Optional[str]:
        """Enqueue a startup for deep research."""
        # Determine research depth based on reason
        if reason == EventType.FUNDING_NEWS:
            depth = "standard"
            focus = ["funding_impact", "market_position", "growth_signals"]
        elif reason == EventType.WEBSITE_CHANGE:
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
            focus_areas=focus
        )


async def run_event_processor(batch_size: int = 50) -> List[ProcessingResult]:
    """Run the event processor."""
    processor = StartupEventProcessor()
    results = await processor.process_events(batch_size=batch_size)

    success = sum(1 for r in results if r.success)
    reanalyzed = sum(1 for r in results if r.triggered_reanalysis)

    logger.info(f"Event processing complete: {success}/{len(results)} success, {reanalyzed} triggered reanalysis")

    return results
