"""Delta event generator — detects and records startup state changes.

Compares consecutive period snapshots and emits delta_events for significant
changes: funding rounds, pattern shifts, score changes, stage transitions,
employee changes, signal spikes, new entries, and GTM shifts.

Integration: Called via CLI `python main.py generate-deltas --period 2026-02`
"""

from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

CONFIDENCE_SCORE_THRESHOLD = 0.1
ENGINEERING_QUALITY_THRESHOLD = 0.15
EMPLOYEE_ABS_THRESHOLD = 10
EMPLOYEE_REL_THRESHOLD = 0.3
SIGNAL_UPDATE_TYPES = ("status_change", "evidence_spike")


# ---------------------------------------------------------------------------
# Delta types
# ---------------------------------------------------------------------------

DELTA_TYPES = (
    "funding_round",
    "pattern_added",
    "pattern_removed",
    "signal_spike",
    "score_change",
    "stage_change",
    "employee_change",
    "rank_jump",
    "new_entry",
    "gtm_shift",
)


@dataclass
class DeltaEvent:
    """A single delta event to be inserted."""
    startup_id: Optional[str]
    delta_type: str
    domain: str
    region: str
    old_value: Optional[str]
    new_value: Optional[str]
    magnitude: float
    direction: str
    headline: str
    detail: Optional[str] = None
    signal_id: Optional[str] = None
    evidence_json: dict = field(default_factory=dict)
    period: Optional[str] = None
    effective_at: Optional[datetime] = None


class DeltaGenerator:
    """Generates delta events by diffing startup state across periods."""

    def __init__(self, conn: "asyncpg.Connection"):
        self.conn = conn

    async def run(self, period: str, region: str = "global") -> dict:
        """Generate all delta events for a given period and region."""
        stats = {t: 0 for t in DELTA_TYPES}
        stats["total"] = 0
        stats["skipped_duplicate"] = 0

        # Determine the previous period
        prev_period = _prev_period(period)
        logger.info("Generating deltas for period=%s region=%s (prev=%s)", period, region, prev_period)

        # Collect events from all detectors
        events: List[DeltaEvent] = []

        events.extend(await self._detect_funding_rounds(period, region))
        events.extend(await self._detect_pattern_changes(period, region, prev_period))
        events.extend(await self._detect_score_changes(period, region, prev_period))
        events.extend(await self._detect_stage_changes(period, region, prev_period))
        events.extend(await self._detect_employee_changes(period, region))
        events.extend(await self._detect_signal_spikes(period, region))
        events.extend(await self._detect_new_entries(period, region, prev_period))
        events.extend(await self._detect_gtm_shifts(period, region, prev_period))

        # Normalize magnitudes per type
        _normalize_magnitudes(events)

        # Bulk insert with deduplication
        inserted = 0
        for ev in events:
            try:
                result = await self.conn.execute(
                    """
                    INSERT INTO delta_events
                        (startup_id, signal_id, delta_type, domain, region,
                         old_value, new_value, magnitude, direction,
                         headline, detail, evidence_json, period, effective_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
                    ON CONFLICT (startup_id, delta_type, period,
                                 COALESCE(old_value, ''), COALESCE(new_value, ''))
                    DO NOTHING
                    """,
                    ev.startup_id,
                    ev.signal_id,
                    ev.delta_type,
                    ev.domain,
                    ev.region,
                    ev.old_value,
                    ev.new_value,
                    ev.magnitude,
                    ev.direction,
                    ev.headline,
                    ev.detail,
                    _json_str(ev.evidence_json),
                    ev.period,
                    ev.effective_at or datetime.now(timezone.utc),
                )
                if result and result.endswith("1"):
                    inserted += 1
                    stats[ev.delta_type] = stats.get(ev.delta_type, 0) + 1
                else:
                    stats["skipped_duplicate"] += 1
            except Exception:
                logger.exception("Failed to insert delta event: %s", ev.headline)

        stats["total"] = inserted
        logger.info("Delta generation complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # Detectors
    # ------------------------------------------------------------------

    async def _detect_funding_rounds(self, period: str, region: str) -> List[DeltaEvent]:
        """New funding rounds announced in this period."""
        rows = await self.conn.fetch(
            """
            SELECT fr.startup_id, fr.round_type, fr.amount_usd, fr.lead_investor,
                   fr.announced_date, s.name, s.dataset_region
            FROM funding_rounds fr
            JOIN startups s ON s.id = fr.startup_id
            WHERE fr.announced_date >= ($1 || '-01')::date
              AND fr.announced_date < (($1 || '-01')::date + INTERVAL '1 month')
              AND s.dataset_region = $2
            """,
            period, region,
        )
        events = []
        for r in rows:
            amount = r["amount_usd"] or 0
            headline = f"{r['name']} raised {_format_usd(amount)} ({r['round_type']})"
            if r["lead_investor"]:
                headline += f" led by {r['lead_investor']}"
            events.append(DeltaEvent(
                startup_id=str(r["startup_id"]),
                delta_type="funding_round",
                domain="capital",
                region=region,
                old_value=None,
                new_value=r["round_type"],
                magnitude=math.log1p(amount / 1e6) if amount else 0,  # raw, normalized later
                direction="up",
                headline=headline,
                detail=f"${amount:,.0f} {r['round_type']}" if amount else r["round_type"],
                evidence_json={"amount_usd": amount, "round_type": r["round_type"],
                               "lead_investor": r["lead_investor"]},
                period=period,
                effective_at=datetime.combine(r["announced_date"], datetime.min.time(),
                                             tzinfo=timezone.utc) if r["announced_date"] else None,
            ))
        return events

    async def _detect_pattern_changes(self, period: str, region: str, prev_period: str) -> List[DeltaEvent]:
        """Patterns added or removed between periods, via architecture history."""
        rows = await self.conn.fetch(
            """
            SELECT ah.startup_id, ah.pattern_name, ah.change_type, ah.domain,
                   ah.confidence, s.name
            FROM startup_architecture_history ah
            JOIN startups s ON s.id = ah.startup_id
            WHERE ah.detected_at >= ($1 || '-01')::date
              AND ah.detected_at < (($1 || '-01')::date + INTERVAL '1 month')
              AND s.dataset_region = $2
            """,
            period, region,
        )
        events = []
        for r in rows:
            change = r["change_type"]  # added, removed, upgraded
            delta_type = "pattern_added" if change in ("added", "upgraded") else "pattern_removed"
            direction = "new" if change == "added" else ("up" if change == "upgraded" else "down")
            headline = f"{r['name']}: {r['pattern_name']} {change}"
            events.append(DeltaEvent(
                startup_id=str(r["startup_id"]),
                delta_type=delta_type,
                domain=r["domain"] or "architecture",
                region=region,
                old_value=None if change == "added" else r["pattern_name"],
                new_value=r["pattern_name"] if change != "removed" else None,
                magnitude=r["confidence"] or 0.5,
                direction=direction,
                headline=headline,
                evidence_json={"pattern_name": r["pattern_name"], "change_type": change,
                               "confidence": float(r["confidence"]) if r["confidence"] else None},
                period=period,
            ))
        return events

    async def _detect_score_changes(self, period: str, region: str, prev_period: str) -> List[DeltaEvent]:
        """Significant changes in confidence or engineering quality scores."""
        rows = await self.conn.fetch(
            """
            SELECT curr.startup_id, curr.confidence_score AS curr_conf,
                   prev.confidence_score AS prev_conf,
                   curr.engineering_quality_score AS curr_eq,
                   prev.engineering_quality_score AS prev_eq,
                   s.name
            FROM startup_state_snapshot curr
            JOIN startup_state_snapshot prev
              ON prev.startup_id = curr.startup_id AND prev.analysis_period = $3
            JOIN startups s ON s.id = curr.startup_id
            WHERE curr.analysis_period = $1
              AND s.dataset_region = $2
            """,
            period, region, prev_period,
        )
        events = []
        for r in rows:
            # Confidence score change
            if r["curr_conf"] is not None and r["prev_conf"] is not None:
                delta = r["curr_conf"] - r["prev_conf"]
                if abs(delta) >= CONFIDENCE_SCORE_THRESHOLD:
                    direction = "up" if delta > 0 else "down"
                    events.append(DeltaEvent(
                        startup_id=str(r["startup_id"]),
                        delta_type="score_change",
                        domain="general",
                        region=region,
                        old_value=f"{r['prev_conf']:.2f}",
                        new_value=f"{r['curr_conf']:.2f}",
                        magnitude=abs(delta),
                        direction=direction,
                        headline=f"{r['name']}: confidence {direction} {abs(delta):.2f} to {r['curr_conf']:.2f}",
                        evidence_json={"metric": "confidence_score", "delta": float(delta)},
                        period=period,
                    ))
            # Engineering quality score change
            if r["curr_eq"] is not None and r["prev_eq"] is not None:
                delta = r["curr_eq"] - r["prev_eq"]
                if abs(delta) >= ENGINEERING_QUALITY_THRESHOLD:
                    direction = "up" if delta > 0 else "down"
                    events.append(DeltaEvent(
                        startup_id=str(r["startup_id"]),
                        delta_type="score_change",
                        domain="architecture",
                        region=region,
                        old_value=f"eq:{r['prev_eq']:.2f}",
                        new_value=f"eq:{r['curr_eq']:.2f}",
                        magnitude=abs(delta),
                        direction=direction,
                        headline=f"{r['name']}: engineering quality {direction} {abs(delta):.2f}",
                        evidence_json={"metric": "engineering_quality_score", "delta": float(delta)},
                        period=period,
                    ))
        return events

    async def _detect_stage_changes(self, period: str, region: str, prev_period: str) -> List[DeltaEvent]:
        """Funding stage transitions between periods."""
        rows = await self.conn.fetch(
            """
            SELECT curr.startup_id, curr.funding_stage AS curr_stage,
                   prev.funding_stage AS prev_stage, s.name
            FROM startup_state_snapshot curr
            JOIN startup_state_snapshot prev
              ON prev.startup_id = curr.startup_id AND prev.analysis_period = $3
            JOIN startups s ON s.id = curr.startup_id
            WHERE curr.analysis_period = $1
              AND s.dataset_region = $2
              AND curr.funding_stage IS DISTINCT FROM prev.funding_stage
              AND curr.funding_stage IS NOT NULL
              AND prev.funding_stage IS NOT NULL
            """,
            period, region, prev_period,
        )
        events = []
        for r in rows:
            events.append(DeltaEvent(
                startup_id=str(r["startup_id"]),
                delta_type="stage_change",
                domain="capital",
                region=region,
                old_value=r["prev_stage"],
                new_value=r["curr_stage"],
                magnitude=0.7,  # stage changes are always significant
                direction="up",
                headline=f"{r['name']}: stage changed from {r['prev_stage']} to {r['curr_stage']}",
                evidence_json={"from": r["prev_stage"], "to": r["curr_stage"]},
                period=period,
            ))
        return events

    async def _detect_employee_changes(self, period: str, region: str) -> List[DeltaEvent]:
        """Significant employee count changes from startup_snapshots."""
        rows = await self.conn.fetch(
            """
            SELECT ss.startup_id, ss.employee_delta, ss.employee_count, s.name
            FROM startup_snapshots ss
            JOIN startups s ON s.id = ss.startup_id
            WHERE ss.period = $1
              AND s.dataset_region = $2
              AND ss.employee_delta IS NOT NULL
              AND ss.employee_count IS NOT NULL
            """,
            period, region,
        )
        events = []
        for r in rows:
            delta = r["employee_delta"]
            count = r["employee_count"]
            prev = count - delta if count else 0
            rel = abs(delta) / max(1, prev) if prev else 1.0

            if abs(delta) > EMPLOYEE_ABS_THRESHOLD or rel > EMPLOYEE_REL_THRESHOLD:
                direction = "up" if delta > 0 else "down"
                events.append(DeltaEvent(
                    startup_id=str(r["startup_id"]),
                    delta_type="employee_change",
                    domain="org",
                    region=region,
                    old_value=str(prev),
                    new_value=str(count),
                    magnitude=rel,
                    direction=direction,
                    headline=f"{r['name']}: headcount {'grew' if delta > 0 else 'shrank'} by {abs(delta)} to {count}",
                    evidence_json={"delta": delta, "current": count, "previous": prev},
                    period=period,
                ))
        return events

    async def _detect_signal_spikes(self, period: str, region: str) -> List[DeltaEvent]:
        """Signal status changes and evidence spikes from signal_updates."""
        rows = await self.conn.fetch(
            """
            SELECT su.signal_id, su.update_type, su.old_value, su.new_value,
                   su.metadata_json, su.created_at,
                   sig.claim, sig.domain, sig.region
            FROM signal_updates su
            JOIN signals sig ON sig.id = su.signal_id
            WHERE su.created_at >= ($1 || '-01')::date
              AND su.created_at < (($1 || '-01')::date + INTERVAL '1 month')
              AND su.update_type = ANY($2)
              AND sig.region = $3
            """,
            period, SIGNAL_UPDATE_TYPES, region,
        )
        events = []
        for r in rows:
            headline = f"Signal: {r['claim'][:80]}"
            if r["update_type"] == "status_change":
                headline = f"Signal '{r['claim'][:60]}' moved to {r['new_value']}"
                magnitude = 0.6
            else:
                headline = f"Signal '{r['claim'][:60]}' evidence spike"
                magnitude = 0.4

            events.append(DeltaEvent(
                startup_id=None,  # signal-level, not startup-level
                signal_id=str(r["signal_id"]),
                delta_type="signal_spike",
                domain=r["domain"] or "general",
                region=region,
                old_value=r["old_value"],
                new_value=r["new_value"],
                magnitude=magnitude,
                direction="up" if r["update_type"] == "evidence_spike" else "neutral",
                headline=headline,
                evidence_json={"update_type": r["update_type"],
                               "metadata": dict(r["metadata_json"]) if r["metadata_json"] else {}},
                period=period,
                effective_at=r["created_at"],
            ))
        return events

    async def _detect_new_entries(self, period: str, region: str, prev_period: str) -> List[DeltaEvent]:
        """Startups appearing for the first time in this period."""
        rows = await self.conn.fetch(
            """
            SELECT s.id, s.name, s.funding_stage, s.money_raised_usd
            FROM startups s
            WHERE s.period = $1
              AND s.dataset_region = $2
              AND NOT EXISTS (
                  SELECT 1 FROM startups s2
                  WHERE s2.slug = s.slug
                    AND s2.dataset_region = s.dataset_region
                    AND s2.period < $1
                    AND s2.period IS NOT NULL
              )
            """,
            period, region,
        )
        events = []
        for r in rows:
            funding = r["money_raised_usd"] or 0
            headline = f"{r['name']} entered the dataset"
            if r["funding_stage"]:
                headline += f" at {r['funding_stage']}"
            events.append(DeltaEvent(
                startup_id=str(r["id"]),
                delta_type="new_entry",
                domain="general",
                region=region,
                old_value=None,
                new_value=r["name"],
                magnitude=math.log1p(funding / 1e6) if funding else 0.3,
                direction="new",
                headline=headline,
                evidence_json={"funding_stage": r["funding_stage"],
                               "money_raised_usd": funding},
                period=period,
            ))
        return events

    async def _detect_gtm_shifts(self, period: str, region: str, prev_period: str) -> List[DeltaEvent]:
        """Changes in GTM motion or pricing model between periods."""
        rows = await self.conn.fetch(
            """
            SELECT curr.startup_id,
                   curr.gtm_motion AS curr_gtm, prev.gtm_motion AS prev_gtm,
                   curr.pricing_model AS curr_pricing, prev.pricing_model AS prev_pricing,
                   s.name
            FROM startup_state_snapshot curr
            JOIN startup_state_snapshot prev
              ON prev.startup_id = curr.startup_id AND prev.analysis_period = $3
            JOIN startups s ON s.id = curr.startup_id
            WHERE curr.analysis_period = $1
              AND s.dataset_region = $2
            """,
            period, region, prev_period,
        )
        events = []
        for r in rows:
            # GTM motion change
            if (r["curr_gtm"] and r["prev_gtm"] and
                    r["curr_gtm"] != r["prev_gtm"]):
                events.append(DeltaEvent(
                    startup_id=str(r["startup_id"]),
                    delta_type="gtm_shift",
                    domain="gtm",
                    region=region,
                    old_value=r["prev_gtm"],
                    new_value=r["curr_gtm"],
                    magnitude=0.5,
                    direction="neutral",
                    headline=f"{r['name']}: GTM shifted from {r['prev_gtm']} to {r['curr_gtm']}",
                    evidence_json={"field": "gtm_motion",
                                   "from": r["prev_gtm"], "to": r["curr_gtm"]},
                    period=period,
                ))
            # Pricing model change
            if (r["curr_pricing"] and r["prev_pricing"] and
                    r["curr_pricing"] != r["prev_pricing"]):
                events.append(DeltaEvent(
                    startup_id=str(r["startup_id"]),
                    delta_type="gtm_shift",
                    domain="gtm",
                    region=region,
                    old_value=f"pricing:{r['prev_pricing']}",
                    new_value=f"pricing:{r['curr_pricing']}",
                    magnitude=0.4,
                    direction="neutral",
                    headline=f"{r['name']}: pricing changed from {r['prev_pricing']} to {r['curr_pricing']}",
                    evidence_json={"field": "pricing_model",
                                   "from": r["prev_pricing"], "to": r["curr_pricing"]},
                    period=period,
                ))
        return events


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _prev_period(period: str) -> str:
    """Given '2026-02', return '2026-01'."""
    year, month = int(period[:4]), int(period[5:7])
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


def _format_usd(amount: int) -> str:
    if amount >= 1_000_000_000:
        return f"${amount / 1e9:.1f}B"
    if amount >= 1_000_000:
        return f"${amount / 1e6:.1f}M"
    if amount >= 1_000:
        return f"${amount / 1e3:.0f}K"
    return f"${amount:,.0f}"


def _normalize_magnitudes(events: List[DeltaEvent]) -> None:
    """Normalize magnitudes to [0, 1] per delta_type."""
    by_type: Dict[str, List[DeltaEvent]] = {}
    for ev in events:
        by_type.setdefault(ev.delta_type, []).append(ev)

    for dtype, evs in by_type.items():
        if not evs:
            continue
        max_mag = max(ev.magnitude for ev in evs)
        if max_mag > 0:
            for ev in evs:
                ev.magnitude = min(1.0, ev.magnitude / max_mag)


def _json_str(d: dict) -> str:
    import json
    return json.dumps(d, default=str)


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

async def run_delta_generation(period: str, region: str = "global") -> dict:
    """Entry point for CLI / cron. Connects to DB and runs the generator."""
    import asyncpg

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    conn = await asyncpg.connect(database_url)
    try:
        generator = DeltaGenerator(conn)
        return await generator.run(period, region)
    finally:
        await conn.close()
