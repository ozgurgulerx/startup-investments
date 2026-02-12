"""Convert state diffs into startup_events for the signal engine.

Maps architecture history diffs to canonical event types from event_registry,
then inserts them into startup_events with source_type='analysis_diff'.
The signal engine picks these up automatically during aggregation.
"""

import json
import logging
from typing import List

from ...automation.event_extractor import compute_event_key

logger = logging.getLogger(__name__)

# Map (domain, change_type) → event_type in event_registry
_DIFF_TO_EVENT_TYPE = {
    ("architecture", "added"): "arch_state_pattern_added",
    ("architecture", "removed"): "arch_state_pattern_removed",
    ("gtm", "added"): "gtm_state_strategy_changed",
    ("gtm", "removed"): "gtm_state_strategy_changed",
    ("tech_stack", "added"): "tech_state_model_changed",
    ("tech_stack", "removed"): "tech_state_model_changed",
}

# New event types to add to signal_seed.py EVENT_REGISTRY
NEW_EVENT_TYPES = [
    {
        "domain": "architecture",
        "event_type": "arch_state_pattern_added",
        "display_name": "Pattern Adopted (Analysis)",
        "description": "Pattern adoption detected from analysis diff (not news)",
        "extraction_method": "heuristic",
    },
    {
        "domain": "architecture",
        "event_type": "arch_state_pattern_removed",
        "display_name": "Pattern Dropped (Analysis)",
        "description": "Pattern removal detected from analysis diff",
        "extraction_method": "heuristic",
    },
    {
        "domain": "gtm",
        "event_type": "gtm_state_strategy_changed",
        "display_name": "GTM Strategy Changed (Analysis)",
        "description": "GTM motion or pricing model changed detected from analysis diff",
        "extraction_method": "heuristic",
    },
    {
        "domain": "product",
        "event_type": "tech_state_model_changed",
        "display_name": "Tech Stack Changed (Analysis)",
        "description": "LLM model, framework, or vector DB change detected from analysis diff",
        "extraction_method": "heuristic",
    },
]


class TransitionEmitter:
    """Convert state diffs into startup_events for the signal engine."""

    async def emit_events(
        self,
        conn,
        startup_id: str,
        diffs: List[dict],
    ) -> int:
        """For each state transition diff, INSERT into startup_events.

        Returns count of events emitted.
        """
        emitted = 0

        # Ensure event_registry has our new event types
        await self._ensure_event_types(conn)

        for diff in diffs:
            key = (diff["domain"], diff["change_type"])
            event_type = _DIFF_TO_EVENT_TYPE.get(key)
            if not event_type:
                continue

            # Look up the event_registry_id
            registry_row = await conn.fetchrow(
                "SELECT id FROM event_registry WHERE event_type = $1",
                event_type,
            )
            registry_id = registry_row["id"] if registry_row else None

            metadata = {
                "pattern_name": diff["pattern_name"],
                "change_type": diff["change_type"],
                "domain": diff["domain"],
                "funding_stage_at_change": diff.get("funding_stage_at_change"),
            }
            event_key = compute_event_key(event_type, metadata)

            try:
                await conn.execute(
                    """INSERT INTO startup_events (
                           startup_id, event_type, event_registry_id,
                           confidence, source_type, metadata_json, region,
                           event_key
                       ) VALUES ($1, $2, $3, $4, 'analysis_diff', $5::jsonb, 'global',
                                 $6)
                       ON CONFLICT DO NOTHING""",
                    startup_id,
                    event_type,
                    registry_id,
                    diff.get("confidence"),
                    json.dumps(metadata),
                    event_key,
                )
                emitted += 1
            except Exception as exc:
                logger.warning(
                    "Failed to emit event %s for startup %s: %s",
                    event_type,
                    startup_id,
                    exc,
                )

        if emitted:
            logger.info(
                "Emitted %d transition events for startup %s",
                emitted,
                startup_id,
            )

        return emitted

    async def _ensure_event_types(self, conn) -> None:
        """Ensure our new event types exist in event_registry."""
        for evt in NEW_EVENT_TYPES:
            await conn.execute(
                """INSERT INTO event_registry (domain, event_type, display_name, description, extraction_method)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (event_type) DO NOTHING""",
                evt["domain"],
                evt["event_type"],
                evt["display_name"],
                evt["description"],
                evt["extraction_method"],
            )
