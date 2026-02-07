"""Daily startup news ingestion and edition builder.

This module ingests diverse startup-news sources (RSS/API/community/frontier URLs),
normalizes them, deduplicates into story clusters, ranks stories, and writes a daily
edition snapshot to Postgres.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx

try:
    import asyncpg
except Exception:  # pragma: no cover - optional import at module import time
    asyncpg = None

try:
    from openai import AsyncAzureOpenAI
except Exception:  # pragma: no cover - optional import at module import time
    AsyncAzureOpenAI = None

try:
    import feedparser
except Exception:  # pragma: no cover - optional import at module import time
    feedparser = None

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover - optional import at module import time
    BeautifulSoup = None

TRACKING_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "msclkid",
    "ref",
    "source",
    "campaign",
}

FRONTIER_LISTING_PATHS = {
    "",
    "blog",
    "blogs",
    "news",
    "changelog",
    "changes",
    "updates",
    "resources",
    "press",
    "insights",
}

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it",
    "its", "of", "on", "or", "that", "the", "to", "with", "will", "new", "startup", "startups",
}

GENERIC_ENTITIES = {
    "AI", "Startup", "Startups", "Today", "Breaking", "News", "Tech", "Series", "Funding", "Round",
}

TOPIC_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "funding": ("raises", "raised", "funding", "series a", "series b", "series c", "seed", "pre-seed", "valuation"),
    "ai": ("ai", "genai", "llm", "model", "agent", "inference", "gpu", "foundation model"),
    "launch": ("launch", "launched", "debut", "introduces", "release", "released", "product hunt"),
    "mna": ("acquire", "acquisition", "merger", "buys", "deal"),
    "hiring": ("hiring", "careers", "joins", "appointed", "head of"),
    "regulation": ("regulation", "compliance", "policy", "law", "act", "eu ai act", "ftc", "sec"),
    "security": ("security", "breach", "vulnerability", "cyber", "zero-day"),
}

ALLOWED_STORY_TYPES = {"funding", "launch", "mna", "regulation", "hiring", "news"}


@dataclass(frozen=True)
class SourceDefinition:
    source_key: str
    display_name: str
    source_type: str
    base_url: str
    region: str = "global"  # global|turkey
    fetch_mode: str = "rss"  # rss|api|crawler
    credibility_weight: float = 0.65
    legal_mode: str = "headline_snippet"


# 30+ sources across publishers, community, and aggregators.
DEFAULT_SOURCES: List[SourceDefinition] = [
    SourceDefinition("techcrunch", "TechCrunch", "rss", "https://techcrunch.com/feed/", credibility_weight=0.92),
    SourceDefinition("techcrunch_startups", "TechCrunch Startups", "rss", "https://techcrunch.com/category/startups/feed/", credibility_weight=0.94),
    SourceDefinition("venturebeat", "VentureBeat", "rss", "https://venturebeat.com/feed/", credibility_weight=0.86),
    SourceDefinition("wired", "WIRED", "rss", "https://www.wired.com/feed/rss", credibility_weight=0.80),
    SourceDefinition("sifted", "Sifted", "rss", "https://sifted.eu/feed/", credibility_weight=0.78),
    SourceDefinition("crunchbase_news", "Crunchbase News", "rss", "https://news.crunchbase.com/feed/", credibility_weight=0.85),
    SourceDefinition("webrazzi", "Webrazzi", "rss", "https://webrazzi.com/feed/", region="turkey", credibility_weight=0.74),
    SourceDefinition("egirisim", "Egirisim", "rss", "https://egirisim.com/feed/", region="turkey", credibility_weight=0.70),
    SourceDefinition("producthunt_blog", "Product Hunt Blog", "rss", "https://www.producthunt.com/blog/feed", credibility_weight=0.82),
    SourceDefinition("entrepreneur", "Entrepreneur", "rss", "https://www.entrepreneur.com/latest.rss", credibility_weight=0.72),
    SourceDefinition("inc", "Inc", "rss", "https://www.inc.com/rss", credibility_weight=0.74),
    SourceDefinition("fastcompany", "Fast Company", "rss", "https://www.fastcompany.com/rss", credibility_weight=0.75),
    SourceDefinition("techeu", "Tech.eu", "rss", "https://tech.eu/feed/", credibility_weight=0.81),
    SourceDefinition("mashable", "Mashable", "rss", "https://mashable.com/feeds/rss/all", credibility_weight=0.68),
    SourceDefinition("hackernoon", "HackerNoon", "rss", "https://hackernoon.com/feed", credibility_weight=0.64),
    SourceDefinition("a16z_blog", "a16z Blog", "rss", "https://a16z.com/feed/", credibility_weight=0.76),
    SourceDefinition("avc_blog", "AVC", "rss", "https://avc.com/feed/", credibility_weight=0.74),
    SourceDefinition("strictlyvc", "StrictlyVC", "rss", "https://strictlyvc.com/feed", credibility_weight=0.80),
    SourceDefinition("hn_rss_startup", "HN RSS Startup", "community", "https://hnrss.org/newest?q=startup", credibility_weight=0.83),
    SourceDefinition("hn_rss_funding", "HN RSS Funding", "community", "https://hnrss.org/newest?q=startup+funding", credibility_weight=0.85),
    SourceDefinition("hn_rss_ai", "HN RSS AI", "community", "https://hnrss.org/newest?q=ai+startup", credibility_weight=0.84),
    SourceDefinition("lobsters", "Lobsters", "community", "https://lobste.rs/rss", credibility_weight=0.70),
    SourceDefinition("reddit_startups", "Reddit r/startups", "community", "https://www.reddit.com/r/startups/.rss", credibility_weight=0.62),
    SourceDefinition("reddit_technology", "Reddit r/technology", "community", "https://www.reddit.com/r/technology/.rss", credibility_weight=0.60),
    SourceDefinition("reddit_machinelearning", "Reddit r/MachineLearning", "community", "https://www.reddit.com/r/MachineLearning/.rss", credibility_weight=0.66),
    SourceDefinition("devto_startups", "Dev.to Startups", "community", "https://dev.to/feed/tag/startups", credibility_weight=0.63),
    SourceDefinition("devto_ai", "Dev.to AI", "community", "https://dev.to/feed/tag/ai", credibility_weight=0.62),
    SourceDefinition("prnewswire_tech", "PR Newswire Tech", "rss", "https://www.prnewswire.com/rss/technology-latest-news/technology-latest-news-list.rss", credibility_weight=0.68),
    SourceDefinition("businesswire_tech", "BusinessWire Tech", "rss", "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFtWWQ==", credibility_weight=0.66),
    SourceDefinition("producthunt_api", "Product Hunt API", "api", "https://api.producthunt.com/v2/api/graphql", fetch_mode="api", credibility_weight=0.86),
    SourceDefinition("hackernews_api", "Hacker News API", "api", "https://hacker-news.firebaseio.com/v0", fetch_mode="api", credibility_weight=0.88),
    SourceDefinition("newsapi", "NewsAPI", "api", "https://newsapi.org/v2/everything", fetch_mode="api", credibility_weight=0.67),
    SourceDefinition("gnews", "GNews", "api", "https://gnews.io/api/v4/search", fetch_mode="api", credibility_weight=0.66),
    SourceDefinition("frontier_news", "Frontier News URLs", "crawler", "frontier://news", fetch_mode="crawler", credibility_weight=0.62),
    SourceDefinition("startup_owned_feeds", "Startup-Owned Sources", "crawler", "startup://owned", fetch_mode="crawler", credibility_weight=0.79),
]


@dataclass
class NormalizedNewsItem:
    source_key: str
    source_name: str
    source_type: str
    title: str
    url: str
    canonical_url: str
    summary: str
    published_at: datetime
    language: str = "en"
    author: Optional[str] = None
    external_id: str = ""
    engagement: Dict[str, Any] = field(default_factory=dict)
    payload: Dict[str, Any] = field(default_factory=dict)
    source_weight: float = 0.65

    def with_external_id(self) -> "NormalizedNewsItem":
        if self.external_id:
            return self
        base = f"{self.source_key}|{self.canonical_url}|{self.published_at.isoformat()}|{self.title.strip().lower()}"
        self.external_id = hashlib.sha1(base.encode("utf-8")).hexdigest()[:24]
        return self


@dataclass
class StoryCluster:
    cluster_key: str
    canonical_url: str
    title: str
    summary: str
    published_at: datetime
    topic_tags: List[str]
    entities: List[str]
    story_type: str
    rank_score: float
    rank_reason: str
    trust_score: float
    builder_takeaway: Optional[str]
    llm_summary: Optional[str]
    llm_model: Optional[str]
    llm_signal_score: Optional[float]
    llm_confidence_score: Optional[float]
    llm_topic_tags: List[str]
    llm_story_type: Optional[str]
    members: List[NormalizedNewsItem]


@dataclass
class LLMEnrichmentResult:
    llm_summary: Optional[str]
    builder_takeaway: Optional[str]
    llm_model: Optional[str]
    llm_signal_score: Optional[float]
    llm_confidence_score: Optional[float]
    llm_topic_tags: Optional[List[str]]
    llm_story_type: Optional[str]
    timed_out: bool = False
    error_code: Optional[str] = None


def canonicalize_url(url: str) -> str:
    if not url:
        return ""
    u = url.strip()
    if not u.startswith(("http://", "https://")):
        u = f"https://{u}"
    parsed = urlparse(u)
    scheme = "https"
    host = parsed.netloc.lower().removeprefix("www.")
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    pairs = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=False) if k.lower() not in TRACKING_PARAMS]
    pairs.sort(key=lambda kv: (kv[0], kv[1]))
    query = urlencode(pairs)
    return urlunparse((scheme, host, path, "", query, ""))


def normalize_image_url(url: str, base_url: str = "") -> str:
    """Normalize an image URL without stripping CDN query params."""
    if not url:
        return ""
    u = url.strip()
    if not u.startswith(("http://", "https://", "//")):
        if base_url:
            u = urljoin(base_url, u)
        else:
            return ""
    if u.startswith("//"):
        u = f"https:{u}"
    parsed = urlparse(u)
    if not parsed.netloc:
        return ""
    # Only strip UTM params, keep everything else (CDN params like source, ref, etc.)
    utm_params = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"}
    pairs = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=False) if k.lower() not in utm_params]
    query = urlencode(pairs)
    return urlunparse((parsed.scheme or "https", parsed.netloc, parsed.path, "", query, ""))


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def is_likely_content_url(url: str) -> bool:
    path = (urlparse(url).path or "").strip().lower().strip("/")
    if path in FRONTIER_LISTING_PATHS:
        return False
    return True


def ensure_json_object(value: Any) -> Dict[str, Any]:
    """Coerce json/jsonb payloads from DB into plain dicts safely."""
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}


def parse_entry_datetime(entry: Any) -> Optional[datetime]:
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if parsed:
        try:
            return datetime(*parsed[:6], tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def tokenize_title(title: str) -> List[str]:
    raw = re.findall(r"[a-zA-Z0-9]+", title.lower())
    return [t for t in raw if t not in STOPWORDS and len(t) >= 2]


def title_fingerprint(title: str) -> str:
    toks = tokenize_title(title)
    return " ".join(toks[:8])


def title_similarity(a: str, b: str) -> float:
    sa = set(tokenize_title(a))
    sb = set(tokenize_title(b))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def extract_entities(title: str) -> List[str]:
    pattern = re.compile(r"\b([A-Z][a-zA-Z0-9&.-]*(?:\s+[A-Z][a-zA-Z0-9&.-]*){0,2})\b")
    entities: List[str] = []
    for match in pattern.findall(title or ""):
        item = normalize_text(match)
        if not item or item in GENERIC_ENTITIES:
            continue
        if item not in entities:
            entities.append(item)
        if len(entities) >= 6:
            break
    return entities


def classify_topic_tags(title: str, summary: str = "") -> List[str]:
    text = f"{title} {summary}".lower()
    tags = [topic for topic, words in TOPIC_KEYWORDS.items() if any(w in text for w in words)]
    return tags or ["startup"]


def classify_story_type(tags: Sequence[str]) -> str:
    if "funding" in tags:
        return "funding"
    if "launch" in tags:
        return "launch"
    if "mna" in tags:
        return "mna"
    if "regulation" in tags:
        return "regulation"
    if "hiring" in tags:
        return "hiring"
    return "news"


def clamp01(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        number = float(value)
    except Exception:
        return default
    return max(0.0, min(1.0, number))


def normalize_llm_story_type(value: Any, fallback: str) -> str:
    if isinstance(value, str):
        candidate = value.strip().lower()
        if candidate in ALLOWED_STORY_TYPES:
            return candidate
    return fallback


def normalize_llm_topic_tags(value: Any, fallback: Sequence[str]) -> List[str]:
    out: List[str] = []
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, str):
                continue
            tag = normalize_text(item).lower()
            if not tag:
                continue
            if tag not in out:
                out.append(tag)
            if len(out) >= 8:
                break
    if out:
        return out
    fallback_tags = [normalize_text(tag).lower() for tag in fallback if normalize_text(tag)]
    deduped: List[str] = []
    for tag in fallback_tags:
        if tag not in deduped:
            deduped.append(tag)
    return deduped or ["startup"]


def _is_timeout_exception(exc: Exception) -> bool:
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError, httpx.TimeoutException)):
        return True
    text = str(exc).lower()
    return "timeout" in text or "timed out" in text


def _percentile(values: Sequence[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(float(v) for v in values)
    if len(ordered) == 1:
        return ordered[0]
    pct = max(0.0, min(100.0, float(percentile)))
    pos = (len(ordered) - 1) * (pct / 100.0)
    lower = int(math.floor(pos))
    upper = int(math.ceil(pos))
    if lower == upper:
        return ordered[lower]
    weight = pos - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def compute_cluster_scores(
    *,
    published_at: datetime,
    topic_tags: Sequence[str],
    members: Sequence[NormalizedNewsItem],
    now: Optional[datetime] = None,
) -> Tuple[float, float, str]:
    now_ts = now or datetime.now(timezone.utc)
    age_hours = max(0.0, (now_ts - published_at).total_seconds() / 3600.0)
    recency = max(0.0, 1.0 - (age_hours / 72.0))

    source_weight = max((m.source_weight for m in members), default=0.6)
    diversity = min(1.0, len({m.source_key for m in members}) / 4.0)
    engagement_raw = 0.0
    for item in members:
        points = float(item.engagement.get("points") or item.engagement.get("votes") or 0.0)
        engagement_raw = max(engagement_raw, min(1.0, points / 500.0))

    ai_boost = 0.12 if "ai" in topic_tags else 0.0
    funding_boost = 0.08 if "funding" in topic_tags else 0.0

    rank_score = (
        recency * 0.45
        + source_weight * 0.25
        + diversity * 0.15
        + engagement_raw * 0.10
        + ai_boost
        + funding_boost
    )
    rank_score = max(0.0, min(1.0, rank_score))

    trust_score = max(0.0, min(1.0, source_weight * 0.45 + diversity * 0.40 + 0.15))

    reasons: List[str] = []
    if recency > 0.75:
        reasons.append("breaking")
    if len(members) >= 3:
        reasons.append(f"covered by {len(members)} sources")
    if "funding" in topic_tags:
        reasons.append("funding signal")
    if "ai" in topic_tags:
        reasons.append("ai-priority")
    if engagement_raw >= 0.4:
        reasons.append("high community engagement")
    if not reasons:
        reasons.append("editorial rank blend")

    return rank_score, trust_score, ", ".join(reasons[:3])


def extract_html_title_summary(html: str, source_url: str = "") -> Tuple[str, str, Optional[datetime], Optional[str]]:
    if not html:
        return "", "", None, None

    if BeautifulSoup is None:
        return "", "", None, None

    soup = BeautifulSoup(html, "html.parser")
    title = ""
    summary = ""
    published = None
    image_url = None

    if soup.title and soup.title.string:
        title = normalize_text(soup.title.string)

    meta_desc = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
    if meta_desc and meta_desc.get("content"):
        summary = normalize_text(meta_desc.get("content"))

    meta_published = soup.find("meta", attrs={"property": "article:published_time"}) or soup.find("meta", attrs={"name": "publish-date"})
    if meta_published and meta_published.get("content"):
        raw = meta_published.get("content")
        try:
            published = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
            else:
                published = published.astimezone(timezone.utc)
        except Exception:
            published = None

    meta_image = soup.find("meta", attrs={"property": "og:image"}) or soup.find("meta", attrs={"name": "twitter:image"})
    if meta_image and meta_image.get("content"):
        raw_image = str(meta_image.get("content")).strip()
        if raw_image:
            image_url = urljoin(source_url, raw_image) if source_url else raw_image

    return title, summary, published, image_url


def _extract_rss_image(entry: Any, article_url: str = "") -> str:
    """Extract the best image URL from a feedparser entry, trying multiple methods."""
    image_url = ""

    # 1. media:content (most reliable)
    media_content = entry.get("media_content") or []
    if media_content and isinstance(media_content, list):
        for mc in media_content:
            if not isinstance(mc, dict):
                continue
            mc_url = str(mc.get("url") or "")
            mc_type = str(mc.get("type") or mc.get("medium") or "")
            if mc_url and ("image" in mc_type or not mc_type):
                image_url = mc_url
                break

    # 2. media:thumbnail
    if not image_url:
        media_thumbnail = entry.get("media_thumbnail") or []
        if media_thumbnail and isinstance(media_thumbnail, list):
            first = media_thumbnail[0] if media_thumbnail else {}
            if isinstance(first, dict):
                image_url = str(first.get("url") or "")

    # 3. enclosures (common in many feeds)
    if not image_url:
        enclosures = entry.get("enclosures") or []
        if isinstance(enclosures, list):
            for enc in enclosures:
                if not isinstance(enc, dict):
                    continue
                enc_type = str(enc.get("type") or "")
                enc_href = str(enc.get("href") or enc.get("url") or "")
                if enc_href and enc_type.startswith("image/"):
                    image_url = enc_href
                    break

    # 4. entry.image dict (feedparser sometimes exposes this)
    if not image_url:
        entry_image = entry.get("image") or {}
        if isinstance(entry_image, dict):
            image_url = str(entry_image.get("href") or entry_image.get("url") or "")

    # 5. links with image content type
    if not image_url:
        for link_obj in entry.get("links", []) or []:
            if not isinstance(link_obj, dict):
                continue
            href = str(link_obj.get("href") or "")
            content_type = str(link_obj.get("type") or "")
            if href and content_type.startswith("image/"):
                image_url = href
                break

    # 6. Parse og:image from entry content HTML (last resort)
    if not image_url and BeautifulSoup is not None:
        content_list = entry.get("content") or []
        if isinstance(content_list, list):
            for content_obj in content_list[:1]:
                html = str(content_obj.get("value") or "") if isinstance(content_obj, dict) else ""
                if html and len(html) > 50:
                    try:
                        soup = BeautifulSoup(html, "html.parser")
                        img_tag = soup.find("img", src=True)
                        if img_tag:
                            image_url = str(img_tag.get("src") or "")
                    except Exception:
                        pass

    if image_url:
        return normalize_image_url(image_url, base_url=article_url)
    return ""


def _shorten_text(value: str, limit: int = 180) -> str:
    text = normalize_text(value)
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)].rstrip() + "..."


def build_builder_takeaway(*, story_type: str, tags: Sequence[str], title: str, summary: str, entities: Sequence[str]) -> str:
    focus = entities[0] if entities else "the company"
    text = f"{title} {summary}".lower()

    if story_type == "funding":
        if "series a" in text or "series b" in text or "series c" in text:
            return _shorten_text(f"{focus} is entering a scaling phase. Watch hiring and infra spend signals before copying the stack.")
        return _shorten_text(f"{focus} just raised capital. Track whether they ship product velocity or mostly narrative in the next 60 days.")

    if story_type == "launch":
        return _shorten_text(f"{focus} is shipping now. Builders should evaluate adoption risk, integration friction, and pricing durability before switching.")

    if story_type == "mna":
        return _shorten_text(f"{focus} indicates market consolidation. Builders should expect tighter distribution and fewer independent integration points.")

    if story_type == "regulation":
        return _shorten_text(f"{focus} highlights compliance pressure. Factor governance and auditability into roadmap decisions this quarter.")

    if "ai" in tags:
        return _shorten_text(f"{focus} is part of the AI build race. Prioritize defensible data and eval quality over model-chasing.")

    return _shorten_text(f"{focus} is a useful market signal. Validate demand with customer pull, not just headline momentum.")


class DailyNewsIngestor:
    """Ingests news sources and builds daily ranked startup-news editions."""

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or os.getenv("DATABASE_URL")
        if not self.database_url:
            raise RuntimeError("DATABASE_URL is required for news ingestion")
        if asyncpg is None:
            raise RuntimeError("asyncpg is required for news ingestion")

        self.pool: Optional[asyncpg.Pool] = None
        self.http_timeout = float(os.getenv("NEWS_HTTP_TIMEOUT_SECONDS", "20"))
        self.max_per_source = int(os.getenv("NEWS_MAX_ITEMS_PER_SOURCE", "40"))
        self.product_hunt_token = os.getenv("PRODUCT_HUNT_TOKEN", "")
        self.newsapi_key = os.getenv("NEWS_API_KEY", "") or os.getenv("NEWSAPI_KEY", "")
        self.gnews_key = os.getenv("GNEWS_API_KEY", "")
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "")
        self.azure_openai_api_key = os.getenv("AZURE_OPENAI_API_KEY", "")
        self.azure_openai_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
        self.azure_openai_api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01")
        self.azure_openai_deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
        self.llm_enrichment_enabled = os.getenv("NEWS_LLM_ENRICHMENT", "false").lower() in {"1", "true", "yes", "on"}
        self.llm_model = os.getenv("NEWS_LLM_MODEL", "gpt-4o-mini")
        self.llm_max_clusters = max(0, int(os.getenv("NEWS_LLM_MAX_CLUSTERS", "12")))
        self.llm_concurrency = max(1, min(16, int(os.getenv("NEWS_LLM_CONCURRENCY", "4"))))
        daily_brief_env = os.getenv("NEWS_LLM_DAILY_BRIEF", "").strip().lower()
        if daily_brief_env:
            self.llm_daily_brief_enabled = daily_brief_env in {"1", "true", "yes", "on"}
        else:
            self.llm_daily_brief_enabled = bool(self.llm_enrichment_enabled)
        self.llm_daily_brief_max_clusters = max(3, int(os.getenv("NEWS_LLM_DAILY_BRIEF_MAX_CLUSTERS", "10")))
        self._llm_metrics: Dict[str, Any] = {
            "enabled": bool(self.llm_enrichment_enabled),
            "model": self.llm_model,
            "max_clusters": int(self.llm_max_clusters),
            "concurrency": int(self.llm_concurrency),
            "attempted": 0,
            "succeeded": 0,
            "failed": 0,
            "timeouts": 0,
            "latency_ms_p50": 0.0,
            "latency_ms_p95": 0.0,
            "latency_ms_avg": 0.0,
        }
        self.azure_client: Optional[Any] = None
        if (
            AsyncAzureOpenAI is not None
            and self.azure_openai_api_key
            and self.azure_openai_endpoint
        ):
            self.azure_client = AsyncAzureOpenAI(
                api_key=self.azure_openai_api_key,
                api_version=self.azure_openai_api_version,
                azure_endpoint=self.azure_openai_endpoint,
            )

    async def connect(self):
        if self.pool is None:
            self.pool = await asyncpg.create_pool(self.database_url, min_size=1, max_size=6)

    async def close(self):
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    async def _get_source_id_map(self, conn: asyncpg.Connection) -> Dict[str, str]:
        rows = await conn.fetch("SELECT id::text, source_key FROM news_sources")
        return {r["source_key"]: r["id"] for r in rows}

    async def _upsert_sources(self, conn: asyncpg.Connection, sources: Sequence[SourceDefinition]) -> None:
        for src in sources:
            await conn.execute(
                """
                INSERT INTO news_sources (
                    source_key, display_name, source_type, base_url, region,
                    credibility_weight, legal_mode, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                ON CONFLICT (source_key) DO UPDATE
                SET display_name = EXCLUDED.display_name,
                    source_type = EXCLUDED.source_type,
                    base_url = EXCLUDED.base_url,
                    region = EXCLUDED.region,
                    credibility_weight = EXCLUDED.credibility_weight,
                    legal_mode = EXCLUDED.legal_mode,
                    updated_at = NOW()
                """,
                src.source_key,
                src.display_name,
                src.source_type,
                src.base_url,
                src.region,
                src.credibility_weight,
                src.legal_mode,
            )

    async def _fetch_rss_source(self, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        if feedparser is None:
            return []

        resp = await client.get(source.base_url)
        resp.raise_for_status()
        parsed = feedparser.parse(resp.text)

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        items: List[NormalizedNewsItem] = []

        for entry in parsed.entries[: self.max_per_source * 2]:
            title = normalize_text(entry.get("title", ""))
            link = entry.get("link", "")
            if not title or not link:
                continue

            published = parse_entry_datetime(entry) or datetime.now(timezone.utc)
            if published < cutoff:
                continue

            summary_html = entry.get("summary", entry.get("description", ""))
            summary_text = normalize_text(re.sub(r"<[^>]+>", " ", summary_html or ""))
            summary = summary_text[:300]
            image_url = ""

            image_url = _extract_rss_image(entry, link)

            canonical = canonicalize_url(link)
            item = NormalizedNewsItem(
                source_key=source.source_key,
                source_name=source.display_name,
                source_type=source.source_type,
                title=title[:300],
                url=link,
                canonical_url=canonical,
                summary=summary,
                published_at=published,
                language="en",
                author=normalize_text(entry.get("author", "")) or None,
                payload={
                    "feed_title": parsed.feed.get("title", ""),
                    "entry_id": entry.get("id", ""),
                    "image_url": image_url or None,
                },
                source_weight=source.credibility_weight,
            ).with_external_id()
            items.append(item)
            if len(items) >= self.max_per_source:
                break

        return items

    async def _fetch_hackernews_api(self, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        # Lightweight enrichment from official HN API.
        list_resp = await client.get(f"{source.base_url}/newstories.json")
        list_resp.raise_for_status()
        ids = list_resp.json()[: min(120, self.max_per_source * 6)]

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        items: List[NormalizedNewsItem] = []

        async def fetch_item(item_id: int) -> Optional[NormalizedNewsItem]:
            try:
                resp = await client.get(f"{source.base_url}/item/{item_id}.json")
                resp.raise_for_status()
                data = resp.json() or {}
                if data.get("type") != "story":
                    return None
                title = normalize_text(str(data.get("title") or ""))
                url = str(data.get("url") or "")
                if not title or not url:
                    return None

                ts = int(data.get("time") or 0)
                published = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else datetime.now(timezone.utc)
                if published < cutoff:
                    return None

                return NormalizedNewsItem(
                    source_key=source.source_key,
                    source_name=source.display_name,
                    source_type=source.source_type,
                    title=title[:300],
                    url=url,
                    canonical_url=canonicalize_url(url),
                    summary="",
                    published_at=published,
                    language="en",
                    author=None,
                    engagement={"points": int(data.get("score") or 0), "comments": int(data.get("descendants") or 0)},
                    payload={"hn_id": data.get("id")},
                    source_weight=source.credibility_weight,
                ).with_external_id()
            except Exception:
                return None

        for batch_start in range(0, len(ids), 25):
            batch = [fetch_item(i) for i in ids[batch_start: batch_start + 25]]
            for result in await asyncio.gather(*batch):
                if result is not None:
                    items.append(result)
                if len(items) >= self.max_per_source:
                    return items

        return items

    async def _fetch_producthunt_api(self, client: httpx.AsyncClient, source: SourceDefinition) -> List[NormalizedNewsItem]:
        if not self.product_hunt_token:
            return []

        query = {
            "query": """
            query DailyPosts($first: Int!) {
              posts(first: $first, order: VOTES) {
                edges {
                  node {
                    id
                    name
                    tagline
                    url
                    votesCount
                    createdAt
                  }
                }
              }
            }
            """,
            "variables": {"first": min(30, self.max_per_source)},
        }
        headers = {
            "Authorization": f"Bearer {self.product_hunt_token}",
            "Content-Type": "application/json",
        }

        resp = await client.post(source.base_url, headers=headers, json=query)
        if resp.status_code >= 400:
            return []

        body = resp.json() or {}
        edges = (((body.get("data") or {}).get("posts") or {}).get("edges") or [])
        items: List[NormalizedNewsItem] = []

        for edge in edges:
            node = edge.get("node") or {}
            title = normalize_text(str(node.get("name") or ""))
            tagline = normalize_text(str(node.get("tagline") or ""))
            url = str(node.get("url") or "")
            if not title or not url:
                continue

            created_at = node.get("createdAt") or datetime.now(timezone.utc).isoformat()
            try:
                published = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
                if published.tzinfo is None:
                    published = published.replace(tzinfo=timezone.utc)
                else:
                    published = published.astimezone(timezone.utc)
            except Exception:
                published = datetime.now(timezone.utc)

            item = NormalizedNewsItem(
                source_key=source.source_key,
                source_name=source.display_name,
                source_type=source.source_type,
                title=title[:300],
                url=url,
                canonical_url=canonicalize_url(url),
                summary=tagline[:300],
                published_at=published,
                language="en",
                engagement={"votes": int(node.get("votesCount") or 0)},
                payload={"producthunt_id": node.get("id")},
                source_weight=source.credibility_weight,
            ).with_external_id()
            items.append(item)

        return items[: self.max_per_source]

    async def _fetch_newsapi(self, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        if not self.newsapi_key:
            return []

        now = datetime.now(timezone.utc)
        since = (now - timedelta(hours=max(1, lookback_hours))).isoformat()
        params = {
            "q": "startup OR funding OR seed round OR AI startup",
            "language": "en",
            "sortBy": "publishedAt",
            "from": since,
            "pageSize": str(min(100, self.max_per_source)),
            "apiKey": self.newsapi_key,
        }
        resp = await client.get(source.base_url, params=params)
        if resp.status_code >= 400:
            return []

        body = resp.json() or {}
        raw_articles = body.get("articles") or []
        items: List[NormalizedNewsItem] = []

        for art in raw_articles:
            title = normalize_text(str(art.get("title") or ""))
            url = str(art.get("url") or "")
            if not title or not url:
                continue

            published_raw = art.get("publishedAt") or now.isoformat()
            try:
                published = datetime.fromisoformat(str(published_raw).replace("Z", "+00:00"))
                if published.tzinfo is None:
                    published = published.replace(tzinfo=timezone.utc)
                else:
                    published = published.astimezone(timezone.utc)
            except Exception:
                published = now

            item = NormalizedNewsItem(
                source_key=source.source_key,
                source_name=source.display_name,
                source_type=source.source_type,
                title=title[:300],
                url=url,
                canonical_url=canonicalize_url(url),
                summary=normalize_text(str(art.get("description") or ""))[:300],
                published_at=published,
                language=str(art.get("language") or "en")[:12],
                author=normalize_text(str(art.get("author") or "")) or None,
                payload={
                    "provider": "newsapi",
                    "source": art.get("source"),
                    "image_url": normalize_image_url(str(art.get("urlToImage") or "")) if art.get("urlToImage") else None,
                },
                source_weight=source.credibility_weight,
            ).with_external_id()
            items.append(item)

        return items[: self.max_per_source]

    async def _fetch_gnews(self, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        if not self.gnews_key:
            return []

        now = datetime.now(timezone.utc)
        since = (now - timedelta(hours=max(1, lookback_hours))).isoformat()
        params = {
            "q": "startup OR funding OR AI",
            "lang": "en",
            "max": str(min(50, self.max_per_source)),
            "from": since,
            "token": self.gnews_key,
        }
        resp = await client.get(source.base_url, params=params)
        if resp.status_code >= 400:
            return []

        body = resp.json() or {}
        articles = body.get("articles") or []
        items: List[NormalizedNewsItem] = []

        for art in articles:
            title = normalize_text(str(art.get("title") or ""))
            url = str(art.get("url") or "")
            if not title or not url:
                continue

            published_raw = art.get("publishedAt") or now.isoformat()
            try:
                published = datetime.fromisoformat(str(published_raw).replace("Z", "+00:00"))
                if published.tzinfo is None:
                    published = published.replace(tzinfo=timezone.utc)
                else:
                    published = published.astimezone(timezone.utc)
            except Exception:
                published = now

            item = NormalizedNewsItem(
                source_key=source.source_key,
                source_name=source.display_name,
                source_type=source.source_type,
                title=title[:300],
                url=url,
                canonical_url=canonicalize_url(url),
                summary=normalize_text(str(art.get("description") or ""))[:300],
                published_at=published,
                language="en",
                author=normalize_text(str(art.get("source", {}).get("name") or "")) or None,
                payload={
                    "provider": "gnews",
                    "image_url": normalize_image_url(str(art.get("image") or "")) if art.get("image") else None,
                },
                source_weight=source.credibility_weight,
            ).with_external_id()
            items.append(item)

        return items[: self.max_per_source]

    async def _fetch_frontier_candidates(self, conn: asyncpg.Connection, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        rows = await conn.fetch(
            """
            SELECT canonical_url, url, page_type, last_crawled_at, last_status_code
            FROM crawl_frontier_urls
            WHERE page_type IN ('news', 'blog', 'changelog')
              AND COALESCE(last_status_code, 200) < 400
              AND COALESCE(last_crawled_at, discovered_at) >= $1
            ORDER BY COALESCE(last_crawled_at, discovered_at) DESC
            LIMIT $2
            """,
            cutoff,
            min(250, self.max_per_source * 4),
        )

        if not rows:
            return []

        sem = asyncio.Semaphore(10)

        async def parse_url(row: asyncpg.Record) -> Optional[NormalizedNewsItem]:
            url = str(row.get("url") or row.get("canonical_url") or "")
            if not url:
                return None
            if not is_likely_content_url(url):
                return None
            published = row.get("last_crawled_at") or datetime.now(timezone.utc)

            try:
                async with sem:
                    resp = await client.get(url)
                if resp.status_code >= 400:
                    return None
                html = resp.text or ""
                title, summary, page_published, image_url = extract_html_title_summary(html, source_url=url)
                if not title:
                    return None
                return NormalizedNewsItem(
                    source_key=source.source_key,
                    source_name=source.display_name,
                    source_type=source.source_type,
                    title=title[:300],
                    url=url,
                    canonical_url=canonicalize_url(url),
                    summary=(summary or "")[:300],
                    published_at=page_published or published,
                    language="en",
                    payload={
                        "origin": "frontier",
                        "page_type": row.get("page_type"),
                        "image_url": normalize_image_url(image_url, base_url=url) if image_url else None,
                    },
                    source_weight=source.credibility_weight,
                ).with_external_id()
            except Exception:
                return None

        out: List[NormalizedNewsItem] = []
        for chunk_start in range(0, len(rows), 30):
            chunk_rows = rows[chunk_start: chunk_start + 30]
            chunk_tasks = [parse_url(r) for r in chunk_rows]
            for item in await asyncio.gather(*chunk_tasks):
                if item is not None:
                    out.append(item)
                if len(out) >= self.max_per_source:
                    return out

        return out

    async def _fetch_startup_owned_sources(self, conn: asyncpg.Connection, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        startup_rows = await conn.fetch(
            """
            SELECT
              COALESCE(slug, '') AS slug,
              COALESCE(name, '') AS name,
              website
            FROM startups
            WHERE website IS NOT NULL
              AND TRIM(website) <> ''
            ORDER BY COALESCE(last_crawl_at, updated_at, created_at) DESC NULLS LAST
            LIMIT $1
            """,
            min(220, max(40, self.max_per_source * 5)),
        )
        if not startup_rows:
            return []

        candidate_inputs: List[Tuple[str, str, str]] = []
        for row in startup_rows:
            raw_website = str(row.get("website") or "").strip()
            slug = str(row.get("slug") or "").strip()
            name = str(row.get("name") or "").strip()
            if not raw_website:
                continue
            normalized = canonicalize_url(raw_website)
            parsed = urlparse(normalized)
            if not parsed.netloc:
                continue
            root = f"https://{parsed.netloc}".rstrip("/")
            for suffix in (
                "/blog/feed",
                "/news/feed",
                "/changelog/feed",
                "/feed",
                "/blog",
                "/news",
                "/changelog",
                "/updates",
                "/press",
            ):
                candidate_inputs.append((f"{root}{suffix}", slug, name))

        deduped_candidates: List[Tuple[str, str, str]] = []
        seen_urls: set[str] = set()
        for candidate in candidate_inputs:
            if candidate[0] in seen_urls:
                continue
            seen_urls.add(candidate[0])
            deduped_candidates.append(candidate)

        sem = asyncio.Semaphore(12)
        items: List[NormalizedNewsItem] = []

        async def parse_candidate(url: str, startup_slug: str, startup_name: str) -> List[NormalizedNewsItem]:
            try:
                async with sem:
                    resp = await client.get(url)
                if resp.status_code >= 400:
                    return []

                content_type = str(resp.headers.get("content-type") or "").lower()
                body = resp.text or ""
                out: List[NormalizedNewsItem] = []

                if ("/feed" in url or "xml" in content_type or "rss" in content_type) and feedparser is not None:
                    parsed_feed = feedparser.parse(body)
                    for entry in parsed_feed.entries[:2]:
                        title = normalize_text(entry.get("title", ""))
                        link = str(entry.get("link") or "")
                        if not title or not link:
                            continue
                        published = parse_entry_datetime(entry) or datetime.now(timezone.utc)
                        if published < cutoff:
                            continue

                        summary_html = entry.get("summary", entry.get("description", ""))
                        summary = normalize_text(re.sub(r"<[^>]+>", " ", summary_html or ""))[:280]
                        feed_image = _extract_rss_image(entry, link)
                        out.append(
                            NormalizedNewsItem(
                                source_key=source.source_key,
                                source_name=source.display_name,
                                source_type=source.source_type,
                                title=title[:300],
                                url=link,
                                canonical_url=canonicalize_url(link),
                                summary=summary,
                                published_at=published,
                                language="en",
                                payload={
                                    "origin": "startup_owned_feed",
                                    "startup_slug": startup_slug,
                                    "startup_name": startup_name,
                                    "image_url": feed_image or None,
                                },
                                source_weight=source.credibility_weight,
                            ).with_external_id()
                        )
                    return out

                title, summary, page_published, image_url = extract_html_title_summary(body, source_url=url)
                if not title:
                    return []
                out.append(
                    NormalizedNewsItem(
                        source_key=source.source_key,
                        source_name=source.display_name,
                        source_type=source.source_type,
                        title=title[:300],
                        url=url,
                        canonical_url=canonicalize_url(url),
                        summary=(summary or "")[:280],
                        published_at=page_published or datetime.now(timezone.utc),
                        language="en",
                        payload={
                            "origin": "startup_owned_page",
                            "startup_slug": startup_slug,
                            "startup_name": startup_name,
                            "image_url": normalize_image_url(image_url, base_url=url) if image_url else None,
                        },
                        source_weight=source.credibility_weight,
                    ).with_external_id()
                )
                return out
            except Exception:
                return []

        for idx in range(0, len(deduped_candidates), 24):
            chunk = deduped_candidates[idx: idx + 24]
            chunk_tasks = [parse_candidate(url, slug, name) for url, slug, name in chunk]
            for produced in await asyncio.gather(*chunk_tasks):
                if produced:
                    items.extend(produced)
                if len(items) >= self.max_per_source:
                    return items[: self.max_per_source]

        return items[: self.max_per_source]

    async def _collect_items(self, conn: asyncpg.Connection, lookback_hours: int) -> Tuple[List[NormalizedNewsItem], List[str], int]:
        errors: List[str] = []
        attempted = 0
        collected: List[NormalizedNewsItem] = []

        timeout = httpx.Timeout(self.http_timeout)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers={"User-Agent": "BuildAtlasNewsBot/2026 (+https://buildatlas.net)"}) as client:
            for source in DEFAULT_SOURCES:
                attempted += 1
                try:
                    if source.fetch_mode == "rss":
                        items = await self._fetch_rss_source(client, source, lookback_hours)
                    elif source.source_key == "hackernews_api":
                        items = await self._fetch_hackernews_api(client, source, lookback_hours)
                    elif source.source_key == "producthunt_api":
                        items = await self._fetch_producthunt_api(client, source)
                    elif source.source_key == "newsapi":
                        items = await self._fetch_newsapi(client, source, lookback_hours)
                    elif source.source_key == "gnews":
                        items = await self._fetch_gnews(client, source, lookback_hours)
                    elif source.source_key == "startup_owned_feeds":
                        items = await self._fetch_startup_owned_sources(conn, client, source, lookback_hours)
                    elif source.fetch_mode == "crawler":
                        items = await self._fetch_frontier_candidates(conn, client, source, lookback_hours)
                    else:
                        items = []

                    collected.extend(items)
                except Exception as exc:
                    errors.append(f"{source.source_key}: {exc}")

        # Canonical dedupe pass by source_key + canonical + title fingerprint
        seen: set[Tuple[str, str, str]] = set()
        deduped: List[NormalizedNewsItem] = []
        for item in collected:
            key = (item.source_key, item.canonical_url, title_fingerprint(item.title))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)

        return deduped, errors, attempted

    async def _insert_raw_items(self, conn: asyncpg.Connection, items: Sequence[NormalizedNewsItem]) -> int:
        source_ids = await self._get_source_id_map(conn)
        inserted = 0

        for item in items:
            source_id = source_ids.get(item.source_key)
            if not source_id:
                continue

            payload_json = json.dumps(item.payload or {})
            engagement_json = json.dumps(item.engagement or {})

            result = await conn.execute(
                """
                INSERT INTO news_items_raw (
                    source_id, external_id, url, canonical_url, title, summary_raw,
                    published_at, fetched_at, language, author, engagement_json, payload_json
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10::jsonb, $11::jsonb)
                ON CONFLICT (source_id, external_id) DO UPDATE
                SET title = EXCLUDED.title,
                    summary_raw = EXCLUDED.summary_raw,
                    published_at = COALESCE(EXCLUDED.published_at, news_items_raw.published_at),
                    fetched_at = NOW(),
                    language = EXCLUDED.language,
                    author = EXCLUDED.author,
                    engagement_json = EXCLUDED.engagement_json,
                    payload_json = EXCLUDED.payload_json
                """,
                source_id,
                item.external_id,
                item.url,
                item.canonical_url,
                item.title,
                item.summary,
                item.published_at,
                item.language,
                item.author,
                engagement_json,
                payload_json,
            )
            if result.startswith("INSERT"):
                inserted += 1

        return inserted

    async def _load_recent_items(self, conn: asyncpg.Connection, lookback_hours: int) -> List[NormalizedNewsItem]:
        since = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        rows = await conn.fetch(
            """
            SELECT
                ns.source_key,
                ns.display_name,
                ns.source_type,
                ns.credibility_weight,
                nir.external_id,
                nir.url,
                nir.canonical_url,
                nir.title,
                nir.summary_raw,
                COALESCE(nir.published_at, nir.fetched_at) AS published_at,
                nir.language,
                nir.author,
                nir.engagement_json,
                nir.payload_json
            FROM news_items_raw nir
            JOIN news_sources ns ON ns.id = nir.source_id
            WHERE COALESCE(nir.published_at, nir.fetched_at) >= $1
            ORDER BY COALESCE(nir.published_at, nir.fetched_at) DESC
            """,
            since,
        )

        items: List[NormalizedNewsItem] = []
        for row in rows:
            items.append(
                NormalizedNewsItem(
                    source_key=str(row["source_key"]),
                    source_name=str(row["display_name"]),
                    source_type=str(row["source_type"]),
                    title=normalize_text(str(row["title"] or ""))[:300],
                    url=str(row["url"]),
                    canonical_url=str(row["canonical_url"]),
                    summary=normalize_text(str(row["summary_raw"] or ""))[:300],
                    published_at=row["published_at"],
                    language=str(row["language"] or "en"),
                    author=row["author"],
                    external_id=str(row["external_id"]),
                    engagement=ensure_json_object(row["engagement_json"]),
                    payload=ensure_json_object(row["payload_json"]),
                    source_weight=float(row["credibility_weight"] or 0.65),
                )
            )
        return items

    def _is_same_story(self, item: NormalizedNewsItem, cluster: StoryCluster) -> bool:
        if item.canonical_url and cluster.canonical_url and item.canonical_url == cluster.canonical_url:
            return True

        sim = title_similarity(item.title, cluster.title)
        if sim >= 0.78:
            return True

        item_entities = set(extract_entities(item.title))
        cluster_entities = set(cluster.entities)
        overlap = bool(item_entities & cluster_entities)

        time_delta = abs((item.published_at - cluster.published_at).total_seconds()) / 3600.0
        if sim >= 0.55 and overlap and time_delta <= 72:
            return True

        return False

    def _cluster_items(self, items: Sequence[NormalizedNewsItem]) -> List[StoryCluster]:
        clusters: List[StoryCluster] = []

        for item in sorted(items, key=lambda x: x.published_at, reverse=True):
            placed = False
            for idx, cluster in enumerate(clusters):
                if self._is_same_story(item, cluster):
                    members = list(cluster.members)
                    members.append(item)

                    primary = sorted(members, key=lambda m: (m.source_weight, m.published_at), reverse=True)[0]
                    tags = classify_topic_tags(primary.title, primary.summary)
                    entities = extract_entities(primary.title)
                    rank_score, trust_score, reason = compute_cluster_scores(
                        published_at=max(m.published_at for m in members),
                        topic_tags=tags,
                        members=members,
                    )

                    clusters[idx] = StoryCluster(
                        cluster_key=cluster.cluster_key,
                        canonical_url=primary.canonical_url,
                        title=primary.title,
                        summary=primary.summary,
                        published_at=max(m.published_at for m in members),
                        topic_tags=tags,
                        entities=entities,
                        story_type=classify_story_type(tags),
                        rank_score=rank_score,
                        rank_reason=reason,
                        trust_score=trust_score,
                        builder_takeaway=build_builder_takeaway(
                            story_type=classify_story_type(tags),
                            tags=tags,
                            title=primary.title,
                            summary=primary.summary,
                            entities=entities,
                        ),
                        llm_summary=cluster.llm_summary,
                        llm_model=cluster.llm_model,
                        llm_signal_score=cluster.llm_signal_score,
                        llm_confidence_score=cluster.llm_confidence_score,
                        llm_topic_tags=list(cluster.llm_topic_tags),
                        llm_story_type=cluster.llm_story_type,
                        members=members,
                    )
                    placed = True
                    break

            if placed:
                continue

            tags = classify_topic_tags(item.title, item.summary)
            rank_score, trust_score, reason = compute_cluster_scores(
                published_at=item.published_at,
                topic_tags=tags,
                members=[item],
            )
            key_seed = f"{item.canonical_url}|{title_fingerprint(item.title)}"
            cluster_key = hashlib.sha1(key_seed.encode("utf-8")).hexdigest()[:28]
            clusters.append(
                StoryCluster(
                    cluster_key=cluster_key,
                    canonical_url=item.canonical_url,
                    title=item.title,
                    summary=item.summary,
                    published_at=item.published_at,
                    topic_tags=tags,
                    entities=extract_entities(item.title),
                    story_type=classify_story_type(tags),
                    rank_score=rank_score,
                    rank_reason=reason,
                    trust_score=trust_score,
                    builder_takeaway=build_builder_takeaway(
                        story_type=classify_story_type(tags),
                        tags=tags,
                        title=item.title,
                        summary=item.summary,
                        entities=extract_entities(item.title),
                    ),
                    llm_summary=None,
                    llm_model=None,
                    llm_signal_score=None,
                    llm_confidence_score=None,
                    llm_topic_tags=[],
                    llm_story_type=None,
                    members=[item],
                )
            )

        clusters.sort(key=lambda c: (c.rank_score, c.published_at), reverse=True)
        return clusters

    async def _llm_generate_daily_brief(self, *, edition_date: date, clusters: Sequence[StoryCluster]) -> Optional[Dict[str, Any]]:
        if not clusters:
            print("[news-ingest] daily brief skipped: no clusters")
            return None
        if not self.llm_daily_brief_enabled:
            print("[news-ingest] daily brief skipped: not enabled")
            return None
        if not self.openai_api_key and self.azure_client is None:
            print("[news-ingest] daily brief skipped: no API key / Azure client")
            return None

        top_n = min(len(clusters), max(3, int(self.llm_daily_brief_max_clusters)))
        top_clusters = list(clusters)[:top_n]

        prompt = (
            "You write a daily startup news brief for builders. "
            "Return strict JSON with keys: "
            "headline (<=70 chars), summary (<=320 chars), "
            "bullets (array of 3-5 strings, each <=110 chars), "
            "themes (array of up to 6 lowercase tags). "
            "Be concrete, avoid hype. No prose outside JSON."
        )

        def pick_summary(c: StoryCluster) -> str:
            return normalize_text(c.llm_summary or c.summary or c.rank_reason or "")

        user_payload = {
            "edition_date": edition_date.isoformat(),
            "top_clusters": [
                {
                    "title": c.title,
                    "story_type": c.story_type,
                    "topic_tags": list(c.topic_tags[:6]),
                    "summary": _shorten_text(pick_summary(c), 240),
                    "rank_score": float(round(c.rank_score, 4)),
                    "trust_score": float(round(c.trust_score, 4)),
                    "source_count": int(len(c.members)),
                }
                for c in top_clusters
            ],
        }

        def parse_daily_brief(parsed: Dict[str, Any], model_label: Optional[str]) -> Optional[Dict[str, Any]]:
            headline = _shorten_text(str(parsed.get("headline") or ""), 70)
            summary = _shorten_text(str(parsed.get("summary") or ""), 320)
            raw_bullets = parsed.get("bullets") or []
            bullets: List[str] = []
            if isinstance(raw_bullets, list):
                for b in raw_bullets:
                    if not b:
                        continue
                    bullets.append(_shorten_text(str(b), 110))
                    if len(bullets) >= 5:
                        break
            raw_themes = parsed.get("themes") or []
            themes: List[str] = []
            if isinstance(raw_themes, list):
                for t in raw_themes:
                    text = normalize_text(str(t)).lower()
                    if not text:
                        continue
                    # keep tags compact; normalize spaces to hyphens
                    text = re.sub(r"[^a-z0-9\\- ]+", "", text).strip().replace(" ", "-")
                    if text:
                        themes.append(text[:32])
                    if len(themes) >= 6:
                        break

            if not headline:
                return None

            return {
                "headline": headline,
                "summary": summary,
                "bullets": bullets,
                "themes": themes,
                "model": model_label,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        print(f"[news-ingest] generating daily brief for {edition_date} ({len(top_clusters)} clusters)")

        if self.azure_client is not None:
            for with_response_format in (True, False):
                azure_payload: Dict[str, Any] = {
                    "model": self.azure_openai_deployment,
                    "messages": [
                        {"role": "system", "content": prompt},
                        {"role": "user", "content": json.dumps(user_payload)},
                    ],
                    "temperature": 0.25,
                    "max_tokens": 340,
                }
                if with_response_format:
                    azure_payload["response_format"] = {"type": "json_object"}

                try:
                    response = await self.azure_client.chat.completions.create(**azure_payload)
                    content = ((response.choices or [None])[0].message.content if response.choices else "{}") or "{}"
                    parsed = json.loads(content) if isinstance(content, str) else {}
                    brief = parse_daily_brief(parsed, f"azure:{self.azure_openai_deployment}")
                    if brief is not None:
                        print(f"[news-ingest] daily brief generated via Azure: \"{brief.get('headline', '')}\"")
                        return brief
                    else:
                        mode = "json_object" if with_response_format else "no_response_format"
                        print(f"[news-ingest] Azure daily brief parse returned None ({mode}), content: {content[:200]}")
                except Exception as exc:
                    mode = "json_object" if with_response_format else "no_response_format"
                    print(f"[news-ingest] Azure daily brief failed ({mode}): {exc}")

        if self.openai_api_key:
            try:
                timeout = httpx.Timeout(self.http_timeout)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.openai_api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.llm_model,
                            "temperature": 0.25,
                            "max_tokens": 340,
                            "response_format": {"type": "json_object"},
                            "messages": [
                                {"role": "system", "content": prompt},
                                {"role": "user", "content": json.dumps(user_payload)},
                            ],
                        },
                    )
                    if response.status_code >= 400:
                        print(f"[news-ingest] OpenAI daily brief failed ({response.status_code}): {response.text[:200]}")
                        return None
                    payload = response.json() or {}
                    content = (
                        ((payload.get("choices") or [{}])[0].get("message") or {}).get("content")
                        or "{}"
                    )
                    parsed = json.loads(content) if isinstance(content, str) else {}
                    brief = parse_daily_brief(parsed, self.llm_model)
                    if brief is not None:
                        print(f"[news-ingest] daily brief generated via OpenAI: \"{brief.get('headline', '')}\"")
                    else:
                        print(f"[news-ingest] OpenAI daily brief parse returned None, content: {content[:200]}")
                    return brief
            except Exception as exc:
                print(f"[news-ingest] OpenAI daily brief exception: {exc}")
                return None

        print("[news-ingest] daily brief: no provider available")
        return None

    async def _llm_enrich_cluster(self, cluster: StoryCluster) -> LLMEnrichmentResult:
        if not self.openai_api_key and not self.azure_client:
            return LLMEnrichmentResult(None, None, None, None, None, None, None, error_code="no_provider")

        prompt = (
            "You are ranking startup news for builders. "
            "Return strict JSON with keys: "
            "summary (<=160 chars), builder_takeaway (<=140 chars), "
            "story_type (funding|launch|mna|regulation|hiring|news), "
            "topic_tags (array of up to 6 lowercase tags), "
            "signal_score (0-1), confidence_score (0-1). "
            "Be specific and practical. No prose outside JSON."
        )
        user_payload = {
            "title": cluster.title,
            "summary": cluster.summary,
            "story_type": cluster.story_type,
            "topic_tags": cluster.topic_tags[:6],
            "entities": cluster.entities[:6],
            "source_count": len(cluster.members),
            "rank_reason": cluster.rank_reason,
            "current_rank_score": cluster.rank_score,
            "current_trust_score": cluster.trust_score,
        }
        debug_llm = os.getenv("NEWS_LLM_DEBUG", "false").lower() in {"1", "true", "yes", "on"}

        def parse_llm_payload(parsed: Dict[str, Any], model_label: Optional[str]) -> LLMEnrichmentResult:
            llm_summary = _shorten_text(str(parsed.get("summary") or ""), 180) or None
            builder_takeaway = _shorten_text(str(parsed.get("builder_takeaway") or ""), 150) or None
            signal_score = clamp01(parsed.get("signal_score"), default=None)
            confidence_score = clamp01(parsed.get("confidence_score"), default=None)
            llm_topic_tags = normalize_llm_topic_tags(parsed.get("topic_tags"), cluster.topic_tags)
            llm_story_type = normalize_llm_story_type(parsed.get("story_type"), cluster.story_type)
            return LLMEnrichmentResult(
                llm_summary,
                builder_takeaway,
                model_label,
                signal_score,
                confidence_score,
                llm_topic_tags,
                llm_story_type,
            )

        last_error_code: Optional[str] = None
        if self.azure_client is not None:
            for with_response_format in (True, False):
                azure_payload: Dict[str, Any] = {
                    "model": self.azure_openai_deployment,
                    "messages": [
                        {"role": "system", "content": prompt},
                        {"role": "user", "content": json.dumps(user_payload)},
                    ],
                    "temperature": 0.2,
                    "max_tokens": 220,
                }
                if with_response_format:
                    azure_payload["response_format"] = {"type": "json_object"}

                try:
                    response = await self.azure_client.chat.completions.create(**azure_payload)
                    content = ((response.choices or [None])[0].message.content if response.choices else "{}") or "{}"
                    parsed = json.loads(content) if isinstance(content, str) else {}
                    return parse_llm_payload(parsed, f"azure:{self.azure_openai_deployment}")
                except Exception as exc:
                    if debug_llm:
                        mode = "json_object" if with_response_format else "no_response_format"
                        print(f"[news-ingest] Azure LLM enrichment failed ({mode}): {exc}")
                    last_error_code = "azure_timeout" if _is_timeout_exception(exc) else "azure_error"

        if self.openai_api_key:
            try:
                timeout = httpx.Timeout(self.http_timeout)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.openai_api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.llm_model,
                            "temperature": 0.2,
                            "max_tokens": 220,
                            "response_format": {"type": "json_object"},
                            "messages": [
                                {"role": "system", "content": prompt},
                                {"role": "user", "content": json.dumps(user_payload)},
                            ],
                        },
                    )
                    if response.status_code >= 400:
                        if debug_llm:
                            print(f"[news-ingest] OpenAI LLM enrichment failed ({response.status_code}): {response.text[:200]}")
                        return LLMEnrichmentResult(
                            None,
                            None,
                            None,
                            None,
                            None,
                            None,
                            None,
                            timed_out=False,
                            error_code=f"openai_http_{response.status_code}",
                        )
                    payload = response.json() or {}
                    content = (
                        ((payload.get("choices") or [{}])[0].get("message") or {}).get("content")
                        or "{}"
                    )
                    parsed = json.loads(content) if isinstance(content, str) else {}
                    return parse_llm_payload(parsed, self.llm_model)
            except Exception as exc:
                if debug_llm:
                    print(f"[news-ingest] OpenAI LLM enrichment exception: {exc}")
                is_timeout = _is_timeout_exception(exc)
                return LLMEnrichmentResult(
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    timed_out=is_timeout,
                    error_code="openai_timeout" if is_timeout else "openai_error",
                )

        return LLMEnrichmentResult(
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            error_code=last_error_code or "llm_unavailable",
        )

    async def _enrich_clusters_with_llm(self, clusters: Sequence[StoryCluster]) -> None:
        self._llm_metrics = {
            "enabled": bool(self.llm_enrichment_enabled),
            "model": self.llm_model,
            "max_clusters": int(self.llm_max_clusters),
            "concurrency": int(self.llm_concurrency),
            "attempted": 0,
            "succeeded": 0,
            "failed": 0,
            "timeouts": 0,
            "latency_ms_p50": 0.0,
            "latency_ms_p95": 0.0,
            "latency_ms_avg": 0.0,
        }
        if not clusters:
            return
        if not self.llm_enrichment_enabled or self.llm_max_clusters <= 0:
            return
        if not self.openai_api_key and self.azure_client is None:
            return

        top_n = min(len(clusters), self.llm_max_clusters)
        top_clusters = list(clusters)[:top_n]
        semaphore = asyncio.Semaphore(self.llm_concurrency)
        self._llm_metrics["attempted"] = int(top_n)

        async def enrich_one(
            cluster: StoryCluster,
        ) -> Tuple[StoryCluster, LLMEnrichmentResult, float]:
            async with semaphore:
                started = time.perf_counter()
                llm_result = await self._llm_enrich_cluster(cluster)
                latency_ms = (time.perf_counter() - started) * 1000.0
                return (cluster, llm_result, latency_ms)

        results = await asyncio.gather(*(enrich_one(cluster) for cluster in top_clusters))
        latencies_ms = [latency for _, _, latency in results]
        succeeded = 0
        timeout_count = 0

        for (cluster, llm_result, _) in results:
            llm_summary = llm_result.llm_summary
            builder_takeaway = llm_result.builder_takeaway
            llm_model = llm_result.llm_model
            llm_signal_score = llm_result.llm_signal_score
            llm_confidence_score = llm_result.llm_confidence_score
            llm_topic_tags = llm_result.llm_topic_tags
            llm_story_type = llm_result.llm_story_type

            if llm_model:
                succeeded += 1
            if llm_result.timed_out:
                timeout_count += 1

            if llm_model:
                cluster.llm_model = llm_model
            if llm_summary:
                cluster.llm_summary = llm_summary
            if builder_takeaway:
                cluster.builder_takeaway = builder_takeaway
            if llm_topic_tags:
                cluster.llm_topic_tags = list(llm_topic_tags)
                cluster.topic_tags = list(llm_topic_tags)
            if llm_story_type:
                cluster.llm_story_type = llm_story_type
                cluster.story_type = llm_story_type
            if llm_signal_score is not None:
                cluster.llm_signal_score = llm_signal_score
                cluster.rank_score = max(0.0, min(1.0, cluster.rank_score * 0.75 + llm_signal_score * 0.25))
            if llm_confidence_score is not None:
                cluster.llm_confidence_score = llm_confidence_score
                cluster.trust_score = max(0.0, min(1.0, cluster.trust_score * 0.8 + llm_confidence_score * 0.2))
            if cluster.llm_model and "llm-enriched" not in cluster.rank_reason:
                cluster.rank_reason = f"{cluster.rank_reason}, llm-enriched"

        attempted = int(self._llm_metrics.get("attempted") or 0)
        failed = max(0, attempted - succeeded)
        self._llm_metrics["succeeded"] = int(succeeded)
        self._llm_metrics["failed"] = int(failed)
        self._llm_metrics["timeouts"] = int(timeout_count)
        if latencies_ms:
            self._llm_metrics["latency_ms_p50"] = round(_percentile(latencies_ms, 50), 2)
            self._llm_metrics["latency_ms_p95"] = round(_percentile(latencies_ms, 95), 2)
            self._llm_metrics["latency_ms_avg"] = round(sum(latencies_ms) / len(latencies_ms), 2)

        if isinstance(clusters, list):
            clusters.sort(key=lambda c: (c.rank_score, c.published_at), reverse=True)

    async def _enrich_missing_images(
        self,
        conn: asyncpg.Connection,
        clusters: Sequence[StoryCluster],
        *,
        max_fetches: int = 50,
    ) -> int:
        """Fetch og:image from article URLs for clusters where no member has an image."""
        needs_image: List[NormalizedNewsItem] = []
        for cluster in clusters:
            has_any_image = any(
                m.payload.get("image_url")
                for m in cluster.members
            )
            if has_any_image:
                continue
            # Pick the primary (highest-weight) member to fetch
            primary = sorted(
                cluster.members,
                key=lambda m: (m.source_weight, m.published_at),
                reverse=True,
            )[0]
            if primary.url and primary.url.startswith("http"):
                needs_image.append(primary)
            if len(needs_image) >= max_fetches:
                break

        if not needs_image:
            return 0

        sem = asyncio.Semaphore(8)
        enriched = 0
        source_id_map = await self._get_source_id_map(conn)
        timeout = httpx.Timeout(12.0)

        async def fetch_og_image(item: NormalizedNewsItem) -> bool:
            try:
                async with sem:
                    async with httpx.AsyncClient(
                        timeout=timeout,
                        follow_redirects=True,
                        headers={"User-Agent": "BuildAtlasNewsBot/2026 (+https://buildatlas.net)"},
                    ) as client:
                        resp = await client.get(item.url)
                if resp.status_code >= 400:
                    return False
                _, _, _, image_url = extract_html_title_summary(resp.text, source_url=item.url)
                if not image_url:
                    return False
                normalized = normalize_image_url(image_url, base_url=item.url)
                if not normalized:
                    return False
                item.payload["image_url"] = normalized
                # Persist the enriched payload back to DB
                source_id = source_id_map.get(item.source_key)
                if source_id:
                    await conn.execute(
                        """
                        UPDATE news_items_raw
                        SET payload_json = $3::jsonb
                        WHERE source_id = $1 AND external_id = $2
                        """,
                        source_id,
                        item.external_id,
                        json.dumps(item.payload),
                    )
                return True
            except Exception:
                return False

        for chunk_start in range(0, len(needs_image), 15):
            chunk = needs_image[chunk_start : chunk_start + 15]
            results = await asyncio.gather(*(fetch_og_image(m) for m in chunk))
            enriched += sum(1 for r in results if r)

        return enriched

    async def _persist_clusters(self, conn: asyncpg.Connection, clusters: Sequence[StoryCluster]) -> Dict[str, str]:
        # Build map from raw item external keys to IDs for linking.
        raw_rows = await conn.fetch("SELECT id::text, source_id::text, external_id FROM news_items_raw")
        source_id_map = await self._get_source_id_map(conn)
        raw_lookup: Dict[Tuple[str, str], str] = {}
        source_lookup: Dict[str, str] = {v: k for k, v in source_id_map.items()}
        for row in raw_rows:
            source_key = source_lookup.get(row["source_id"], "")
            if source_key:
                raw_lookup[(source_key, row["external_id"])] = row["id"]

        cluster_ids: Dict[str, str] = {}
        for cluster in clusters:
            cluster_id = await conn.fetchval(
                """
                INSERT INTO news_clusters (
                    cluster_key, canonical_url, title, summary, published_at, updated_at,
                    topic_tags, entities, story_type, source_count, rank_score, rank_reason, trust_score,
                    builder_takeaway, llm_summary, llm_model, llm_signal_score, llm_confidence_score,
                    llm_topic_tags, llm_story_type
                )
                VALUES ($1, $2, $3, $4, $5, NOW(), $6::text[], $7::text[], $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::text[], $19)
                ON CONFLICT (cluster_key) DO UPDATE
                SET canonical_url = EXCLUDED.canonical_url,
                    title = EXCLUDED.title,
                    summary = EXCLUDED.summary,
                    published_at = EXCLUDED.published_at,
                    updated_at = NOW(),
                    topic_tags = EXCLUDED.topic_tags,
                    entities = EXCLUDED.entities,
                    story_type = EXCLUDED.story_type,
                    source_count = EXCLUDED.source_count,
                    rank_score = EXCLUDED.rank_score,
                    rank_reason = EXCLUDED.rank_reason,
                    trust_score = EXCLUDED.trust_score,
                    builder_takeaway = EXCLUDED.builder_takeaway,
                    llm_summary = EXCLUDED.llm_summary,
                    llm_model = EXCLUDED.llm_model,
                    llm_signal_score = EXCLUDED.llm_signal_score,
                    llm_confidence_score = EXCLUDED.llm_confidence_score,
                    llm_topic_tags = EXCLUDED.llm_topic_tags,
                    llm_story_type = EXCLUDED.llm_story_type
                RETURNING id::text
                """,
                cluster.cluster_key,
                cluster.canonical_url,
                cluster.title,
                cluster.summary,
                cluster.published_at,
                cluster.topic_tags,
                cluster.entities,
                cluster.story_type,
                len(cluster.members),
                cluster.rank_score,
                cluster.rank_reason,
                cluster.trust_score,
                cluster.builder_takeaway,
                cluster.llm_summary,
                cluster.llm_model,
                cluster.llm_signal_score,
                cluster.llm_confidence_score,
                cluster.llm_topic_tags,
                cluster.llm_story_type,
            )
            if not cluster_id:
                continue

            cluster_ids[cluster.cluster_key] = str(cluster_id)
            await conn.execute("DELETE FROM news_cluster_items WHERE cluster_id = $1::uuid", str(cluster_id))

            ranked_members = sorted(cluster.members, key=lambda m: (m.source_weight, m.published_at), reverse=True)
            for i, member in enumerate(ranked_members):
                raw_id = raw_lookup.get((member.source_key, member.external_id))
                if not raw_id:
                    continue
                await conn.execute(
                    """
                    INSERT INTO news_cluster_items (cluster_id, raw_item_id, is_primary, source_rank)
                    VALUES ($1::uuid, $2::uuid, $3, $4)
                    ON CONFLICT (cluster_id, raw_item_id) DO UPDATE
                    SET is_primary = EXCLUDED.is_primary,
                        source_rank = EXCLUDED.source_rank
                    """,
                    str(cluster_id),
                    str(raw_id),
                    i == 0,
                    member.source_weight,
                )

        return cluster_ids

    async def _persist_edition(
        self,
        conn: asyncpg.Connection,
        *,
        edition_date: date,
        region: str,
        clusters: Sequence[StoryCluster],
        cluster_ids: Dict[str, str],
    ) -> Dict[str, Any]:
        ranked = sorted(clusters, key=lambda c: (c.rank_score, c.trust_score, c.published_at), reverse=True)
        top = ranked[:40]
        top_ids = [cluster_ids[c.cluster_key] for c in top if c.cluster_key in cluster_ids]

        story_type_counts: Dict[str, int] = {}
        topic_counts: Dict[str, int] = {}
        for c in clusters:
            story_type_counts[c.story_type] = story_type_counts.get(c.story_type, 0) + 1
            for t in c.topic_tags:
                topic_counts[t] = topic_counts.get(t, 0) + 1

        stats = {
            "total_clusters": len(clusters),
            "top_story_count": len(top_ids),
            "story_type_counts": story_type_counts,
            "topic_counts": dict(sorted(topic_counts.items(), key=lambda kv: kv[1], reverse=True)[:15]),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        daily_brief = await self._llm_generate_daily_brief(edition_date=edition_date, clusters=clusters)
        if daily_brief:
            stats["daily_brief"] = daily_brief

        await conn.execute(
            """
            INSERT INTO news_daily_editions (edition_date, region, generated_at, status, top_cluster_ids, stats_json)
            VALUES ($1, $2, NOW(), 'ready', $3::uuid[], $4::jsonb)
            ON CONFLICT (edition_date, region) DO UPDATE
            SET generated_at = NOW(),
                status = 'ready',
                top_cluster_ids = EXCLUDED.top_cluster_ids,
                stats_json = EXCLUDED.stats_json
            """,
            edition_date,
            region,
            top_ids,
            json.dumps(stats),
        )

        await conn.execute(
            "DELETE FROM news_topic_index WHERE edition_date = $1 AND region = $2",
            edition_date,
            region,
        )
        for c in clusters:
            cid = cluster_ids.get(c.cluster_key)
            if not cid:
                continue
            for topic in c.topic_tags:
                await conn.execute(
                    """
                    INSERT INTO news_topic_index (topic, cluster_id, edition_date, region, rank_score)
                    VALUES ($1, $2::uuid, $3, $4, $5)
                    ON CONFLICT (topic, cluster_id, edition_date, region) DO UPDATE
                    SET rank_score = EXCLUDED.rank_score
                    """,
                    topic,
                    cid,
                    edition_date,
                    region,
                    c.rank_score,
                )

        return stats

    async def run(
        self,
        *,
        lookback_hours: int = 48,
        edition_date: Optional[date] = None,
        rebuild_only: bool = False,
    ) -> Dict[str, Any]:
        await self.connect()
        assert self.pool is not None

        e_date = edition_date or datetime.now(timezone.utc).date()
        errors: List[str] = []

        async with self.pool.acquire() as conn:
            run_id = await conn.fetchval(
                """
                INSERT INTO news_ingestion_runs (started_at, status)
                VALUES (NOW(), 'running')
                RETURNING id::text
                """
            )

            items_fetched = 0
            items_kept = 0
            sources_attempted = 0

            try:
                await self._upsert_sources(conn, DEFAULT_SOURCES)

                if not rebuild_only:
                    collected, collect_errors, sources_attempted = await self._collect_items(conn, lookback_hours)
                    errors.extend(collect_errors)
                    items_fetched = len(collected)
                    items_kept = await self._insert_raw_items(conn, collected)

                items_for_clustering = await self._load_recent_items(conn, lookback_hours)
                clusters = self._cluster_items(items_for_clustering)
                await self._enrich_clusters_with_llm(clusters)
                images_enriched = await self._enrich_missing_images(conn, clusters)
                cluster_ids = await self._persist_clusters(conn, clusters)

                turkey_source_keys = {s.source_key for s in DEFAULT_SOURCES if (s.region or "global") == "turkey"}
                turkey_clusters = [c for c in clusters if any(m.source_key in turkey_source_keys for m in c.members)]

                global_stats = await self._persist_edition(
                    conn,
                    edition_date=e_date,
                    region="global",
                    clusters=clusters,
                    cluster_ids=cluster_ids,
                )
                turkey_stats = await self._persist_edition(
                    conn,
                    edition_date=e_date,
                    region="turkey",
                    clusters=turkey_clusters,
                    cluster_ids=cluster_ids,
                )

                stats = {
                    **global_stats,
                    "regions": {
                        "global_total_clusters": int(global_stats.get("total_clusters") or 0),
                        "turkey_total_clusters": int(turkey_stats.get("total_clusters") or 0),
                    },
                    "llm": dict(self._llm_metrics),
                }

                result = {
                    "run_id": run_id,
                    "status": "ready",
                    "edition_date": e_date.isoformat(),
                    "sources_attempted": sources_attempted,
                    "items_fetched": items_fetched,
                    "items_kept": items_kept,
                    "images_enriched": images_enriched,
                    "clusters_built": len(clusters),
                    "top_clusters": int(stats.get("top_story_count") or 0),
                    "llm_metrics": dict(self._llm_metrics),
                    "errors": errors,
                    "stats": stats,
                }

                await conn.execute(
                    """
                    UPDATE news_ingestion_runs
                    SET completed_at = NOW(),
                        status = 'success',
                        sources_attempted = $2,
                        items_fetched = $3,
                        items_kept = $4,
                        clusters_built = $5,
                        errors_json = $6::jsonb,
                        stats_json = $7::jsonb
                    WHERE id = $1::uuid
                    """,
                    str(run_id),
                    sources_attempted,
                    items_fetched,
                    items_kept,
                    len(clusters),
                    json.dumps(errors),
                    json.dumps(stats),
                )

                return result
            except Exception as exc:
                errors.append(str(exc))
                await conn.execute(
                    """
                    UPDATE news_ingestion_runs
                    SET completed_at = NOW(),
                        status = 'failed',
                        errors_json = $2::jsonb,
                        stats_json = $3::jsonb
                    WHERE id = $1::uuid
                    """,
                    str(run_id),
                    json.dumps(errors),
                    json.dumps({"edition_date": e_date.isoformat(), "llm": dict(self._llm_metrics)}),
                )
                raise


async def run_news_ingestion(
    *,
    lookback_hours: int = 48,
    edition_date: Optional[str] = None,
    rebuild_only: bool = False,
) -> Dict[str, Any]:
    if edition_date:
        try:
            parsed_date = datetime.strptime(edition_date, "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValueError("edition_date must be YYYY-MM-DD") from exc
    else:
        parsed_date = None

    ingestor = DailyNewsIngestor()
    try:
        return await ingestor.run(
            lookback_hours=max(1, int(lookback_hours)),
            edition_date=parsed_date,
            rebuild_only=bool(rebuild_only),
        )
    finally:
        await ingestor.close()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest daily startup news and build edition")
    parser.add_argument("--lookback-hours", type=int, default=48)
    parser.add_argument("--edition-date", type=str, default="")
    parser.add_argument("--rebuild-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    result = asyncio.run(
        run_news_ingestion(
            lookback_hours=args.lookback_hours,
            edition_date=args.edition_date or None,
            rebuild_only=args.rebuild_only,
        )
    )
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
