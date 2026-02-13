"""X/Twitter trend ingestion helpers."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import httpx

from .x_client import XClient


def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name, "") or "").strip()
    if not raw:
        return int(default)
    try:
        return int(raw)
    except Exception:
        return int(default)


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.getenv(name, "") or "").strip().lower()
    if not raw:
        return bool(default)
    return raw in {"1", "true", "yes", "on"}


def _default_query_pack() -> Dict[str, List[str]]:
    return {
        "global": [
            '(startup OR "ai startup" OR "generative ai startup") (funding OR "seed" OR "series a" OR "series b") lang:en -is:retweet',
            '("ai agent startup" OR "vertical ai startup" OR "llm startup") (launch OR "product launch") lang:en -is:retweet',
            '("startup acquired" OR "acquisition") ("ai" OR "genai") lang:en -is:retweet',
            '("YC" OR "Y Combinator") ("ai startup" OR "startup") lang:en -is:retweet',
        ],
        "turkey": [
            '("yapay zeka" OR "ai startup" OR "girişim") (yatırım OR funding OR seed OR "series a") (turkiye OR türkiye OR istanbul) -is:retweet',
            '("türkiye startup" OR "turkish startup" OR girişim) ("yapay zeka" OR ai OR genai) -is:retweet',
            '("webrazzi" OR "egirisim") ("yapay zeka" OR startup OR yatırım) -is:retweet',
        ],
    }


def load_query_pack() -> Dict[str, List[str]]:
    """Load query pack from env JSON/path, fallback to defaults."""
    raw = (os.getenv("X_TRENDS_QUERY_PACK", "") or "").strip()
    if not raw:
        return _default_query_pack()

    try:
        if raw.startswith("{"):
            parsed = json.loads(raw)
        else:
            path = Path(raw)
            parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_query_pack()

    out = _default_query_pack()
    if not isinstance(parsed, dict):
        return out
    for region in ("global", "turkey"):
        rows = parsed.get(region)
        if isinstance(rows, list):
            clean = [str(x).strip() for x in rows if str(x).strip()]
            if clean:
                out[region] = clean
    return out


@dataclass
class XTrendFetchStats:
    source_key: str
    queries_attempted: int = 0
    tweets_fetched: int = 0
    tweets_kept: int = 0
    pages_fetched: int = 0
    errors: int = 0


def _parse_dt(value: str) -> datetime:
    raw = (value or "").strip()
    if not raw:
        return datetime.now(timezone.utc)
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _build_user_map(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    includes = payload.get("includes") or {}
    for user in includes.get("users") or []:
        uid = str(user.get("id") or "")
        if uid:
            out[uid] = user
    return out


def _tweet_url(username: str, tweet_id: str) -> str:
    user = (username or "").strip()
    tid = (tweet_id or "").strip()
    if not tid:
        return ""
    if user:
        return f"https://x.com/{user}/status/{tid}"
    return f"https://x.com/i/web/status/{tid}"


async def fetch_recent_search_items(
    *,
    client: httpx.AsyncClient,
    source: Any,
    lookback_hours: int,
    max_items: int,
) -> tuple[List[Any], XTrendFetchStats]:
    """Fetch X trends and convert into NormalizedNewsItem list.

    `source` is expected to be news_ingest.SourceDefinition.
    """
    from .news_ingest import NormalizedNewsItem, canonicalize_url, normalize_text

    stats = XTrendFetchStats(source_key=str(getattr(source, "source_key", "x_recent_search")))
    x_client = XClient()
    enabled = _env_bool("X_TRENDS_ENABLED", default=True)
    if not enabled or not x_client.search_enabled:
        return [], stats

    region = (getattr(source, "region", "") or "global").strip().lower()
    queries = load_query_pack().get(region) or load_query_pack().get("global") or []
    if not queries:
        return [], stats

    max_queries = max(1, _env_int("X_TRENDS_MAX_QUERIES_PER_RUN", min(5, len(queries))))
    max_pages = max(1, _env_int("X_TRENDS_MAX_PAGES_PER_QUERY", 2))
    per_page = max(10, min(100, _env_int("X_TRENDS_PAGE_SIZE", 50)))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, int(lookback_hours)))

    items: List[NormalizedNewsItem] = []
    seen_ids: set[str] = set()

    for query in queries[:max_queries]:
        stats.queries_attempted += 1
        next_token = ""
        for _ in range(max_pages):
            if len(items) >= max_items:
                break
            try:
                payload = await x_client.search_recent(
                    client=client,
                    query=query,
                    start_time=cutoff,
                    max_results=per_page,
                    next_token=next_token,
                )
            except Exception as exc:
                stats.errors += 1
                print(f"[x-trends] {stats.source_key}: query failed: {exc}")
                break

            stats.pages_fetched += 1
            user_map = _build_user_map(payload)
            tweets = payload.get("data") or []
            stats.tweets_fetched += len(tweets)
            for tweet in tweets:
                tid = str(tweet.get("id") or "").strip()
                if not tid or tid in seen_ids:
                    continue
                seen_ids.add(tid)

                text = normalize_text(str(tweet.get("text") or ""))
                if not text:
                    continue
                published_at = _parse_dt(str(tweet.get("created_at") or ""))
                if published_at < cutoff:
                    continue

                author_id = str(tweet.get("author_id") or "")
                author = user_map.get(author_id) or {}
                username = str(author.get("username") or "").strip()
                author_name = str(author.get("name") or "").strip()
                url = _tweet_url(username, tid)
                canonical = canonicalize_url(url) if url else ""
                metrics = tweet.get("public_metrics") or {}

                title = text[:300]
                summary = text[:300]
                payload_obj: Dict[str, Any] = {
                    "provider": "x_api",
                    "kind": "tweet",
                    "tweet_id": tid,
                    "query": query,
                    "author_id": author_id or None,
                    "author_username": username or None,
                    "author_name": author_name or None,
                    "author_verified": bool(author.get("verified")),
                }
                engagement = {
                    "like_count": int(metrics.get("like_count") or 0),
                    "repost_count": int(metrics.get("retweet_count") or metrics.get("repost_count") or 0),
                    "reply_count": int(metrics.get("reply_count") or 0),
                    "quote_count": int(metrics.get("quote_count") or 0),
                    "bookmark_count": int(metrics.get("bookmark_count") or 0),
                    "impression_count": int(metrics.get("impression_count") or 0),
                }

                item = NormalizedNewsItem(
                    source_key=source.source_key,
                    source_name=source.display_name,
                    source_type=source.source_type,
                    title=title,
                    url=url or f"https://x.com/i/web/status/{tid}",
                    canonical_url=canonical or f"https://x.com/i/web/status/{tid}",
                    summary=summary,
                    published_at=published_at,
                    language=str(tweet.get("lang") or "en")[:12],
                    author=(f"@{username}" if username else None),
                    external_id=tid,
                    engagement=engagement,
                    payload=payload_obj,
                    source_weight=float(getattr(source, "credibility_weight", 0.64) or 0.64),
                ).with_external_id()
                items.append(item)
                stats.tweets_kept += 1
                if len(items) >= max_items:
                    break

            meta = payload.get("meta") or {}
            next_token = str(meta.get("next_token") or "").strip()
            if not next_token:
                break

    return items[:max_items], stats
