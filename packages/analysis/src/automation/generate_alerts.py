"""Alert generation pipeline — matches delta_events to user_subscriptions.

After delta_events are populated:
1. Query user_subscriptions for all active users
2. Match delta_events to subscriptions
3. Compute severity (1-5) based on magnitude + delta_type
4. Insert user_alerts with reason JSON
5. Generate LLM narratives (gpt-5-nano via DefaultAzureCredential)

Integration: Called via CLI `python main.py generate-alerts`
"""

from __future__ import annotations

import json
import logging
import os
from typing import Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

# Severity mapping by delta type + magnitude
SEVERITY_BASE = {
    "funding_round": 4,
    "stage_change": 3,
    "pattern_added": 2,
    "pattern_removed": 2,
    "signal_spike": 3,
    "score_change": 2,
    "employee_change": 2,
    "new_entry": 3,
    "gtm_shift": 2,
    "rank_jump": 2,
}


class AlertGenerator:
    """Generates user alerts from delta_events + subscriptions."""

    def __init__(self, conn: "asyncpg.Connection"):
        self.conn = conn

    async def run(self, period: str, scope: str = "global", generate_narratives: bool = True) -> dict:
        """Generate alerts for all users with subscriptions matching delta_events."""
        stats = {
            "deltas_checked": 0,
            "alerts_inserted": 0,
            "narratives_generated": 0,
            "errors": 0,
        }

        logger.info("Generating alerts: period=%s scope=%s", period, scope)

        # Load all subscriptions
        subs = await self._load_subscriptions(scope)
        if not subs:
            logger.info("No subscriptions found for scope=%s", scope)
            return stats

        # Load delta events for this period
        deltas = await self._load_deltas(period, scope)
        if not deltas:
            logger.info("No delta events for period=%s scope=%s", period, scope)
            return stats

        stats["deltas_checked"] = len(deltas)

        # Match deltas to subscriptions
        alerts_to_insert = []
        for delta in deltas:
            matching_users = self._find_matching_users(delta, subs)
            for user_id, reason in matching_users:
                severity = self._compute_severity(delta)
                alerts_to_insert.append({
                    "user_id": user_id,
                    "scope": scope,
                    "delta_id": delta["id"],
                    "severity": severity,
                    "reason": reason,
                })

        # Bulk insert alerts
        for alert in alerts_to_insert:
            try:
                result = await self.conn.execute(
                    """
                    INSERT INTO user_alerts (user_id, scope, delta_id, severity, reason)
                    VALUES ($1::uuid, $2, $3::uuid, $4, $5::jsonb)
                    ON CONFLICT (user_id, scope, delta_id) DO NOTHING
                    """,
                    alert["user_id"], alert["scope"], alert["delta_id"],
                    alert["severity"], json.dumps(alert["reason"]),
                )
                if result and result.endswith("1"):
                    stats["alerts_inserted"] += 1
            except Exception:
                logger.exception("Failed inserting alert for user %s", alert["user_id"])
                stats["errors"] += 1

        # Generate LLM narratives for high-severity alerts
        if generate_narratives:
            narrative_count = await self._generate_narratives(period, scope)
            stats["narratives_generated"] = narrative_count

        logger.info("Alert generation complete: %s", stats)
        return stats

    def _find_matching_users(self, delta: dict, subs: Dict[str, List[dict]]) -> List[tuple]:
        """Find users whose subscriptions match a delta event."""
        matches = []

        # Match startup subscriptions
        if delta["startup_id"]:
            for sub in subs.get("startup", []):
                if sub["object_id"] == str(delta["startup_id"]):
                    matches.append((sub["user_id"], {
                        "match_type": "startup",
                        "startup_id": delta["startup_id"],
                    }))

        # Match pattern subscriptions
        evidence = delta.get("evidence_json") or {}
        pattern_name = evidence.get("pattern_name")
        if pattern_name:
            for sub in subs.get("pattern", []):
                if sub["object_id"] == pattern_name:
                    matches.append((sub["user_id"], {
                        "match_type": "pattern",
                        "pattern": pattern_name,
                    }))

        # Match investor subscriptions (for funding rounds)
        lead_investor = evidence.get("lead_investor")
        if lead_investor and delta["delta_type"] == "funding_round":
            for sub in subs.get("investor", []):
                if sub["object_id"].lower() == lead_investor.lower():
                    matches.append((sub["user_id"], {
                        "match_type": "investor",
                        "investor": lead_investor,
                    }))

        return matches

    def _compute_severity(self, delta: dict) -> int:
        """Compute severity (1-5) based on delta type and magnitude."""
        base = SEVERITY_BASE.get(delta["delta_type"], 2)
        magnitude = delta.get("magnitude") or 0

        if magnitude >= 0.8:
            return min(5, base + 1)
        elif magnitude >= 0.5:
            return base
        else:
            return max(1, base - 1)

    async def _load_subscriptions(self, scope: str) -> Dict[str, List[dict]]:
        """Load all subscriptions grouped by object_type."""
        rows = await self.conn.fetch(
            """
            SELECT user_id::text, object_type, object_id
            FROM user_subscriptions
            WHERE scope = $1
            """,
            scope,
        )
        grouped: Dict[str, List[dict]] = {}
        for r in rows:
            grouped.setdefault(r["object_type"], []).append(dict(r))

        # Also include watchlist items as startup subscriptions
        wl_rows = await self.conn.fetch(
            """
            SELECT user_id::text, startup_id::text AS object_id
            FROM user_watchlists
            """,
        )
        for r in wl_rows:
            if r.get("object_id"):
                grouped.setdefault("startup", []).append({
                    "user_id": r["user_id"],
                    "object_type": "startup",
                    "object_id": r["object_id"],
                })

        return grouped

    async def _load_deltas(self, period: str, scope: str) -> List[dict]:
        """Load delta events for matching."""
        rows = await self.conn.fetch(
            """
            SELECT id::text, startup_id::text, signal_id::text,
                   delta_type, domain, region, magnitude, direction,
                   headline, detail, evidence_json
            FROM delta_events
            WHERE period = $1 AND region = $2
            """,
            period, scope,
        )
        result = []
        for r in rows:
            d = dict(r)
            if isinstance(d["evidence_json"], str):
                d["evidence_json"] = json.loads(d["evidence_json"])
            result.append(d)
        return result

    async def _generate_narratives(self, period: str, scope: str) -> int:
        """Generate LLM narratives for alerts that don't have one yet."""
        count = 0
        try:
            from src.config import AzureOpenAIConfig
            llm_config = AzureOpenAIConfig()
            client = llm_config.get_client()
        except Exception:
            logger.warning("LLM client unavailable — skipping narrative generation")
            return 0

        # Fetch alerts without narratives (batch of 50)
        rows = await self.conn.fetch(
            """
            SELECT ua.id::text AS alert_id, ua.severity,
                   de.headline, de.detail, de.delta_type, de.evidence_json,
                   s.name AS startup_name, s.slug AS startup_slug
            FROM user_alerts ua
            JOIN delta_events de ON de.id = ua.delta_id
            LEFT JOIN startups s ON s.id = de.startup_id
            WHERE ua.narrative IS NULL
              AND de.period = $1 AND de.region = $2
            ORDER BY ua.severity DESC
            LIMIT 50
            """,
            period, scope,
        )

        deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-nano")

        for row in rows:
            try:
                evidence = row["evidence_json"]
                if isinstance(evidence, str):
                    evidence = json.loads(evidence)

                prompt = f"""Generate a brief intelligence narrative for this alert.

Event: {row['headline']}
Type: {row['delta_type']}
Detail: {row['detail'] or 'N/A'}
Company: {row['startup_name'] or 'N/A'}
Evidence: {json.dumps(evidence, default=str)[:500]}

Return JSON with:
- one_liner: Single sentence summary (max 120 chars)
- why_it_matters: Array of 1-3 bullet points explaining significance
- what_to_watch: Array of 1-2 items with metric, threshold, reason
- links: Array of relevant internal links with label and url

Only cite evidence actually provided. Do not speculate."""

                response = client.chat.completions.create(
                    model=deployment,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                    max_completion_tokens=500,
                )
                narrative = json.loads(response.choices[0].message.content)

                # Add company link
                if row["startup_slug"]:
                    narrative.setdefault("links", []).insert(0, {
                        "label": row["startup_name"] or "Company",
                        "url": f"/company/{row['startup_slug']}",
                    })

                await self.conn.execute(
                    "UPDATE user_alerts SET narrative = $1::jsonb WHERE id = $2::uuid",
                    json.dumps(narrative), row["alert_id"],
                )
                count += 1
            except Exception:
                logger.exception("Failed generating narrative for alert %s", row["alert_id"])

        return count


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

async def run_generate_alerts(period: str, scope: str = "global", narratives: bool = True) -> dict:
    """Entry point for CLI / cron."""
    import asyncpg

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    conn = await asyncpg.connect(database_url)
    try:
        generator = AlertGenerator(conn)
        return await generator.run(period, scope, generate_narratives=narratives)
    finally:
        await conn.close()
