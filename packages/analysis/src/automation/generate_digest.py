"""Weekly digest generation — groups alerts by theme with LLM summaries.

Runs weekly (Mon 06:00 UTC via VM cron):
1. For each user with alerts in past 7 days
2. Group alerts by theme (delta_type, pattern cluster)
3. Generate digest summary via gpt-5-nano
4. Insert user_digest_threads

Integration: Called via CLI `python main.py generate-weekly-digest`
"""

from __future__ import annotations

import json
import logging
import os
from collections import defaultdict
from datetime import date, timedelta
from typing import Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)


class DigestGenerator:
    """Generates weekly digest threads for users with recent alerts."""

    def __init__(self, conn: "asyncpg.Connection"):
        self.conn = conn

    async def run(self, scope: str = "global", days: int = 7) -> dict:
        """Generate digest threads for all users with recent alerts."""
        stats = {"users_processed": 0, "digests_created": 0, "errors": 0}

        period_end = date.today()
        period_start = period_end - timedelta(days=days)

        logger.info("Generating digests: scope=%s period=%s to %s", scope, period_start, period_end)

        # Find users with alerts in the period
        user_rows = await self.conn.fetch(
            """
            SELECT DISTINCT user_id::text
            FROM user_alerts
            WHERE scope = $1
              AND created_at >= $2
              AND created_at < $3 + INTERVAL '1 day'
            """,
            scope, period_start, period_end,
        )

        for user_row in user_rows:
            user_id = user_row["user_id"]
            try:
                await self._generate_user_digest(user_id, scope, period_start, period_end)
                stats["digests_created"] += 1
            except Exception:
                logger.exception("Failed generating digest for user %s", user_id)
                stats["errors"] += 1
            stats["users_processed"] += 1

        logger.info("Digest generation complete: %s", stats)
        return stats

    async def _generate_user_digest(
        self, user_id: str, scope: str, period_start: date, period_end: date
    ) -> None:
        """Generate a single user's digest thread."""
        # Load alerts with delta details
        alerts = await self.conn.fetch(
            """
            SELECT ua.id::text AS alert_id, ua.severity, ua.narrative,
                   de.delta_type, de.headline, de.domain, de.magnitude,
                   s.name AS startup_name
            FROM user_alerts ua
            JOIN delta_events de ON de.id = ua.delta_id
            LEFT JOIN startups s ON s.id = de.startup_id
            WHERE ua.user_id = $1::uuid
              AND ua.scope = $2
              AND ua.created_at >= $3
              AND ua.created_at < $4 + INTERVAL '1 day'
            ORDER BY ua.severity DESC, de.magnitude DESC NULLS LAST
            """,
            user_id, scope, period_start, period_end,
        )

        if not alerts:
            return

        # Group by theme
        themes: Dict[str, List[dict]] = defaultdict(list)
        for a in alerts:
            theme_key = a["domain"] or a["delta_type"]
            themes[theme_key].append(dict(a))

        # Build theme summaries
        theme_list = []
        for theme_key, theme_alerts in themes.items():
            theme_list.append({
                "theme": theme_key,
                "count": len(theme_alerts),
                "top_headlines": [a["headline"] for a in theme_alerts[:3]],
                "max_severity": max(a["severity"] for a in theme_alerts),
            })
        theme_list.sort(key=lambda t: t["max_severity"], reverse=True)

        # Generate summary via LLM
        title = f"Weekly Intelligence Digest — {period_start.isoformat()} to {period_end.isoformat()}"
        summary = f"{len(alerts)} alerts across {len(themes)} themes"

        try:
            from src.config import AzureOpenAIConfig
            llm_config = AzureOpenAIConfig()
            client = llm_config.get_client()
            deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-nano")

            headlines = [a["headline"] for a in alerts[:20]]
            prompt = f"""Summarize this weekly intelligence digest in 2-3 sentences.

Themes: {json.dumps([t['theme'] for t in theme_list])}
Top headlines: {json.dumps(headlines[:10])}
Total alerts: {len(alerts)}

Return a concise narrative summary focusing on the most significant developments."""

            response = client.chat.completions.create(
                model=deployment,
                messages=[{"role": "user", "content": prompt}],
                max_completion_tokens=200,
            )
            summary = response.choices[0].message.content.strip()
        except Exception:
            logger.debug("LLM unavailable for digest summary, using default")

        alert_ids = [a["alert_id"] for a in alerts]

        await self.conn.execute(
            """
            INSERT INTO user_digest_threads
                (user_id, scope, period_start, period_end, title, summary, themes, alert_ids)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::text[])
            """,
            user_id, scope, period_start, period_end,
            title, summary, json.dumps(theme_list), alert_ids,
        )


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

async def run_generate_digest(scope: str = "global", days: int = 7) -> dict:
    """Entry point for CLI / cron."""
    import asyncpg

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    conn = await asyncpg.connect(database_url)
    try:
        generator = DigestGenerator(conn)
        return await generator.run(scope, days)
    finally:
        await conn.close()
