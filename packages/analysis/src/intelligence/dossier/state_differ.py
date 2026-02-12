"""Compare consecutive state snapshots and generate history entries.

Detects pattern additions/removals across architecture, GTM, and tech stack
domains by diffing array fields between consecutive snapshots.
"""

import logging
from typing import List

logger = logging.getLogger(__name__)

# Map of array fields to their domain classification
_ARRAY_FIELD_DOMAINS = {
    "build_patterns": "architecture",
    "discovered_patterns": "architecture",
    "tech_stack_models": "tech_stack",
    "tech_stack_frameworks": "tech_stack",
    "tech_stack_vector_dbs": "tech_stack",
}

# Scalar fields that represent strategy changes
_SCALAR_FIELD_DOMAINS = {
    "pricing_model": "gtm",
    "gtm_motion": "gtm",
    "implementation_maturity": "architecture",
}


class StateDiffer:
    """Compare consecutive state snapshots and generate history entries."""

    def __init__(self, emitter=None):
        """
        Args:
            emitter: Optional TransitionEmitter for converting diffs to events.
        """
        self._emitter = emitter

    async def diff_and_record(
        self,
        conn,
        startup_id: str,
        new_snapshot: dict,
        period: str,
    ) -> List[dict]:
        """Compare new snapshot against previous, write history entries for changes.

        Returns list of diff dicts for downstream emission.
        """
        # Fetch the previous snapshot (the one before the current period)
        prev = await conn.fetchrow(
            """SELECT * FROM startup_state_snapshot
               WHERE startup_id = $1 AND analysis_period != $2
               ORDER BY snapshot_at DESC LIMIT 1""",
            startup_id,
            period,
        )

        if not prev:
            # No previous snapshot — no diffs to compute
            return []

        diffs: List[dict] = []
        funding_stage = new_snapshot.get("funding_stage")
        prev_snapshot_at = prev.get("snapshot_at")

        # Diff array fields (pattern additions/removals)
        for field, domain in _ARRAY_FIELD_DOMAINS.items():
            new_set = set(new_snapshot.get(field, []) or [])
            old_set = set(prev.get(field, []) or [])

            added = new_set - old_set
            removed = old_set - new_set

            for pattern_name in added:
                diffs.append({
                    "domain": domain,
                    "pattern_name": pattern_name,
                    "change_type": "added",
                    "funding_stage_at_change": funding_stage,
                    "confidence": new_snapshot.get("confidence_score"),
                    "prev_snapshot_at": prev_snapshot_at,
                })

            for pattern_name in removed:
                diffs.append({
                    "domain": domain,
                    "pattern_name": pattern_name,
                    "change_type": "removed",
                    "funding_stage_at_change": funding_stage,
                    "confidence": new_snapshot.get("confidence_score"),
                    "prev_snapshot_at": prev_snapshot_at,
                })

        # Diff scalar strategy fields (GTM/pricing changes)
        for field, domain in _SCALAR_FIELD_DOMAINS.items():
            new_val = new_snapshot.get(field)
            old_val = prev.get(field)

            if new_val and old_val and new_val != old_val:
                # Strategy changed — record old as removed, new as added
                diffs.append({
                    "domain": domain,
                    "pattern_name": old_val,
                    "change_type": "removed",
                    "funding_stage_at_change": funding_stage,
                    "confidence": new_snapshot.get("confidence_score"),
                    "prev_snapshot_at": prev_snapshot_at,
                })
                diffs.append({
                    "domain": domain,
                    "pattern_name": new_val,
                    "change_type": "added",
                    "funding_stage_at_change": funding_stage,
                    "confidence": new_snapshot.get("confidence_score"),
                    "prev_snapshot_at": prev_snapshot_at,
                })
            elif new_val and not old_val:
                diffs.append({
                    "domain": domain,
                    "pattern_name": new_val,
                    "change_type": "added",
                    "funding_stage_at_change": funding_stage,
                    "confidence": new_snapshot.get("confidence_score"),
                    "prev_snapshot_at": prev_snapshot_at,
                })

        # Write diffs to architecture history table
        for diff in diffs:
            try:
                await conn.execute(
                    """INSERT INTO startup_architecture_history (
                           startup_id, domain, pattern_name, change_type,
                           funding_stage_at_change, confidence,
                           detected_at, prev_snapshot_at
                       ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
                       ON CONFLICT (startup_id, domain, pattern_name, detected_at)
                       DO NOTHING""",
                    startup_id,
                    diff["domain"],
                    diff["pattern_name"],
                    diff["change_type"],
                    diff.get("funding_stage_at_change"),
                    diff.get("confidence"),
                    diff.get("prev_snapshot_at"),
                )
            except Exception as exc:
                logger.warning(
                    "Failed to record architecture history for %s/%s: %s",
                    startup_id,
                    diff["pattern_name"],
                    exc,
                )

        if diffs:
            logger.info(
                "Recorded %d architecture changes for startup %s (period %s)",
                len(diffs),
                startup_id,
                period,
            )

        # Phase 3: Emit transition events if emitter is available
        if self._emitter and diffs:
            await self._emitter.emit_events(conn, startup_id, diffs)

        return diffs
