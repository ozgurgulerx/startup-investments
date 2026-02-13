"""Automated X posting pipeline.

Flow:
1) generate_x_posts: select top cluster candidates and enqueue drafts
2) publish_x_posts: publish queued drafts with caps + cooldowns
3) sync_x_post_metrics: backfill post performance into daily table
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

try:
    import asyncpg
except Exception:  # pragma: no cover
    asyncpg = None

from .x_client import XApiError, XClient, append_utm


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.getenv(name, "") or "").strip().lower()
    if not raw:
        return bool(default)
    return raw in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, *, min_value: int = 0) -> int:
    raw = (os.getenv(name, "") or "").strip()
    if not raw:
        return max(min_value, int(default))
    try:
        return max(min_value, int(raw))
    except Exception:
        return max(min_value, int(default))


def _normalize_ws(text: str) -> str:
    return " ".join((text or "").split()).strip()


def _shorten(text: str, max_len: int) -> str:
    value = _normalize_ws(text)
    if len(value) <= max_len:
        return value
    if max_len <= 1:
        return value[:max_len]
    return value[: max_len - 1].rstrip() + "…"


def _region_hashtag(region: str) -> str:
    r = (region or "global").strip().lower()
    return "#TurkeyStartups" if r == "turkey" else "#AIStartups"


def build_post_text(
    *,
    title: str,
    insight: str,
    url: str,
    region: str,
    max_chars: int = 280,
) -> str:
    """Compose X post text and keep it under max_chars."""
    clean_title = _shorten(title, 120)
    clean_insight = _shorten(insight, 140)
    link = (url or "").strip()
    hashtag = _region_hashtag(region)

    pieces = [clean_title]
    if clean_insight:
        pieces.append(clean_insight)
    if link:
        pieces.append(link)
    pieces.append(hashtag)

    text = "\n\n".join(p for p in pieces if p)
    if len(text) <= max_chars:
        return text

    # First reduce insight, then title.
    overflow = len(text) - max_chars
    if clean_insight:
        clean_insight = _shorten(clean_insight, max(32, len(clean_insight) - overflow - 5))
    text = "\n\n".join(p for p in [clean_title, clean_insight, link, hashtag] if p)
    if len(text) <= max_chars:
        return text

    overflow = len(text) - max_chars
    clean_title = _shorten(clean_title, max(40, len(clean_title) - overflow - 5))
    text = "\n\n".join(p for p in [clean_title, clean_insight, link, hashtag] if p)
    return _shorten(text, max_chars)


def _dedupe_key(source_type: str, source_id: str, canonical_url: str, region: str) -> str:
    seed = f"{source_type}:{source_id}:{canonical_url}:{region}".strip().lower()
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()


@dataclass
class GenerateResult:
    region: str
    candidates: int
    queued: int
    skipped: int


@dataclass
class PublishResult:
    considered: int
    published: int
    failed: int
    skipped_cap: int
    skipped_disabled: bool


async def _connect_db() -> "asyncpg.Connection":
    if asyncpg is None:
        raise RuntimeError("asyncpg is not installed")
    db_url = (os.getenv("DATABASE_URL") or "").strip()
    if not db_url:
        raise RuntimeError("DATABASE_URL is not configured")
    return await asyncpg.connect(db_url)


async def _table_exists(conn: "asyncpg.Connection", table_name: str) -> bool:
    value = await conn.fetchval(
        "SELECT to_regclass($1)",
        f"public.{table_name}",
    )
    return bool(value)


async def _news_clusters_region_supported(conn: "asyncpg.Connection") -> bool:
    value = await conn.fetchval(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'news_clusters' AND column_name = 'region'
        LIMIT 1
        """
    )
    return bool(value)


async def _fetch_candidates(
    conn: "asyncpg.Connection",
    *,
    region: str,
    limit: int,
    dedupe_days: int,
    region_supported: bool,
) -> List[Dict[str, Any]]:
    if region_supported:
        rows = await conn.fetch(
            """
            WITH latest AS (
              SELECT MAX(edition_date) AS edition_date
              FROM news_daily_editions
              WHERE region = $1
            ),
            selected AS (
              SELECT o.cluster_id, o.ordinality
              FROM news_daily_editions e
              JOIN latest l ON l.edition_date = e.edition_date
              CROSS JOIN LATERAL unnest(e.top_cluster_ids) WITH ORDINALITY AS o(cluster_id, ordinality)
              WHERE e.region = $1
            )
            SELECT
              c.id::text AS cluster_id,
              c.title,
              COALESCE(c.canonical_url, '') AS canonical_url,
              COALESCE(c.builder_takeaway, c.llm_summary, '') AS insight,
              c.published_at,
              s.ordinality
            FROM selected s
            JOIN news_clusters c ON c.id = s.cluster_id
            WHERE NOT EXISTS (
              SELECT 1
              FROM x_post_queue q
              WHERE q.source_type = 'news_cluster'
                AND q.source_cluster_id = c.id
                AND q.created_at >= NOW() - ($2::int || ' days')::interval
            )
            ORDER BY s.ordinality ASC
            LIMIT $3
            """,
            region,
            dedupe_days,
            limit,
        )
    else:
        rows = await conn.fetch(
            """
            WITH latest AS (
              SELECT MAX(edition_date) AS edition_date
              FROM news_daily_editions
            ),
            selected AS (
              SELECT o.cluster_id, o.ordinality
              FROM news_daily_editions e
              JOIN latest l ON l.edition_date = e.edition_date
              CROSS JOIN LATERAL unnest(e.top_cluster_ids) WITH ORDINALITY AS o(cluster_id, ordinality)
            )
            SELECT
              c.id::text AS cluster_id,
              c.title,
              COALESCE(c.canonical_url, '') AS canonical_url,
              COALESCE(c.builder_takeaway, c.llm_summary, '') AS insight,
              c.published_at,
              s.ordinality
            FROM selected s
            JOIN news_clusters c ON c.id = s.cluster_id
            WHERE NOT EXISTS (
              SELECT 1
              FROM x_post_queue q
              WHERE q.source_type = 'news_cluster'
                AND q.source_cluster_id = c.id
                AND q.created_at >= NOW() - ($1::int || ' days')::interval
            )
            ORDER BY s.ordinality ASC
            LIMIT $2
            """,
            dedupe_days,
            limit,
        )
    return [dict(r) for r in rows]


async def generate_x_posts(
    *,
    region: str = "all",
    max_items: int = 6,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Generate and enqueue X post candidates."""
    if region not in {"all", "global", "turkey"}:
        raise ValueError("region must be one of: all, global, turkey")

    conn = await _connect_db()
    try:
        if not await _table_exists(conn, "x_post_queue"):
            raise RuntimeError("x_post_queue table missing. Apply migration 061_x_social_automation.sql")

        region_supported = await _news_clusters_region_supported(conn)
        regions = ["global", "turkey"] if region == "all" else [region]
        if not region_supported:
            regions = ["global"]

        dedupe_days = _env_int("X_POST_DEDUPE_DAYS", 7, min_value=1)
        queued_total = 0
        candidate_total = 0
        skipped_total = 0
        details: List[Dict[str, Any]] = []

        for target_region in regions:
            candidates = await _fetch_candidates(
                conn,
                region=target_region,
                limit=max(1, int(max_items)),
                dedupe_days=dedupe_days,
                region_supported=region_supported,
            )
            candidate_total += len(candidates)
            queued = 0
            skipped = 0
            for idx, row in enumerate(candidates):
                cluster_id = str(row.get("cluster_id") or "").strip()
                if not cluster_id:
                    skipped += 1
                    continue
                title = str(row.get("title") or "").strip()
                insight = str(row.get("insight") or "").strip()
                canonical_url = str(row.get("canonical_url") or "").strip()
                if not canonical_url:
                    skipped += 1
                    continue
                post_url = append_utm(
                    canonical_url,
                    source="x",
                    medium="social",
                    campaign=f"auto_{target_region}",
                )
                post_text = build_post_text(
                    title=title,
                    insight=insight,
                    url=post_url,
                    region=target_region,
                )
                key = _dedupe_key("news_cluster", cluster_id, canonical_url, target_region)
                scheduled_at = datetime.now(timezone.utc) + timedelta(minutes=idx * 20)
                metadata = {
                    "cluster_id": cluster_id,
                    "canonical_url": canonical_url,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }
                if dry_run:
                    queued += 1
                    continue

                result = await conn.execute(
                    """
                    INSERT INTO x_post_queue (
                      region, source_type, source_cluster_id, source_url,
                      dedupe_key, post_text, post_url, status, priority,
                      scheduled_at, metadata_json, created_at, updated_at
                    )
                    VALUES ($1, 'news_cluster', $2::uuid, $3, $4, $5, $6, 'queued', $7, $8, $9::jsonb, NOW(), NOW())
                    ON CONFLICT (dedupe_key) DO NOTHING
                    """,
                    target_region,
                    cluster_id,
                    canonical_url,
                    key,
                    post_text,
                    post_url,
                    idx + 1,
                    scheduled_at,
                    json.dumps(metadata),
                )
                if "INSERT 0 1" in result:
                    queued += 1
                else:
                    skipped += 1

            queued_total += queued
            skipped_total += skipped
            details.append(
                {
                    "region": target_region,
                    "candidates": len(candidates),
                    "queued": queued,
                    "skipped": skipped,
                }
            )

        return {
            "ok": True,
            "dry_run": bool(dry_run),
            "regions": details,
            "candidates": candidate_total,
            "queued": queued_total,
            "skipped": skipped_total,
        }
    finally:
        await conn.close()


async def _count_published_today(conn: "asyncpg.Connection") -> int:
    value = await conn.fetchval(
        """
        SELECT COUNT(*)
        FROM x_post_queue
        WHERE status = 'published'
          AND published_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
        """
    )
    return int(value or 0)


async def _latest_published_at(conn: "asyncpg.Connection") -> Optional[datetime]:
    return await conn.fetchval(
        """
        SELECT published_at
        FROM x_post_queue
        WHERE status = 'published'
        ORDER BY published_at DESC
        LIMIT 1
        """
    )


async def _fetch_publish_queue(conn: "asyncpg.Connection", limit: int) -> List[Dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT
          id::text AS id,
          post_text,
          post_url,
          region,
          attempt_count,
          priority,
          metadata_json
        FROM x_post_queue
        WHERE status IN ('queued', 'scheduled', 'failed')
          AND scheduled_at <= NOW()
          AND attempt_count < COALESCE(NULLIF($1, 0), 3)
        ORDER BY priority ASC, scheduled_at ASC, created_at ASC
        LIMIT $2
        """,
        _env_int("X_POST_MAX_ATTEMPTS", 3, min_value=1),
        limit,
    )
    return [dict(r) for r in rows]


async def publish_x_posts(
    *,
    max_items: int = 5,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Publish queued posts to X with safety caps."""
    posting_enabled = _env_bool("X_POSTING_ENABLED", default=False)
    if not posting_enabled and not dry_run:
        return {
            "ok": True,
            "skipped_disabled": True,
            "considered": 0,
            "published": 0,
            "failed": 0,
            "skipped_cap": 0,
        }

    conn = await _connect_db()
    x_client = XClient()
    try:
        if not await _table_exists(conn, "x_post_queue"):
            raise RuntimeError("x_post_queue table missing. Apply migration 061_x_social_automation.sql")

        daily_cap = _env_int("X_MAX_POSTS_PER_DAY", 3, min_value=1)
        min_interval_min = _env_int("X_MIN_POST_INTERVAL_MINUTES", 120, min_value=1)
        published_today = await _count_published_today(conn)
        slots_left = max(0, daily_cap - published_today)
        if slots_left <= 0 and not dry_run:
            return {
                "ok": True,
                "skipped_disabled": False,
                "considered": 0,
                "published": 0,
                "failed": 0,
                "skipped_cap": 1,
                "daily_cap": daily_cap,
                "published_today": published_today,
            }

        queue = await _fetch_publish_queue(conn, max(1, int(max_items)))
        considered = len(queue)
        published = 0
        failed = 0
        skipped_cap = 0
        max_attempts = _env_int("X_POST_MAX_ATTEMPTS", 3, min_value=1)
        last_published_at = await _latest_published_at(conn)

        async with httpx.AsyncClient(timeout=x_client.timeout_sec) as http_client:
            for row in queue:
                if not dry_run and published >= slots_left:
                    skipped_cap += 1
                    break

                queue_id = str(row["id"])
                text = str(row.get("post_text") or "").strip()
                if not text:
                    failed += 1
                    continue

                if not dry_run and last_published_at is not None:
                    elapsed = datetime.now(timezone.utc) - last_published_at
                    if elapsed < timedelta(minutes=min_interval_min):
                        skipped_cap += 1
                        continue

                if dry_run:
                    published += 1
                    continue

                await conn.execute(
                    """
                    UPDATE x_post_queue
                    SET status = 'publishing',
                        attempt_count = attempt_count + 1,
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    """,
                    queue_id,
                )

                request_payload = {"text": text}
                try:
                    post_resp = await x_client.post_tweet(
                        text=text,
                        dry_run=False,
                        client=http_client,
                    )
                    post_id = str(((post_resp.get("data") or {}).get("id")) or "")
                    post_url = x_client.build_post_url(post_id)
                    await conn.execute(
                        """
                        UPDATE x_post_queue
                        SET status = 'published',
                            published_at = NOW(),
                            x_post_id = $2,
                            x_post_url = $3,
                            last_error = NULL,
                            updated_at = NOW()
                        WHERE id = $1::uuid
                        """,
                        queue_id,
                        post_id,
                        post_url,
                    )
                    await conn.execute(
                        """
                        INSERT INTO x_post_attempts (
                          queue_id, attempted_at, status, http_status, x_post_id, request_json, response_json
                        )
                        VALUES ($1::uuid, NOW(), 'success', 200, $2, $3::jsonb, $4::jsonb)
                        """,
                        queue_id,
                        post_id,
                        json.dumps(request_payload),
                        json.dumps(post_resp),
                    )
                    published += 1
                    last_published_at = datetime.now(timezone.utc)
                except XApiError as exc:
                    failed += 1
                    status_code = int(exc.status_code or 0)
                    should_retry = status_code in {429, 500, 502, 503, 504}
                    row_attempts = int(row.get("attempt_count") or 0) + 1
                    next_status = "queued" if should_retry and row_attempts < max_attempts else "failed"
                    next_schedule = datetime.now(timezone.utc) + timedelta(minutes=30 if should_retry else 5)
                    payload = exc.payload if isinstance(exc.payload, dict) else {"message": str(exc)}
                    await conn.execute(
                        """
                        UPDATE x_post_queue
                        SET status = $2,
                            scheduled_at = $3,
                            last_error = $4,
                            updated_at = NOW()
                        WHERE id = $1::uuid
                        """,
                        queue_id,
                        next_status,
                        next_schedule,
                        str(exc)[:1000],
                    )
                    await conn.execute(
                        """
                        INSERT INTO x_post_attempts (
                          queue_id, attempted_at, status, http_status, error_text, request_json, response_json
                        )
                        VALUES ($1::uuid, NOW(), 'failed', $2, $3, $4::jsonb, $5::jsonb)
                        """,
                        queue_id,
                        status_code,
                        str(exc)[:1000],
                        json.dumps(request_payload),
                        json.dumps(payload),
                    )
                except Exception as exc:
                    failed += 1
                    await conn.execute(
                        """
                        UPDATE x_post_queue
                        SET status = 'failed',
                            last_error = $2,
                            updated_at = NOW()
                        WHERE id = $1::uuid
                        """,
                        queue_id,
                        str(exc)[:1000],
                    )

        return {
            "ok": True,
            "skipped_disabled": False,
            "considered": considered,
            "published": published,
            "failed": failed,
            "skipped_cap": skipped_cap,
            "daily_cap": daily_cap,
            "published_today_before": published_today,
        }
    finally:
        await conn.close()


def _metric_value(metrics: Dict[str, Any], *keys: str) -> int:
    for key in keys:
        if key in metrics:
            try:
                return int(metrics.get(key) or 0)
            except Exception:
                return 0
    return 0


async def sync_x_post_metrics(
    *,
    days_back: int = 7,
    max_posts: int = 100,
) -> Dict[str, Any]:
    """Sync metrics for published posts."""
    conn = await _connect_db()
    x_client = XClient()
    if not x_client.search_enabled:
        return {"ok": True, "synced": 0, "skipped": "bearer_token_missing"}

    try:
        if not await _table_exists(conn, "x_post_metrics_daily"):
            raise RuntimeError("x_post_metrics_daily table missing. Apply migration 061_x_social_automation.sql")

        rows = await conn.fetch(
            """
            SELECT id::text AS queue_id, x_post_id
            FROM x_post_queue
            WHERE status = 'published'
              AND x_post_id IS NOT NULL
              AND published_at >= NOW() - ($1::int || ' days')::interval
            ORDER BY published_at DESC
            LIMIT $2
            """,
            max(1, int(days_back)),
            max(1, int(max_posts)),
        )
        if not rows:
            return {"ok": True, "synced": 0}

        id_map = {str(r["x_post_id"]): str(r["queue_id"]) for r in rows if r.get("x_post_id")}
        synced = 0
        async with httpx.AsyncClient(timeout=x_client.timeout_sec) as http_client:
            metrics_map = await x_client.fetch_tweet_metrics(client=http_client, tweet_ids=list(id_map.keys()))
        metric_date = datetime.now(timezone.utc).date()

        for post_id, payload in metrics_map.items():
            queue_id = id_map.get(post_id)
            if not queue_id:
                continue
            metrics = payload.get("metrics") or {}
            impressions = _metric_value(metrics, "impression_count", "impressions")
            likes = _metric_value(metrics, "like_count")
            replies = _metric_value(metrics, "reply_count")
            reposts = _metric_value(metrics, "retweet_count", "repost_count")
            quotes = _metric_value(metrics, "quote_count")
            bookmarks = _metric_value(metrics, "bookmark_count")
            profile_clicks = _metric_value(metrics, "user_profile_clicks", "profile_clicks")
            url_clicks = _metric_value(metrics, "url_link_clicks", "link_clicks", "url_clicks")
            await conn.execute(
                """
                INSERT INTO x_post_metrics_daily (
                  queue_id, metric_date, impressions, likes, replies, reposts, quotes,
                  bookmarks, profile_clicks, url_clicks, observed_at, metadata_json
                )
                VALUES ($1::uuid, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11::jsonb)
                ON CONFLICT (queue_id, metric_date) DO UPDATE
                SET impressions = EXCLUDED.impressions,
                    likes = EXCLUDED.likes,
                    replies = EXCLUDED.replies,
                    reposts = EXCLUDED.reposts,
                    quotes = EXCLUDED.quotes,
                    bookmarks = EXCLUDED.bookmarks,
                    profile_clicks = EXCLUDED.profile_clicks,
                    url_clicks = EXCLUDED.url_clicks,
                    observed_at = NOW(),
                    metadata_json = EXCLUDED.metadata_json
                """,
                queue_id,
                metric_date,
                impressions,
                likes,
                replies,
                reposts,
                quotes,
                bookmarks,
                profile_clicks,
                url_clicks,
                json.dumps({"x_post_id": post_id, "raw_metrics": metrics}),
            )
            synced += 1

        return {"ok": True, "synced": synced, "requested": len(id_map)}
    finally:
        await conn.close()


def run_generate_x_posts(**kwargs: Any) -> Dict[str, Any]:
    return asyncio.run(generate_x_posts(**kwargs))


def run_publish_x_posts(**kwargs: Any) -> Dict[str, Any]:
    return asyncio.run(publish_x_posts(**kwargs))


def run_sync_x_post_metrics(**kwargs: Any) -> Dict[str, Any]:
    return asyncio.run(sync_x_post_metrics(**kwargs))
