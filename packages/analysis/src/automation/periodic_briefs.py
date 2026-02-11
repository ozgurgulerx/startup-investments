"""Periodic brief generators (weekly, monthly) for BuildAtlas.

Produces hybrid briefs: template stats (JSON) + LLM narrative sections.
Supports both global and turkey regions.

Usage:
    python main.py generate-weekly-brief --region turkey --week 2026-02-03
    python main.py generate-monthly-brief-news --region turkey --month 2026-01
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Sequence

from src.config import llm_kwargs

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Azure OpenAI helper — reuses the same env vars as news_ingest.py
# ---------------------------------------------------------------------------

async def _get_llm_client() -> Any:
    """Create an Azure OpenAI async client (or None if not configured)."""
    try:
        from openai import AsyncAzureOpenAI
    except ImportError:
        return None

    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
    api_key = os.getenv("AZURE_OPENAI_API_KEY", "")

    if endpoint:
        # Try AAD auth first
        try:
            from azure.identity.aio import DefaultAzureCredential
            credential = DefaultAzureCredential()
            return AsyncAzureOpenAI(
                azure_endpoint=endpoint,
                azure_ad_token_provider=lambda: credential.get_token(
                    "https://cognitiveservices.azure.com/.default"
                ),
                api_version="2024-12-01-preview",
            )
        except Exception:
            pass
        if api_key:
            return AsyncAzureOpenAI(
                api_key=api_key,
                azure_endpoint=endpoint,
                api_version="2024-12-01-preview",
            )

    return None


# ---------------------------------------------------------------------------
# Data loaders — fetch stories from editions within a date range
# ---------------------------------------------------------------------------

async def _load_period_clusters(
    conn: asyncpg.Connection,
    region: str,
    start_date: date,
    end_date: date,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Load top clusters from daily editions in the given date range."""
    rows = await conn.fetch(
        """
        SELECT c.id::text, c.cluster_key, c.title, c.summary, c.story_type,
               c.entities, c.topic_tags, c.rank_score, c.trust_score,
               c.source_count, c.published_at,
               c.llm_summary, c.builder_takeaway, c.llm_signal_score,
               c.impact
        FROM news_clusters c
        INNER JOIN news_topic_index t ON t.cluster_id = c.id
        WHERE t.edition_date >= $1 AND t.edition_date <= $2
          AND t.region = $3
        GROUP BY c.id
        ORDER BY MAX(c.rank_score) DESC
        LIMIT $4
        """,
        start_date,
        end_date,
        region,
        limit,
    )
    return [dict(r) for r in rows]


async def _load_period_topics(
    conn: asyncpg.Connection,
    region: str,
    start_date: date,
    end_date: date,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Load top topics by cluster count in the date range."""
    rows = await conn.fetch(
        """
        SELECT topic, COUNT(DISTINCT cluster_id) AS cluster_count,
               AVG(rank_score) AS avg_score
        FROM news_topic_index
        WHERE edition_date >= $1 AND edition_date <= $2
          AND region = $3
        GROUP BY topic
        ORDER BY cluster_count DESC
        LIMIT $4
        """,
        start_date,
        end_date,
        region,
        limit,
    )
    return [dict(r) for r in rows]


async def _load_period_entity_facts(
    conn: asyncpg.Connection,
    region: str,
    start_date: date,
    end_date: date,
) -> Dict[str, Any]:
    """Load entity fact stats from the date range."""
    # Region filter: turkey sees global + turkey facts
    if region == "turkey":
        region_filter = "region IN ('global', 'turkey')"
    else:
        region_filter = "region = 'global'"

    # Funding facts
    funding_rows = await conn.fetch(
        f"""
        SELECT entity_name, fact_value
        FROM news_entity_facts
        WHERE fact_key = 'funding_amount'
          AND is_current = TRUE
          AND first_seen_at >= $1 AND first_seen_at <= $2
          AND {region_filter}
        """,
        start_date,
        end_date + timedelta(days=1),
    )

    # New entities this period
    new_entity_count = await conn.fetchval(
        f"""
        SELECT COUNT(DISTINCT entity_name)
        FROM news_entity_facts
        WHERE first_seen_at >= $1 AND first_seen_at <= $2
          AND {region_filter}
        """,
        start_date,
        end_date + timedelta(days=1),
    ) or 0

    # Parse funding amounts
    total_funding = 0.0
    for row in funding_rows:
        val = row["fact_value"]
        try:
            if val.endswith("B"):
                total_funding += float(val.lstrip("$").rstrip("B")) * 1_000_000_000
            elif val.endswith("M"):
                total_funding += float(val.lstrip("$").rstrip("M")) * 1_000_000
            elif val.endswith("K"):
                total_funding += float(val.lstrip("$").rstrip("K")) * 1_000
        except (ValueError, AttributeError):
            pass

    return {
        "funding_total_usd": total_funding,
        "funding_deal_count": len(funding_rows),
        "new_entities_count": new_entity_count,
    }


# ---------------------------------------------------------------------------
# Stats builder
# ---------------------------------------------------------------------------

def _build_stats(
    clusters: Sequence[Dict[str, Any]],
    topics: Sequence[Dict[str, Any]],
    entity_facts: Dict[str, Any],
    period_type: str,
    region: str,
) -> Dict[str, Any]:
    """Build template stats JSON for a periodic brief."""
    # Top stories
    top_stories = []
    for c in clusters[:10]:
        entry: Dict[str, Any] = {
            "title": c["title"],
            "summary": c.get("llm_summary") or c.get("summary") or "",
            "story_type": c.get("story_type", "news"),
            "rank_score": float(c.get("rank_score") or 0),
            "entities": list(c.get("entities") or []),
            "builder_takeaway": c.get("builder_takeaway") or "",
        }
        if c.get("id"):
            entry["cluster_id"] = str(c["id"])
        top_stories.append(entry)

    # Top topics
    top_topics = [
        {"topic": t["topic"], "count": int(t["cluster_count"])}
        for t in topics[:10]
    ]

    # Story type distribution
    type_counts: Dict[str, int] = {}
    for c in clusters:
        st = c.get("story_type", "news")
        type_counts[st] = type_counts.get(st, 0) + 1

    # Impact frame distribution
    frame_counts: Dict[str, int] = {}
    for c in clusters:
        impact = c.get("impact")
        if isinstance(impact, dict) and impact.get("frame"):
            frame = str(impact["frame"])
            frame_counts[frame] = frame_counts.get(frame, 0) + 1
        elif isinstance(impact, str):
            try:
                parsed = json.loads(impact)
                if isinstance(parsed, dict) and parsed.get("frame"):
                    frame = str(parsed["frame"])
                    frame_counts[frame] = frame_counts.get(frame, 0) + 1
            except (json.JSONDecodeError, TypeError):
                pass

    result: Dict[str, Any] = {
        "total_stories": len(clusters),
        "top_stories": top_stories,
        "top_topics": top_topics,
        "story_types": type_counts,
        "funding_total_usd": entity_facts.get("funding_total_usd", 0),
        "funding_deal_count": entity_facts.get("funding_deal_count", 0),
        "new_entities_count": entity_facts.get("new_entities_count", 0),
    }
    if frame_counts:
        result["frame_distribution"] = frame_counts
    return result


# ---------------------------------------------------------------------------
# LLM narrative generation
# ---------------------------------------------------------------------------

async def _generate_narrative(
    client: Any,
    stats: Dict[str, Any],
    clusters: Sequence[Dict[str, Any]],
    period_type: str,
    region: str,
    period_start: date,
    period_end: date,
) -> Dict[str, Any]:
    """Generate LLM narrative sections for the brief."""
    if not client:
        return {}

    # Prepare cluster summaries for the prompt
    cluster_summaries = []
    for c in clusters[:15]:
        summary = c.get("llm_summary") or c.get("summary") or ""
        takeaway = c.get("builder_takeaway") or ""
        entities = ", ".join(c.get("entities") or [])
        cluster_summaries.append(
            f"- [{c.get('story_type', 'news')}] {c['title']}"
            + (f"\n  Summary: {summary}" if summary else "")
            + (f"\n  Builder insight: {takeaway}" if takeaway else "")
            + (f"\n  Entities: {entities}" if entities else "")
        )

    stories_text = "\n".join(cluster_summaries)

    region_label = "Türkiye yapay zeka ve girişim ekosistemi" if region == "turkey" else "global AI/startup landscape"
    period_label = "week" if period_type == "weekly" else "month"
    date_range = f"{period_start.isoformat()} to {period_end.isoformat()}"

    lang_instruction = (
        "\n\nIMPORTANT: Write ALL output values (executive_summary, trend_analysis, "
        "builder_lessons, outlook) in Turkish (Türkçe). "
        "Use native Turkish phrasing, not machine-translated English. JSON keys stay in English."
    ) if region == "turkey" else ""

    prompt = (
        f"You are a senior technology correspondent writing a {period_label}ly intelligence brief "
        f"about the {region_label} for startup builders and investors. "
        f"Period: {date_range}. "
        f"Total stories: {stats.get('total_stories', 0)}. "
        f"Funding tracked: ${stats.get('funding_total_usd', 0):,.0f} across "
        f"{stats.get('funding_deal_count', 0)} deals.\n\n"
        f"TOP STORIES THIS {period_label.upper()}:\n{stories_text}\n\n"
        + (
            f"TOP IMPACT FRAMES: {json.dumps(stats['frame_distribution'])}\n"
            if stats.get("frame_distribution") else ""
        )
        + (
            f"RISING FRAMES (vs prior {period_label}): {json.dumps(stats['rising_frames'])}\n\n"
            if stats.get("rising_frames") else ""
        )
        + "Return strict JSON with keys:\n"
        '- "executive_summary": 2-3 sentence overview of the most significant developments (<=300 chars)\n'
        '- "trend_analysis": paragraph identifying patterns, shifts, or emerging themes (<=500 chars)\n'
        '- "builder_lessons": array of 3-5 actionable takeaways for builders (each <=120 chars)\n'
        f'- "outlook": what to watch next {period_label} (<=200 chars)\n'
        "Be concrete, cite specifics. No prose outside JSON."
        + lang_instruction
    )

    model = os.getenv("NEWS_BRIEF_MODEL") or os.getenv("NEWS_LLM_MODEL", "gpt-5-nano")

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            **llm_kwargs(model, max_tokens=800 if period_type == "weekly" else 1200, temperature=0.4),
            response_format={"type": "json_object"},
        )
        text = response.choices[0].message.content or "{}"
        return json.loads(text)
    except Exception as exc:
        logger.warning("LLM narrative generation failed: %s", exc)
        return {}


# ---------------------------------------------------------------------------
# Brief generators
# ---------------------------------------------------------------------------

class WeeklyBriefGenerator:
    """Generates weekly intelligence briefs."""

    async def run(
        self,
        conn: asyncpg.Connection,
        *,
        region: str = "global",
        week_start: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Generate a weekly brief.

        Args:
            region: 'global' or 'turkey'
            week_start: Monday of the target week. Defaults to last Monday.
        """
        if not week_start:
            today = date.today()
            week_start = today - timedelta(days=today.weekday() + 7)  # Previous Monday

        week_end = week_start + timedelta(days=6)  # Sunday
        logger.info("Generating weekly brief: %s to %s (region=%s)", week_start, week_end, region)

        # Load data
        clusters = await _load_period_clusters(conn, region, week_start, week_end, limit=50)
        topics = await _load_period_topics(conn, region, week_start, week_end)
        entity_facts = await _load_period_entity_facts(conn, region, week_start, week_end)

        if not clusters:
            logger.warning("No clusters found for weekly brief %s-%s (%s)", week_start, week_end, region)
            return {"status": "empty", "story_count": 0}

        # Build stats
        stats = _build_stats(clusters, topics, entity_facts, "weekly", region)

        # Rising frames: compare to prior week
        prior_week_start = week_start - timedelta(days=7)
        try:
            prior_stats_row = await conn.fetchval(
                """
                SELECT stats_json->>'frame_distribution'
                FROM news_periodic_briefs
                WHERE region = $1 AND period_type = 'weekly' AND period_start = $2
                  AND status = 'ready'
                """,
                region,
                prior_week_start,
            )
            if prior_stats_row:
                prior_frames = json.loads(prior_stats_row) if isinstance(prior_stats_row, str) else {}
                current_frames = stats.get("frame_distribution", {})
                if current_frames:
                    deltas = {
                        f: current_frames.get(f, 0) - prior_frames.get(f, 0)
                        for f in set(list(current_frames.keys()) + list(prior_frames.keys()))
                    }
                    rising = sorted(deltas.items(), key=lambda x: x[1], reverse=True)[:5]
                    stats["rising_frames"] = [{"frame": f, "delta": d} for f, d in rising if d != 0]
        except Exception:
            pass  # Non-critical; skip rising frames on error

        # Generate LLM narrative
        client = await _get_llm_client()
        narrative = await _generate_narrative(
            client, stats, clusters, "weekly", region, week_start, week_end,
        )

        region_label = "Turkey" if region == "turkey" else "Global"
        title = f"{region_label} Weekly Intelligence Brief — {week_start.strftime('%b %d')}-{week_end.strftime('%d, %Y')}"

        # Top entity names for reference
        entity_names: List[str] = []
        seen_entities: set = set()
        for c in clusters[:20]:
            for e in (c.get("entities") or []):
                e_lower = e.lower()
                if e_lower not in seen_entities:
                    seen_entities.add(e_lower)
                    entity_names.append(e)

        # Top cluster IDs
        cluster_ids = [c["id"] for c in clusters[:20]]

        # Persist to database
        brief_id = await conn.fetchval(
            """
            INSERT INTO news_periodic_briefs (
                region, period_type, period_start, period_end,
                title, stats_json, narrative_json,
                top_cluster_ids, top_entity_names, story_count,
                status, generated_at, updated_at
            ) VALUES ($1, 'weekly', $2, $3, $4, $5::jsonb, $6::jsonb,
                      $7::uuid[], $8::text[], $9, 'ready', NOW(), NOW())
            ON CONFLICT (region, period_type, period_start) DO UPDATE
            SET title = EXCLUDED.title,
                stats_json = EXCLUDED.stats_json,
                narrative_json = EXCLUDED.narrative_json,
                top_cluster_ids = EXCLUDED.top_cluster_ids,
                top_entity_names = EXCLUDED.top_entity_names,
                story_count = EXCLUDED.story_count,
                status = 'ready',
                updated_at = NOW()
            RETURNING id::text
            """,
            region,
            week_start,
            week_end,
            title,
            json.dumps(stats),
            json.dumps(narrative),
            cluster_ids,
            entity_names[:30],
            len(clusters),
        )

        return {
            "brief_id": brief_id,
            "title": title,
            "period_start": week_start.isoformat(),
            "period_end": week_end.isoformat(),
            "story_count": len(clusters),
            "has_narrative": bool(narrative),
            "status": "ready",
        }


class MonthlyBriefGenerator:
    """Generates monthly intelligence briefs."""

    async def run(
        self,
        conn: asyncpg.Connection,
        *,
        region: str = "global",
        month: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate a monthly brief.

        Args:
            region: 'global' or 'turkey'
            month: 'YYYY-MM' format. Defaults to previous month.
        """
        if month:
            year, mon = int(month[:4]), int(month[5:7])
        else:
            today = date.today()
            first_of_current = today.replace(day=1)
            last_month = first_of_current - timedelta(days=1)
            year, mon = last_month.year, last_month.month

        month_start = date(year, mon, 1)
        # Last day of month
        if mon == 12:
            month_end = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            month_end = date(year, mon + 1, 1) - timedelta(days=1)

        logger.info("Generating monthly brief: %s to %s (region=%s)", month_start, month_end, region)

        # Load data
        clusters = await _load_period_clusters(conn, region, month_start, month_end, limit=100)
        topics = await _load_period_topics(conn, region, month_start, month_end)
        entity_facts = await _load_period_entity_facts(conn, region, month_start, month_end)

        if not clusters:
            logger.warning("No clusters found for monthly brief %s (%s)", month_start.strftime("%Y-%m"), region)
            return {"status": "empty", "story_count": 0}

        # Build stats
        stats = _build_stats(clusters, topics, entity_facts, "monthly", region)

        # Add weekly comparison if weekly briefs exist
        weekly_rows = await conn.fetch(
            """
            SELECT period_start, stats_json->>'total_stories' AS story_count
            FROM news_periodic_briefs
            WHERE region = $1 AND period_type = 'weekly'
              AND period_start >= $2 AND period_end <= $3
              AND status = 'ready'
            ORDER BY period_start
            """,
            region,
            month_start,
            month_end,
        )
        if weekly_rows:
            stats["weekly_breakdown"] = [
                {
                    "week_start": row["period_start"].isoformat(),
                    "story_count": int(row["story_count"] or 0),
                }
                for row in weekly_rows
            ]

        # Rising frames: compare to prior month
        if mon == 1:
            prior_month_start = date(year - 1, 12, 1)
        else:
            prior_month_start = date(year, mon - 1, 1)
        try:
            prior_stats_row = await conn.fetchval(
                """
                SELECT stats_json->>'frame_distribution'
                FROM news_periodic_briefs
                WHERE region = $1 AND period_type = 'monthly' AND period_start = $2
                  AND status = 'ready'
                """,
                region,
                prior_month_start,
            )
            if prior_stats_row:
                prior_frames = json.loads(prior_stats_row) if isinstance(prior_stats_row, str) else {}
                current_frames = stats.get("frame_distribution", {})
                if current_frames:
                    deltas = {
                        f: current_frames.get(f, 0) - prior_frames.get(f, 0)
                        for f in set(list(current_frames.keys()) + list(prior_frames.keys()))
                    }
                    rising = sorted(deltas.items(), key=lambda x: x[1], reverse=True)[:5]
                    stats["rising_frames"] = [{"frame": f, "delta": d} for f, d in rising if d != 0]
        except Exception:
            pass  # Non-critical

        # Generate LLM narrative
        client = await _get_llm_client()
        narrative = await _generate_narrative(
            client, stats, clusters, "monthly", region, month_start, month_end,
        )

        region_label = "Turkey" if region == "turkey" else "Global"
        title = f"{region_label} Monthly Intelligence Brief — {month_start.strftime('%B %Y')}"

        # Top entity names
        entity_names: List[str] = []
        seen_entities: set = set()
        for c in clusters[:30]:
            for e in (c.get("entities") or []):
                e_lower = e.lower()
                if e_lower not in seen_entities:
                    seen_entities.add(e_lower)
                    entity_names.append(e)

        cluster_ids = [c["id"] for c in clusters[:30]]

        # Persist
        brief_id = await conn.fetchval(
            """
            INSERT INTO news_periodic_briefs (
                region, period_type, period_start, period_end,
                title, stats_json, narrative_json,
                top_cluster_ids, top_entity_names, story_count,
                status, generated_at, updated_at
            ) VALUES ($1, 'monthly', $2, $3, $4, $5::jsonb, $6::jsonb,
                      $7::uuid[], $8::text[], $9, 'ready', NOW(), NOW())
            ON CONFLICT (region, period_type, period_start) DO UPDATE
            SET title = EXCLUDED.title,
                stats_json = EXCLUDED.stats_json,
                narrative_json = EXCLUDED.narrative_json,
                top_cluster_ids = EXCLUDED.top_cluster_ids,
                top_entity_names = EXCLUDED.top_entity_names,
                story_count = EXCLUDED.story_count,
                status = 'ready',
                updated_at = NOW()
            RETURNING id::text
            """,
            region,
            month_start,
            month_end,
            title,
            json.dumps(stats),
            json.dumps(narrative),
            cluster_ids,
            entity_names[:50],
            len(clusters),
        )

        return {
            "brief_id": brief_id,
            "title": title,
            "period_start": month_start.isoformat(),
            "period_end": month_end.isoformat(),
            "story_count": len(clusters),
            "has_narrative": bool(narrative),
            "status": "ready",
        }
