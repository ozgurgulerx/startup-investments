"""Daily startup news digest email sender."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

try:
    import asyncpg
except Exception:  # pragma: no cover - optional import at module import time
    asyncpg = None


@dataclass
class DigestStory:
    title: str
    summary: str
    builder_takeaway: str
    url: str
    source: str
    cluster_id: str = ""
    signal_tags: List[str] = field(default_factory=list)


@dataclass
class Subscriber:
    id: str
    email: str
    unsubscribe_token: str
    timezone: str = "Europe/Istanbul"


@dataclass
class DailyBrief:
    headline: str
    summary: str
    bullets: List[str]


class DailyNewsDigestSender:
    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or os.getenv("DATABASE_URL")
        if not self.database_url:
            raise RuntimeError("DATABASE_URL is required for digest sending")
        if asyncpg is None:
            raise RuntimeError("asyncpg is required for digest sending")

        self.pool: Optional[asyncpg.Pool] = None
        self.resend_api_key = os.getenv("RESEND_API_KEY", "")
        self.from_email = os.getenv("NEWS_DIGEST_FROM_EMAIL", "Build Atlas <news@buildatlas.net>")
        self.reply_to = os.getenv("NEWS_DIGEST_REPLY_TO", "").strip()
        self.public_base_url = os.getenv("PUBLIC_BASE_URL", "https://buildatlas.net").rstrip("/")
        self.max_items = max(3, int(os.getenv("NEWS_DIGEST_MAX_ITEMS", "10")))
        self.dry_run = os.getenv("NEWS_DIGEST_DRY_RUN", "false").strip().lower() == "true"

        # Signal intelligence feature
        self.signals_enabled = os.getenv("NEWS_DIGEST_SIGNALS_ENABLED", "true").lower() == "true"
        self.max_signals = max(3, int(os.getenv("NEWS_DIGEST_MAX_SIGNALS", "5")))
        self._azure_client: Any = None
        self._azure_model_name: Optional[str] = None
        if self.signals_enabled:
            self._init_azure_client()

    async def connect(self) -> None:
        if self.pool is None:
            self.pool = await asyncpg.create_pool(self.database_url, min_size=1, max_size=4)

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    def _init_azure_client(self) -> None:
        """Lazy-init Azure OpenAI client for signal narrative generation."""
        try:
            from openai import AsyncAzureOpenAI
        except ImportError:
            return
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
        if not endpoint:
            return
        self._azure_model_name = (
            os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
            or os.getenv("AZURE_OPENAI_FAST_DEPLOYMENT_NAME")
            or "gpt-5-nano"
        )
        try:
            from azure.identity import DefaultAzureCredential, get_bearer_token_provider
            _credential = DefaultAzureCredential()
            _token_provider = get_bearer_token_provider(
                _credential, "https://cognitiveservices.azure.com/.default"
            )
            self._azure_client = AsyncAzureOpenAI(
                azure_ad_token_provider=_token_provider,
                api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01"),
                azure_endpoint=endpoint,
            )
        except ImportError:
            api_key = os.getenv("AZURE_OPENAI_API_KEY", "")
            if api_key:
                self._azure_client = AsyncAzureOpenAI(
                    api_key=api_key,
                    api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01"),
                    azure_endpoint=endpoint,
                )

    async def _resolve_edition_date(self, conn: asyncpg.Connection, edition_date: Optional[str], *, region: str) -> date:
        if edition_date:
            # asyncpg expects Python date objects for DATE parameters.
            return datetime.strptime(edition_date, "%Y-%m-%d").date()
        row = await conn.fetchrow(
            """
            SELECT edition_date
            FROM news_daily_editions
            WHERE status = 'ready' AND region = $1
            ORDER BY edition_date DESC
            LIMIT 1
            """
            ,
            region,
        )
        if not row:
            raise RuntimeError("No ready news edition found")
        value = row["edition_date"]
        if isinstance(value, date):
            return value
        return datetime.strptime(str(value), "%Y-%m-%d").date()

    async def _load_brief(self, conn: asyncpg.Connection, edition_date: date, *, region: str) -> Optional[DailyBrief]:
        """Load the daily brief from the edition's stats_json."""
        row = await conn.fetchrow(
            "SELECT stats_json FROM news_daily_editions WHERE edition_date = $1::date AND region = $2",
            edition_date, region,
        )
        if not row or not row["stats_json"]:
            return None
        stats = json.loads(row["stats_json"]) if isinstance(row["stats_json"], str) else row["stats_json"]
        brief = stats.get("daily_brief")
        if not brief or not brief.get("headline"):
            return None
        return DailyBrief(
            headline=str(brief["headline"]),
            summary=str(brief.get("summary", "")),
            bullets=[str(b) for b in brief.get("bullets", [])],
        )

    async def _load_stories(self, conn: asyncpg.Connection, edition_date: date, *, region: str) -> List[DigestStory]:
        rows = await conn.fetch(
            """
            WITH ordered AS (
              SELECT u.cluster_id, u.ord
              FROM news_daily_editions e,
              unnest(e.top_cluster_ids) WITH ORDINALITY AS u(cluster_id, ord)
              WHERE e.edition_date = $1::date AND e.region = $2
            )
            SELECT
              c.id::text AS cluster_id,
              c.title,
              COALESCE(c.llm_summary, c.summary, '') AS summary,
              COALESCE(c.builder_takeaway, '') AS builder_takeaway,
              COALESCE(MAX(CASE WHEN nci.is_primary THEN nir.url END), c.canonical_url) AS primary_url,
              COALESCE(MAX(CASE WHEN nci.is_primary THEN ns.display_name END), 'Unknown') AS primary_source
            FROM ordered o
            JOIN news_clusters c ON c.id = o.cluster_id
            LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
            LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
            LEFT JOIN news_sources ns ON ns.id = nir.source_id
            GROUP BY c.id, o.ord
            ORDER BY o.ord ASC
            LIMIT $3
            """,
            edition_date,
            region,
            self.max_items,
        )

        stories: List[DigestStory] = []
        for row in rows:
            stories.append(
                DigestStory(
                    title=str(row["title"] or "").strip(),
                    summary=str(row["summary"] or "").strip(),
                    builder_takeaway=str(row["builder_takeaway"] or "").strip(),
                    url=str(row["primary_url"] or "").strip(),
                    source=str(row["primary_source"] or "Unknown").strip(),
                    cluster_id=str(row["cluster_id"] or ""),
                )
            )
        return stories

    async def _load_subscribers(self, conn: asyncpg.Connection, *, region: str = "global") -> List[Subscriber]:
        rows = await conn.fetch(
            """
            SELECT id::text AS id, email, unsubscribe_token::text AS unsubscribe_token,
                   COALESCE(timezone, 'Europe/Istanbul') AS timezone
            FROM news_email_subscriptions
            WHERE status = 'active' AND region = $1
            ORDER BY created_at ASC
            """,
            region,
        )
        return [
            Subscriber(
                id=str(row["id"]),
                email=str(row["email"]),
                unsubscribe_token=str(row["unsubscribe_token"]),
                timezone=str(row["timezone"] or "Europe/Istanbul"),
            )
            for row in rows
        ]

    async def _find_cross_region_subs(
        self, conn: asyncpg.Connection, subscribers: List[Subscriber], *, region: str
    ) -> Dict[str, str]:
        """Return {email_normalized: other-region subscription_id} for cross-region subs."""
        other_region = "turkey" if region == "global" else "global"
        emails = [s.email.strip().lower() for s in subscribers]
        if not emails:
            return {}
        rows = await conn.fetch(
            "SELECT id::text, email_normalized FROM news_email_subscriptions "
            "WHERE email_normalized = ANY($1) AND region = $2 AND status = 'active'",
            emails, other_region,
        )
        return {str(r["email_normalized"]): str(r["id"]) for r in rows}

    @staticmethod
    def _filter_by_local_hour(
        subscribers: List[Subscriber],
        *,
        target_hour: int,
        target_minute: int,
        now_utc: datetime,
    ) -> List[Subscriber]:
        """Keep only subscribers whose local time is in the target hour.

        Uses a window: if target is 08:45, we accept local times from 08:00
        to 08:59 so that hourly cron runs at :45 always catch every timezone.
        """
        result = []
        for sub in subscribers:
            try:
                tz = ZoneInfo(sub.timezone)
            except (KeyError, Exception):
                # Unknown timezone — fall back to Istanbul
                tz = ZoneInfo("Europe/Istanbul")
            local_now = now_utc.astimezone(tz)
            if local_now.hour == target_hour:
                result.append(sub)
        return result

    @staticmethod
    def _news_url(base: str, edition_date: str, region: str = "global") -> str:
        if region == "turkey":
            return f"{base}/news/turkey/{edition_date}"
        return f"{base}/news/{edition_date}"

    def _build_story_rows_html(self, stories: List[DigestStory], edition_date: str, region: str = "global") -> str:
        blocks = []
        for idx, story in enumerate(stories, start=1):
            summary = story.summary or "Signal captured in today's startup radar."
            takeaway = story.builder_takeaway or "Validate the signal with customer evidence before acting."
            url = story.url or self._news_url(self.public_base_url, edition_date, region)
            signal_tags_html = ""
            if story.signal_tags:
                tags_text = ", ".join(story.signal_tags)
                signal_tags_html = (
                    f'<div style="margin-top:6px;font-size:11px;color:#6366f1;">'
                    f"Signals: {tags_text}</div>"
                )
            blocks.append(
                f"""<tr>
                  <td style="padding:16px 0;border-bottom:1px solid #e5e7eb;">
                    <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;">#{idx} · {story.source}</div>
                    <a href="{url}" style="display:block;margin-top:4px;font-size:18px;line-height:1.35;color:#111827;text-decoration:none;font-weight:600;">{story.title}</a>
                    <div style="margin-top:8px;font-size:14px;line-height:1.55;color:#374151;">{summary}</div>
                    <div style="margin-top:8px;padding:8px 10px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;font-size:12px;line-height:1.45;color:#9a3412;">
                      Builder view: {takeaway}
                    </div>
                    {signal_tags_html}
                  </td>
                </tr>"""
            )
        return "\n".join(blocks)

    @staticmethod
    def _build_brief_html(brief: DailyBrief, *, label: str = "TODAY'S BRIEF") -> str:
        bullets_html = "".join(
            f'<li style="margin-bottom:4px;">{b}</li>' for b in brief.bullets
        )
        return f"""<tr>
                  <td style="padding:16px 0;border-bottom:1px solid #e5e7eb;">
                    <div style="font-size:11px;color:#f59e0b;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">{label}</div>
                    <div style="margin-top:6px;font-size:18px;line-height:1.35;color:#0f172a;font-weight:600;">{brief.headline}</div>
                    <div style="margin-top:6px;font-size:14px;line-height:1.55;color:#374151;">{brief.summary}</div>
                    <ul style="margin:8px 0 0 0;padding-left:18px;font-size:13px;line-height:1.55;color:#374151;">{bullets_html}</ul>
                  </td>
                </tr>"""

    @staticmethod
    def _build_signal_radar_html(signal_context: Any) -> str:
        """Render the Signal Radar section as HTML table rows."""
        from src.automation.digest_signals import DigestSignalContext
        if not signal_context or not isinstance(signal_context, DigestSignalContext):
            return ""
        if not signal_context.top_signals:
            return ""

        STATUS_COLORS = {
            "emerging": "#10b981",       # green
            "accelerating": "#f59e0b",   # amber
        }

        # Narrative paragraph
        narrative_html = ""
        if signal_context.narrative:
            narrative_html = (
                f'<div style="margin-top:8px;font-size:14px;line-height:1.55;color:#374151;">'
                f'{signal_context.narrative}</div>'
            )

        # Signal cards
        cards: List[str] = []
        for sig in signal_context.top_signals:
            color = STATUS_COLORS.get(sig.status, "#6b7280")
            badge = (
                f'<span style="display:inline-block;padding:2px 8px;border-radius:4px;'
                f'background:{color};color:#fff;font-size:10px;text-transform:uppercase;'
                f'letter-spacing:0.05em;font-weight:600;">{sig.status}</span>'
            )
            scorecard = (
                f'<span style="font-size:11px;color:#6b7280;">'
                f'Momentum {sig.momentum:.2f} · Conviction {sig.conviction:.2f} · '
                f'{sig.unique_company_count} companies</span>'
            )
            transition_html = ""
            if sig.lifecycle_transition:
                transition_html = (
                    f'<div style="margin-top:4px;font-size:11px;color:#8b5cf6;font-style:italic;">'
                    f'Newly {sig.status} — was {sig.lifecycle_transition.split(" → ")[0] if " → " in sig.lifecycle_transition else "?"} '
                    f'{sig.transition_recency or ""}</div>'
                )
            cards.append(
                f'<div style="margin-top:10px;padding:10px 12px;background:#f5f3ff;'
                f'border:1px solid #ddd6fe;border-radius:8px;">'
                f'{badge}'
                f'<div style="margin-top:6px;font-size:14px;font-weight:600;color:#1e1b4b;">{sig.claim}</div>'
                f'<div style="margin-top:4px;">{scorecard}</div>'
                f'{transition_html}'
                f'</div>'
            )

        cards_html = "\n".join(cards)
        return f"""<tr>
                  <td style="padding:20px 0 4px 0;border-bottom:1px solid #e5e7eb;">
                    <div style="font-size:11px;color:#8b5cf6;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">SIGNAL RADAR</div>
                    {narrative_html}
                    {cards_html}
                  </td>
                </tr>"""

    def _build_email_html(
        self,
        *,
        edition_date: str,
        stories: List[DigestStory],
        unsubscribe_url: str,
        brief: Optional[DailyBrief] = None,
        turkey_brief: Optional[DailyBrief] = None,
        turkey_stories: Optional[List[DigestStory]] = None,
        region: str = "global",
        signal_context: Any = None,
        turkey_signal_context: Any = None,
    ) -> str:
        # --- Brief section ---
        brief_html = ""
        if brief:
            brief_html = self._build_brief_html(brief)

        # --- Signal Radar section ---
        signal_radar_html = self._build_signal_radar_html(signal_context)

        # --- Primary stories ---
        stories_label = "TOP SİNYALLER" if region == "turkey" else "TOP SIGNALS"
        stories_html = self._build_story_rows_html(stories, edition_date, region)
        if stories_html:
            stories_html = f"""<tr>
                  <td style="padding:20px 0 4px 0;">
                    <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">{stories_label}</div>
                  </td>
                </tr>
                {stories_html}"""
        else:
            stories_html = "<tr><td>No stories found for this edition.</td></tr>"

        # --- Turkey section (cross-region subscribers only) ---
        turkey_section_html = ""
        if turkey_stories:
            turkey_brief_html = ""
            if turkey_brief:
                turkey_brief_html = self._build_brief_html(turkey_brief, label="GÜNÜN ÖZETİ")
            turkey_signal_radar_html = self._build_signal_radar_html(turkey_signal_context)
            turkey_stories_html = self._build_story_rows_html(turkey_stories, edition_date, "turkey")
            turkey_stories_block = ""
            if turkey_stories_html:
                turkey_stories_block = f"""<tr>
                  <td style="padding:12px 0 4px 0;">
                    <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">TOP SİNYALLER</div>
                  </td>
                </tr>
                {turkey_stories_html}"""
            turkey_section_html = f"""<tr>
                  <td style="padding:24px 0 0 0;border-top:2px solid #e5e7eb;">
                    <div style="font-size:12px;color:#f59e0b;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">&#x1F1F9;&#x1F1F7; TÜRKİYE EKOSİSTEMİ</div>
                  </td>
                </tr>
                {turkey_brief_html}
                {turkey_signal_radar_html}
                {turkey_stories_block}"""

        # --- Subject line title ---
        title = "Turkey Signal Feed" if region == "turkey" else "Daily Startup Digest"

        return f"""
        <html>
          <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td align="center">
                  <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
                    <tr>
                      <td>
                        <div style="font-size:12px;color:#f59e0b;text-transform:uppercase;letter-spacing:0.08em;">Build Atlas</div>
                        <h1 style="margin:8px 0 4px 0;font-size:28px;line-height:1.2;color:#0f172a;">{title}</h1>
                        <div style="font-size:14px;color:#475569;">Edition {edition_date} · ranked by cross-source popularity</div>
                      </td>
                    </tr>
                    {brief_html}
                    {signal_radar_html}
                    {stories_html}
                    {turkey_section_html}
                    <tr>
                      <td style="padding-top:16px;font-size:13px;color:#6b7280;">
                        Open full radar: <a href="{self._news_url(self.public_base_url, edition_date, region)}">{self._news_url(self.public_base_url, edition_date, region)}</a>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top:8px;font-size:11px;color:#94a3b8;">
                        Feedback / support: <a href="mailto:support@graph-atlas.com" style="color:#94a3b8;">support@graph-atlas.com</a> &middot; <a href="{self.public_base_url}/support" style="color:#94a3b8;">{self.public_base_url}/support</a>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top:6px;font-size:12px;color:#94a3b8;">
                        You're receiving this because you subscribed on Build Atlas.
                        <a href="{unsubscribe_url}">Unsubscribe</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
        """

    @staticmethod
    def _build_brief_text(brief: DailyBrief, *, label: str = "TODAY'S BRIEF") -> List[str]:
        lines = [label, brief.headline, brief.summary]
        for b in brief.bullets:
            lines.append(f"  • {b}")
        lines.append("")
        return lines

    @staticmethod
    def _build_stories_text(stories: List[DigestStory], public_base_url: str, edition_date: str, region: str = "global") -> List[str]:
        lines: List[str] = []
        for idx, story in enumerate(stories, start=1):
            fallback = f"{public_base_url}/news/turkey/{edition_date}" if region == "turkey" else f"{public_base_url}/news/{edition_date}"
            url = story.url or fallback
            summary = story.summary or "Signal captured in today's radar."
            builder_takeaway = story.builder_takeaway or "Validate with user pull before acting."
            lines.extend([
                f"{idx}. {story.title}",
                f"   Source: {story.source}",
                f"   Summary: {summary}",
                f"   Builder view: {builder_takeaway}",
                f"   Link: {url}",
            ])
            if story.signal_tags:
                lines.append(f"   Signals: {', '.join(story.signal_tags)}")
            lines.append("")
        return lines

    @staticmethod
    def _build_signal_radar_text(signal_context: Any) -> List[str]:
        """Render the Signal Radar section as plain text."""
        from src.automation.digest_signals import DigestSignalContext
        if not signal_context or not isinstance(signal_context, DigestSignalContext):
            return []
        if not signal_context.top_signals:
            return []

        lines = ["SIGNAL RADAR", ""]
        if signal_context.narrative:
            lines.append(signal_context.narrative)
            lines.append("")
        for sig in signal_context.top_signals:
            transition_note = ""
            if sig.lifecycle_transition:
                transition_note = f" (was {sig.lifecycle_transition.split(' → ')[0] if ' → ' in sig.lifecycle_transition else '?'} {sig.transition_recency or ''})"
            lines.append(
                f"  [{sig.status.upper()}] {sig.claim}"
                f"  — momentum={sig.momentum:.2f}, conviction={sig.conviction:.2f}, "
                f"{sig.unique_company_count} companies{transition_note}"
            )
        lines.append("")
        return lines

    def _build_email_text(
        self,
        *,
        edition_date: str,
        stories: List[DigestStory],
        unsubscribe_url: str,
        brief: Optional[DailyBrief] = None,
        turkey_brief: Optional[DailyBrief] = None,
        turkey_stories: Optional[List[DigestStory]] = None,
        region: str = "global",
        signal_context: Any = None,
        turkey_signal_context: Any = None,
    ) -> str:
        title = "Turkey Signal Feed" if region == "turkey" else "Daily Startup Digest"
        lines = [
            f"Build Atlas {title} ({edition_date})",
            "",
        ]

        if brief:
            lines.extend(self._build_brief_text(brief))

        lines.extend(self._build_signal_radar_text(signal_context))

        lines.append("Top stories ranked by popularity and source corroboration:")
        lines.append("")
        lines.extend(self._build_stories_text(stories, self.public_base_url, edition_date, region))

        if turkey_stories:
            lines.extend(["---", "", "TURKEY ECOSYSTEM", ""])
            if turkey_brief:
                lines.extend(self._build_brief_text(turkey_brief, label="GÜNÜN ÖZETİ"))
            lines.extend(self._build_signal_radar_text(turkey_signal_context))
            lines.extend(self._build_stories_text(turkey_stories, self.public_base_url, edition_date, "turkey"))

        lines.extend([
            f"Full radar: {self._news_url(self.public_base_url, edition_date, region)}",
            "",
            f"Feedback / support: support@graph-atlas.com · {self.public_base_url}/support",
            "",
            f"Unsubscribe: {unsubscribe_url}",
        ])
        return "\n".join(lines)

    async def _record_delivery(
        self,
        conn: asyncpg.Connection,
        *,
        edition_date: date,
        subscriber_id: str,
        status: str,
        provider_message_id: Optional[str] = None,
        error_text: Optional[str] = None,
    ) -> None:
        await conn.execute(
            """
            INSERT INTO news_digest_deliveries (
              edition_date, subscription_id, status, provider_message_id, error_text, sent_at
            )
            VALUES ($1::date, $2::uuid, $3, $4, $5, NOW())
            ON CONFLICT (edition_date, subscription_id) DO UPDATE
            SET status = EXCLUDED.status,
                provider_message_id = EXCLUDED.provider_message_id,
                error_text = EXCLUDED.error_text,
                sent_at = NOW()
            """,
            edition_date,
            subscriber_id,
            status,
            provider_message_id,
            error_text,
        )

    async def _send_one(
        self,
        client: httpx.AsyncClient,
        conn: asyncpg.Connection,
        *,
        subscriber: Subscriber,
        resolved_date: date,
        resolved_date_str: str,
        stories: List[DigestStory],
        brief: Optional[DailyBrief],
        region: str,
        turkey_brief: Optional[DailyBrief] = None,
        turkey_stories: Optional[List[DigestStory]] = None,
        turkey_sub_id: Optional[str] = None,
        signal_context: Any = None,
        turkey_signal_context: Any = None,
    ) -> str:
        """Send one email. Returns 'sent', 'failed', or 'skipped'."""
        unsubscribe_url = (
            f"{self.public_base_url}/api/news/subscriptions"
            f"?token={subscriber.unsubscribe_token}"
        )
        html = self._build_email_html(
            edition_date=resolved_date_str,
            stories=stories,
            unsubscribe_url=unsubscribe_url,
            brief=brief,
            turkey_brief=turkey_brief,
            turkey_stories=turkey_stories,
            region=region,
            signal_context=signal_context,
            turkey_signal_context=turkey_signal_context,
        )
        text = self._build_email_text(
            edition_date=resolved_date_str,
            stories=stories,
            unsubscribe_url=unsubscribe_url,
            brief=brief,
            turkey_brief=turkey_brief,
            turkey_stories=turkey_stories,
            region=region,
            signal_context=signal_context,
            turkey_signal_context=turkey_signal_context,
        )
        try:
            subject_label = "Turkey Signal Feed" if region == "turkey" else "Daily Startup Digest"
            payload: Dict[str, Any] = {
                "from": self.from_email,
                "to": [subscriber.email],
                "subject": f"Build Atlas {subject_label} — {resolved_date_str}",
                "html": html,
                "text": text,
            }
            if self.reply_to:
                payload["reply_to"] = self.reply_to

            response = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {self.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if response.status_code >= 400:
                body_text = ""
                try:
                    body_text = (await response.aread()).decode("utf-8", errors="ignore")
                except Exception:
                    body_text = ""
                raise RuntimeError(f"resend_http_{response.status_code}:{body_text[:200]}")

            resp_data = response.json() or {}
            provider_message_id = str(resp_data.get("id") or "")
            await self._record_delivery(
                conn,
                edition_date=resolved_date,
                subscriber_id=subscriber.id,
                status="sent",
                provider_message_id=provider_message_id or None,
            )
            # Also record delivery for the turkey subscription so the turkey run skips it.
            if turkey_sub_id:
                await self._record_delivery(
                    conn,
                    edition_date=resolved_date,
                    subscriber_id=turkey_sub_id,
                    status="sent",
                    provider_message_id=provider_message_id or None,
                )
            await conn.execute(
                "UPDATE news_email_subscriptions SET last_sent_at = NOW(), updated_at = NOW() WHERE id = $1::uuid",
                subscriber.id,
            )
            return "sent"
        except Exception as exc:
            err = str(exc)
            if "resend_http_422" in err or "resend_http_400" in err:
                await conn.execute(
                    "UPDATE news_email_subscriptions SET status = 'bounced', updated_at = NOW() WHERE id = $1::uuid",
                    subscriber.id,
                )
            await self._record_delivery(
                conn,
                edition_date=resolved_date,
                subscriber_id=subscriber.id,
                status="failed",
                error_text=err[:500],
            )
            return "failed"

    @staticmethod
    def _attach_signal_tags(
        stories: List[DigestStory],
        cluster_signal_map: Dict[str, Any],
    ) -> None:
        """Populate signal_tags on each story from cluster_signal_map."""
        for story in stories:
            if not story.cluster_id:
                continue
            signals = cluster_signal_map.get(story.cluster_id, [])
            story.signal_tags = list(dict.fromkeys(
                s.cluster_name or s.claim[:40] for s in signals
            ))

    async def _run_qa(
        self,
        *,
        conn: asyncpg.Connection,
        resolved_date: date,
        resolved_date_str: str,
        stories: List[DigestStory],
        brief: Optional[DailyBrief],
        qa_email: str,
        region: str,
    ) -> Dict[str, Any]:
        """Send a merged global+turkey digest to a single QA email. No subscriber/dedup/delivery logic."""
        # Always load both regions
        if region == "global":
            turkey_brief = await self._load_brief(conn, resolved_date, region="turkey")
            turkey_stories = await self._load_stories(conn, resolved_date, region="turkey")
        else:
            # Started from turkey — load global as primary, turkey as secondary
            global_brief = await self._load_brief(conn, resolved_date, region="global")
            global_stories = await self._load_stories(conn, resolved_date, region="global")
            # Swap: global becomes primary, original becomes turkey section
            turkey_brief = brief
            turkey_stories = stories
            brief = global_brief
            stories = global_stories
            region = "global"  # render as global template with turkey section

        if not turkey_stories:
            turkey_stories = None
            turkey_brief = None

        # --- Load signal context for QA previews ---
        signal_context = None
        turkey_signal_context = None
        if self.signals_enabled:
            from src.automation.digest_signals import load_digest_signal_context, fetch_cluster_ids_for_edition
            global_cluster_ids = await fetch_cluster_ids_for_edition(
                conn, resolved_date, region="global", limit=self.max_items,
            )
            signal_context = await load_digest_signal_context(
                conn,
                region="global",
                cluster_ids=global_cluster_ids,
                max_signals=self.max_signals,
                azure_client=self._azure_client,
                model_name=self._azure_model_name,
                story_titles=[s.title for s in stories],
            )
            # Attach signal tags to global stories
            if signal_context:
                self._attach_signal_tags(stories, signal_context.cluster_signal_map)
            if turkey_stories:
                turkey_cluster_ids = await fetch_cluster_ids_for_edition(
                    conn, resolved_date, region="turkey", limit=self.max_items,
                )
                turkey_signal_context = await load_digest_signal_context(
                    conn,
                    region="turkey",
                    cluster_ids=turkey_cluster_ids,
                    max_signals=self.max_signals,
                    azure_client=self._azure_client,
                    model_name=self._azure_model_name,
                    story_titles=[s.title for s in turkey_stories],
                )
                if turkey_signal_context:
                    self._attach_signal_tags(turkey_stories, turkey_signal_context.cluster_signal_map)

        unsubscribe_url = self._news_url(self.public_base_url, resolved_date_str, region)  # placeholder for QA
        html = self._build_email_html(
            edition_date=resolved_date_str,
            stories=stories,
            unsubscribe_url=unsubscribe_url,
            brief=brief,
            turkey_brief=turkey_brief,
            turkey_stories=turkey_stories,
            region=region,
            signal_context=signal_context,
            turkey_signal_context=turkey_signal_context,
        )
        text = self._build_email_text(
            edition_date=resolved_date_str,
            stories=stories,
            unsubscribe_url=unsubscribe_url,
            brief=brief,
            turkey_brief=turkey_brief,
            turkey_stories=turkey_stories,
            region=region,
            signal_context=signal_context,
            turkey_signal_context=turkey_signal_context,
        )

        result: Dict[str, Any] = {
            "qa": True,
            "qa_email": qa_email,
            "edition_date": resolved_date_str,
            "stories": len(stories),
            "turkey_stories": len(turkey_stories) if turkey_stories else 0,
            "has_brief": brief is not None,
            "has_turkey_brief": turkey_brief is not None,
            "has_signal_context": signal_context is not None,
            "has_turkey_signal_context": turkey_signal_context is not None,
        }

        if self.dry_run:
            result["dry_run"] = True
            return result

        if not self.resend_api_key:
            result["error"] = "RESEND_API_KEY not configured"
            return result

        subject = f"[QA] Build Atlas Daily Startup Digest — {resolved_date_str}"
        payload: Dict[str, Any] = {
            "from": self.from_email,
            "to": [qa_email],
            "subject": subject,
            "html": html,
            "text": text,
        }
        if self.reply_to:
            payload["reply_to"] = self.reply_to

        timeout = httpx.Timeout(20.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {self.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if response.status_code >= 400:
                body_text = ""
                try:
                    body_text = (await response.aread()).decode("utf-8", errors="ignore")
                except Exception:
                    body_text = ""
                result["error"] = f"resend_http_{response.status_code}:{body_text[:200]}"
                return result

            resp_data = response.json() or {}
            result["provider_message_id"] = str(resp_data.get("id") or "")
            result["sent"] = True
            return result

    async def run(
        self,
        *,
        edition_date: Optional[str] = None,
        region: str = "global",
        target_hour: int = 8,
        target_minute: int = 45,
        qa_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        await self.connect()
        assert self.pool is not None

        now_utc = datetime.now(timezone.utc)

        async with self.pool.acquire() as conn:
            resolved_date = await self._resolve_edition_date(conn, edition_date, region=region)
            resolved_date_str = resolved_date.isoformat()
            stories = await self._load_stories(conn, resolved_date, region=region)
            brief = await self._load_brief(conn, resolved_date, region=region)

            if qa_email:
                return await self._run_qa(
                    conn=conn,
                    resolved_date=resolved_date,
                    resolved_date_str=resolved_date_str,
                    stories=stories,
                    brief=brief,
                    qa_email=qa_email,
                    region=region,
                )

            # --- Signal context loading ---
            signal_context = None
            turkey_signal_context = None
            if self.signals_enabled:
                try:
                    from src.automation.digest_signals import load_digest_signal_context, fetch_cluster_ids_for_edition
                    cluster_ids = await fetch_cluster_ids_for_edition(
                        conn, resolved_date, region=region, limit=self.max_items,
                    )
                    signal_context = await load_digest_signal_context(
                        conn,
                        region=region,
                        cluster_ids=cluster_ids,
                        max_signals=self.max_signals,
                        azure_client=self._azure_client,
                        model_name=self._azure_model_name,
                        story_titles=[s.title for s in stories],
                    )
                    if signal_context:
                        self._attach_signal_tags(stories, signal_context.cluster_signal_map)
                except Exception as exc:
                    logger.warning("Signal context loading failed: %s", exc)
                    signal_context = None

            all_subscribers = await self._load_subscribers(conn, region=region)

            # Filter to subscribers whose local time is currently the target hour.
            tz_eligible = self._filter_by_local_hour(
                all_subscribers,
                target_hour=target_hour,
                target_minute=target_minute,
                now_utc=now_utc,
            )

            # Avoid duplicate sends when workflows are re-run for the same edition date.
            sent_rows = await conn.fetch(
                """
                SELECT subscription_id::text AS subscription_id
                FROM news_digest_deliveries
                WHERE edition_date = $1::date
                  AND status = 'sent'
                """,
                resolved_date,
            )
            sent_ids = {str(r["subscription_id"]) for r in (sent_rows or [])}
            subscribers = [s for s in tz_eligible if s.id not in sent_ids]

            # --- Cross-region detection ---
            # For global run: find subs who also have active turkey subscriptions.
            # For turkey run: subs already sent via global merge will be in sent_ids.
            cross_region_map: Dict[str, str] = {}
            turkey_brief: Optional[DailyBrief] = None
            turkey_stories: Optional[List[DigestStory]] = None

            if subscribers and region == "global":
                cross_region_map = await self._find_cross_region_subs(conn, subscribers, region=region)
                if cross_region_map:
                    # Load turkey data once for all cross-region subscribers.
                    try:
                        turkey_brief = await self._load_brief(conn, resolved_date, region="turkey")
                        turkey_stories = await self._load_stories(conn, resolved_date, region="turkey")
                        if not turkey_stories:
                            turkey_stories = None
                            turkey_brief = None
                    except Exception:
                        turkey_brief = None
                        turkey_stories = None

            # Load turkey signal context for cross-region emails
            if self.signals_enabled and turkey_stories:
                try:
                    from src.automation.digest_signals import load_digest_signal_context, fetch_cluster_ids_for_edition
                    turkey_cluster_ids = await fetch_cluster_ids_for_edition(
                        conn, resolved_date, region="turkey", limit=self.max_items,
                    )
                    turkey_signal_context = await load_digest_signal_context(
                        conn,
                        region="turkey",
                        cluster_ids=turkey_cluster_ids,
                        max_signals=self.max_signals,
                        azure_client=self._azure_client,
                        model_name=self._azure_model_name,
                        story_titles=[s.title for s in turkey_stories],
                    )
                    if turkey_signal_context:
                        self._attach_signal_tags(turkey_stories, turkey_signal_context.cluster_signal_map)
                except Exception as exc:
                    logger.warning("Turkey signal context loading failed: %s", exc)
                    turkey_signal_context = None

            result: Dict[str, Any] = {
                "edition_date": resolved_date_str,
                "region": region,
                "target_local_time": f"{target_hour:02d}:{target_minute:02d}",
                "stories": len(stories),
                "subscribers": len(all_subscribers),
                "tz_eligible": len(tz_eligible),
                "already_sent": max(0, len(tz_eligible) - len(subscribers)),
                "to_send": len(subscribers),
                "cross_region": len(cross_region_map),
                "has_signal_context": signal_context is not None,
                "sent": 0,
                "failed": 0,
                "skipped": 0,
                "provider": "resend",
            }

            if not subscribers:
                return result

            if self.dry_run:
                result["dry_run"] = True
                return result

            if not self.resend_api_key:
                for subscriber in subscribers:
                    await self._record_delivery(
                        conn,
                        edition_date=resolved_date,
                        subscriber_id=subscriber.id,
                        status="skipped",
                        error_text="RESEND_API_KEY not configured",
                    )
                    result["skipped"] += 1
                return result

            timeout = httpx.Timeout(20.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                for subscriber in subscribers:
                    email_norm = subscriber.email.strip().lower()
                    is_cross = email_norm in cross_region_map
                    sub_turkey_brief = turkey_brief if is_cross else None
                    sub_turkey_stories = turkey_stories if is_cross else None
                    turkey_sub_id = cross_region_map.get(email_norm) if is_cross else None

                    sub_turkey_signal_ctx = turkey_signal_context if is_cross else None
                    outcome = await self._send_one(
                        client, conn,
                        subscriber=subscriber,
                        resolved_date=resolved_date,
                        resolved_date_str=resolved_date_str,
                        stories=stories,
                        brief=brief,
                        region=region,
                        turkey_brief=sub_turkey_brief,
                        turkey_stories=sub_turkey_stories,
                        turkey_sub_id=turkey_sub_id,
                        signal_context=signal_context,
                        turkey_signal_context=sub_turkey_signal_ctx,
                    )
                    result[outcome] += 1

            return result


async def run_news_digest_sender(
    *,
    edition_date: Optional[str] = None,
    region: str = "global",
    dry_run: bool = False,
    target_hour: int = 8,
    target_minute: int = 45,
    qa_email: Optional[str] = None,
) -> Dict[str, Any]:
    sender = DailyNewsDigestSender()
    if dry_run:
        sender.dry_run = True
    try:
        return await sender.run(
            edition_date=edition_date,
            region=region,
            target_hour=target_hour,
            target_minute=target_minute,
            qa_email=qa_email,
        )
    finally:
        await sender.close()


def main() -> int:
    edition_date = os.getenv("NEWS_DIGEST_EDITION_DATE", "").strip() or None
    region = os.getenv("NEWS_DIGEST_REGION", "global").strip()
    result = asyncio.run(run_news_digest_sender(edition_date=edition_date, region=region))
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
