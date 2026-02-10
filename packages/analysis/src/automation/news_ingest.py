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
    from azure.identity import DefaultAzureCredential, get_bearer_token_provider
except Exception:  # pragma: no cover - optional import at module import time
    DefaultAzureCredential = None
    get_bearer_token_provider = None

try:
    import feedparser
except Exception:  # pragma: no cover - optional import at module import time
    feedparser = None

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover - optional import at module import time
    BeautifulSoup = None

try:
    # Used for Amazon "New Releases" scraping (optional).
    from playwright.async_api import async_playwright
except Exception:  # pragma: no cover - optional import at module import time
    async_playwright = None

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

TR_AI_KEYWORDS: Tuple[str, ...] = (
    "yapay zeka",
    "yapay-zeka",
    "ai",
    "llm",
    "genai",
    "generatif",
    "gpt",
    "agent",
    "rag",
    "inference",
    "model",
    "foundation model",
    "machine learning",
    "deep learning",
    "ml",
    "computer vision",
    "nlp",
)

TR_ECOSYSTEM_KEYWORDS: Tuple[str, ...] = (
    "startup",
    "start-up",
    "girişim",
    "giris",
    "yatırım",
    "yatirim",
    "fon",
    "fonlama",
    "yatirimci",
    "yatırımcı",
    "vc",
    "melek",
    "tohum",
    "seed",
    "series",
    "seri",
    "turda",
    "turunda",
    "degerleme",
    "değerleme",
    "satın",
    "satinal",
    "satın al",
    "acquisition",
    "exit",
    "halka arz",
    "ipo",
    "hiring",
    "işe al",
    "ise al",
    "acik pozisyon",
    "açık pozisyon",
    "teknopark",
    "tubitak",
    "tübitak",
    "kosgeb",
)

TR_STARTUP_CONTEXT_KEYWORDS: Tuple[str, ...] = (
    "startup",
    "start-up",
    "girişim",
    "giris",
    "şirket",
    "sirket",
    "company",
    "kurucu",
    "founder",
    "vc",
    "yatırım",
    "yatirim",
    "yatırımcı",
    "yatirimci",
    "fon",
)

TR_MNA_KEYWORDS: Tuple[str, ...] = (
    "satın al",
    "satinal",
    "acquisition",
    "exit",
    "ipo",
    "halka arz",
)

TR_DOMAIN_EXCLUDE_KEYWORDS: Tuple[str, ...] = (
    "alan adı",
    "alan adi",
    "alanadi",
    "domain",
    "domain name",
)

TR_POLICY_KEYWORDS: Tuple[str, ...] = (
    "regülasyon",
    "regulasyon",
    "düzenleme",
    "duzenleme",
    "yasa",
    "kanun",
    "yönetmelik",
    "yonetmelik",
    "kvkk",
    "ai act",
    "compliance",
    "policy",
    "law",
)

TR_CONTEXT_KEYWORDS: Tuple[str, ...] = (
    "türkiye",
    "turkiye",
    "turkey",
    "istanbul",
    "ankara",
    "izmir",
    "turkish",
    "türk",
    "turk",
)

TR_CONSUMER_EXCLUDE_KEYWORDS: Tuple[str, ...] = (
    "iphone",
    "ipad",
    "airpods",
    "apple",
    "samsung",
    "xiaomi",
    "huawei",
    "whatsapp",
    "youtube",
    "instagram",
    "tiktok",
    "facebook",
    "meta",
    "snapchat",
    "telegram",
    "spotify",
    "netflix",
    "prime video",
    "xbox",
    "game pass",
    "playstation",
    "nintendo",
    "a101",
    "bim",
    "migros",
)

TR_BIGTECH_KEYWORDS: Tuple[str, ...] = (
    "openai",
    "google",
    "meta",
    "microsoft",
    "amazon",
    "apple",
    "samsung",
    "huawei",
    "anthropic",
    "nvidia",
    "tesla",
    "crypto.com",
    "coinbase",
    "binance",
)


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
    language: str = ""  # override auto-detection (e.g. "en" for English Turkey sources)


BOOL_TRUE = {"1", "true", "yes", "on"}


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip()
    if not raw:
        return bool(default)
    return raw.lower() in BOOL_TRUE


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return int(default)
    try:
        return int(raw)
    except Exception:
        return int(default)


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return float(default)
    try:
        return float(raw)
    except Exception:
        return float(default)


# 30+ sources across publishers, community, and aggregators.
DEFAULT_SOURCES: List[SourceDefinition] = [
    SourceDefinition("techcrunch", "TechCrunch", "rss", "https://techcrunch.com/feed/", credibility_weight=0.92),
    SourceDefinition("techcrunch_startups", "TechCrunch Startups", "rss", "https://techcrunch.com/category/startups/feed/", credibility_weight=0.94),
    SourceDefinition("venturebeat", "VentureBeat", "rss", "https://venturebeat.com/feed/", credibility_weight=0.86),
    SourceDefinition("wired", "WIRED", "rss", "https://www.wired.com/feed/rss", credibility_weight=0.80),
    SourceDefinition("sifted", "Sifted", "rss", "https://sifted.eu/feed", credibility_weight=0.78),
    SourceDefinition("crunchbase_news", "Crunchbase News", "rss", "https://news.crunchbase.com/feed/", credibility_weight=0.85),
    SourceDefinition("webrazzi", "Webrazzi", "rss", "https://webrazzi.com/feed/", region="turkey", credibility_weight=0.74),
    SourceDefinition("egirisim", "Egirisim", "rss", "https://egirisim.com/feed/", region="turkey", credibility_weight=0.70),
    # Turkey: API sources (Turkish language queries via existing API keys)
    SourceDefinition("gnews_turkey", "GNews Turkey", "api", "https://gnews.io/api/v4/search", region="turkey", fetch_mode="api", credibility_weight=0.66),
    SourceDefinition("newsapi_turkey", "NewsAPI Turkey", "api", "https://newsapi.org/v2/everything", region="turkey", fetch_mode="api", credibility_weight=0.67),
    # Turkey: Additional RSS sources (Turkish ecosystem-focused)
    SourceDefinition("foundern", "FounderN", "rss", "https://foundern.com/feed/", region="turkey", credibility_weight=0.72, language="en"),
    SourceDefinition("swipeline", "Swipeline", "rss", "https://swipeline.co/feed/", region="turkey", credibility_weight=0.70, language="en"),
    SourceDefinition("n24_business", "N24 Business", "rss", "https://n24.com.tr/feed", region="turkey", credibility_weight=0.60),
    SourceDefinition("daily_sabah_tech", "Daily Sabah Tech", "rss", "https://www.dailysabah.com/rss/business/tech", region="turkey", credibility_weight=0.58, language="en"),
    SourceDefinition("startups_watch", "Startups.watch", "rss", "https://medium.com/feed/startups-watch", region="turkey", credibility_weight=0.75, language="en"),
    # NOTE: Consumer-tech feeds (e.g. phone/app updates) are intentionally excluded from the Turkey edition.
    SourceDefinition("producthunt_feed", "Product Hunt Feed", "rss", "https://www.producthunt.com/feed", credibility_weight=0.82),
    SourceDefinition("entrepreneur", "Entrepreneur", "rss", "https://www.entrepreneur.com/latest.rss", credibility_weight=0.72),
    SourceDefinition("inc", "Inc", "rss", "https://www.inc.com/rss", credibility_weight=0.74),
    SourceDefinition("fastcompany", "Fast Company", "rss", "https://www.fastcompany.com/rss", credibility_weight=0.75),
    SourceDefinition("techeu", "Tech.eu", "rss", "https://tech.eu/feed/", credibility_weight=0.81),
    SourceDefinition("mashable", "Mashable", "rss", "https://mashable.com/feeds/rss/all", credibility_weight=0.68),
    SourceDefinition("hackernoon", "HackerNoon", "rss", "https://hackernoon.com/feed", credibility_weight=0.64),
    SourceDefinition("yc_blog", "Y Combinator Blog", "rss", "https://www.ycombinator.com/blog/rss/", credibility_weight=0.78),
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
    # Diff-based sources (daily snapshots + deltas), fetched from the hourly job.
    SourceDefinition("github_trending_ai", "GitHub Trending AI (Search)", "api", "github://search/repositories", fetch_mode="api", credibility_weight=0.70),
    SourceDefinition("amazon_new_releases_ai", "Amazon New Releases (AI Books)", "community", "amazon://new-releases", fetch_mode="api", credibility_weight=0.55),
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
    primary_source_key: str
    primary_external_id: str
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
    # Memory gate fields (populated by MemoryGate.process_cluster)
    memory_result: Optional[Any] = None  # MemoryResult from memory_gate.py
    # Gating fields (populated by _run_scoring_and_gating)
    gating_decision: Optional[str] = None  # publish/borderline/watchlist/accumulate/drop
    gating_scores: Optional[Dict[str, Any]] = None
    gating_patterns: Optional[List[Tuple[str, float]]] = None
    gating_gtm_tags: Optional[List[str]] = None
    gating_delivery_model: Optional[str] = None
    gating_reason: Optional[str] = None


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


def _is_unsupported_temperature_exception(exc: Exception) -> bool:
    text = str(exc).lower()
    if "temperature" not in text:
        return False
    # Azure/OpenAI error variants we have observed in the wild:
    # - "Unsupported value: 'temperature' does not support 0.25 with this model. Only the default (1) value is supported."
    # - "temperature is not supported with this model"
    return (
        "unsupported value" in text
        or "does not support" in text
        or "only the default (1)" in text
        or "not support" in text
    )


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


def _utc_midnight(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)


def _stable_external_id(*parts: Any) -> str:
    """Deterministic external_id for diff-style sources.

    Hourly runs should upsert, not duplicate.
    """
    cleaned: List[str] = []
    for part in parts:
        if part is None:
            continue
        text = str(part).strip()
        if not text:
            continue
        cleaned.append(text)
    base = "|".join(cleaned)
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:24]


_AMAZON_ASIN_RE = re.compile(r"/(?:dp|gp/product)/([A-Z0-9]{10})", re.IGNORECASE)


def _extract_amazon_asin(value: str) -> str:
    m = _AMAZON_ASIN_RE.search(value or "")
    if not m:
        return ""
    return str(m.group(1) or "").upper()


def _is_amazon_bot_page(html: str) -> bool:
    lower = (html or "").lower()
    if not lower:
        return False
    if "robot check" in lower:
        return True
    if "validatecaptcha" in lower or "/errors/validatecaptcha" in lower:
        return True
    if "captcha" in lower and "enter the characters you see below" in lower:
        return True
    return False


def _parse_amazon_new_releases_html(html: str, *, category_url: str, max_items: int) -> List[Dict[str, Any]]:
    """Best-effort parser for Amazon "New Releases" pages.

    We only extract lightweight metadata (ASIN/title/author/rank) for diff alerts.
    """
    if not html:
        return []
    if _is_amazon_bot_page(html):
        return []

    host = urlparse(category_url or "").netloc or "www.amazon.com"
    host = host.strip() or "www.amazon.com"

    if BeautifulSoup is not None:
        soup = BeautifulSoup(html, "html.parser")

        # 1) Legacy: ordered list with explicit rank positions.
        ordered = soup.select_one("ol#zg-ordered-list")
        if ordered is not None:
            out: List[Dict[str, Any]] = []
            for li in ordered.find_all("li", recursive=False):
                if len(out) >= max(1, max_items):
                    break
                asin = ""
                link_tag = li.find("a", href=True)
                if link_tag and link_tag.get("href"):
                    asin = _extract_amazon_asin(str(link_tag.get("href")))
                if not asin:
                    asin = _extract_amazon_asin(str(li))
                if not asin:
                    continue

                title = ""
                img = li.find("img", alt=True)
                if img and img.get("alt"):
                    candidate = normalize_text(str(img.get("alt") or ""))
                    if candidate and candidate.lower() not in {"product image", "image"}:
                        title = candidate
                if not title and link_tag:
                    title = normalize_text(link_tag.get_text(" ", strip=True))

                author = ""
                for a in li.find_all("a", href=True):
                    classes = " ".join(a.get("class") or [])
                    if "a-link-child" not in classes:
                        continue
                    txt = normalize_text(a.get_text(" ", strip=True))
                    if txt and txt != title:
                        author = f"{author}, {txt}".strip(", ") if author else txt
                    if len(author) >= 120:
                        break

                out.append(
                    {
                        "asin": asin,
                        "canonical_url": canonicalize_url(f"https://{host}/dp/{asin}"),
                        "title": title,
                        "author": author,
                    }
                )

            for idx, item in enumerate(out):
                item["rank"] = idx + 1
            if out:
                return out

        # 2) Current (Feb 2026): grid list with `data-asin` and rank badge.
        grid: List[Dict[str, Any]] = []
        for li in soup.select("ol li.zg-no-numbers"):
            if len(grid) >= max(1, max_items):
                break

            asin = ""
            asin_node = li.find(attrs={"data-asin": True})
            if asin_node is not None:
                asin = str(asin_node.get("data-asin") or "").strip().upper()
            if not asin:
                asin = _extract_amazon_asin(str(li))
            if not asin:
                continue

            title = ""
            img = li.find("img", alt=True)
            if img and img.get("alt"):
                candidate = normalize_text(str(img.get("alt") or ""))
                if candidate and candidate.lower() not in {"product image", "image"}:
                    title = candidate

            author = ""
            for a in li.find_all("a", href=True):
                classes = " ".join(a.get("class") or [])
                if "a-link-child" not in classes:
                    continue
                txt = normalize_text(a.get_text(" ", strip=True))
                if txt and txt != title:
                    author = f"{author}, {txt}".strip(", ") if author else txt
                if len(author) >= 120:
                    break

            rank = 0
            badge = li.select_one("span.zg-bdg-text")
            if badge is not None:
                m = re.search(r"#\\s*(\\d+)", badge.get_text(" ", strip=True))
                if m:
                    try:
                        rank = int(m.group(1))
                    except Exception:
                        rank = 0
            if not rank:
                rank = len(grid) + 1

            grid.append(
                {
                    "asin": asin,
                    "canonical_url": canonicalize_url(f"https://{host}/dp/{asin}"),
                    "title": title,
                    "author": author,
                    "rank": rank,
                }
            )

        if grid:
            return grid

    # 3) Fallback: regex scan links; rank is appearance order.
    asins: List[str] = []
    seen: set[str] = set()
    for match in _AMAZON_ASIN_RE.finditer(html):
        asin = str(match.group(1) or "").upper()
        if not asin or asin in seen:
            continue
        seen.add(asin)
        asins.append(asin)
        if len(asins) >= max(1, max_items):
            break

    out: List[Dict[str, Any]] = []
    for idx, asin in enumerate(asins):
        out.append(
            {
                "asin": asin,
                "canonical_url": canonicalize_url(f"https://{host}/dp/{asin}"),
                "title": "",
                "author": "",
                "rank": idx + 1,
            }
        )
    return out


def _azure_token_param_name(model_name: str) -> str:
    """Azure OpenAI model families can differ in token limit parameter names.

    Empirically (Feb 2026), some deployments reject `max_tokens` and require
    `max_completion_tokens` instead (e.g. GPT-5 family).
    """
    m = (model_name or "").strip().lower()
    if m.startswith("gpt-5") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4"):
        return "max_completion_tokens"
    return "max_tokens"


def _azure_token_budget(model_name: str, desired_output_tokens: int) -> int:
    """Scale token budget for reasoning models that consume tokens for internal reasoning.

    GPT-5 and o-series models use reasoning tokens (~512+) before producing output.
    ``max_completion_tokens`` covers both reasoning + output, so we scale up 3x
    to leave room for the actual output after reasoning.
    """
    m = (model_name or "").strip().lower()
    if m.startswith("gpt-5") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4"):
        return desired_output_tokens * 3
    return desired_output_tokens

def _azure_supports_temperature(model_name: str) -> bool:
    """
    Some Azure deployments (notably GPT-5 family, Feb 2026) reject non-default
    temperature values. Keep requests compatible by omitting `temperature`.
    """
    m = (model_name or "").strip().lower()
    if not m:
        return True
    if m.startswith("gpt-5"):
        return False
    if m.startswith("o1") or m.startswith("o3") or m.startswith("o4"):
        return False
    return True


def _azure_supports_reasoning_effort(model_name: str) -> bool:
    """Whether Azure accepts `reasoning.effort` for this deployment.

    In practice this is supported on the GPT-5 family via the Responses API.
    """
    m = (model_name or "").strip().lower()
    return bool(m) and m.startswith("gpt-5")


def _contains_any(haystack: str, needles: Sequence[str]) -> bool:
    """
    Conservative keyword matcher tuned for Turkish content.

    Important: avoid naive substring matching for short tokens (e.g. "tur", "ai")
    because Turkish text contains many incidental overlaps (false positives).
    """
    h = (haystack or "").casefold()
    if not h:
        return False

    # Treat these chars as "word" characters for boundary checks.
    # (Python's \\b is not great with mixed-language + punctuation.)
    word_chars = r"0-9a-zA-ZçğıöşüÇĞİÖŞÜıİ"

    for raw in needles:
        n = (raw or "").strip()
        if not n:
            continue
        k = n.casefold()
        if not k:
            continue

        # If it's a single "word" token (no spaces) prefer boundary matching.
        # This prevents hits like "tur" in "turkiye", or "ai" in "mail".
        is_single_token = " " not in k and "\t" not in k and "\n" not in k
        is_alnumish = re.fullmatch(rf"[{word_chars}]+", k) is not None
        if is_single_token and is_alnumish:
            if re.search(rf"(?<![{word_chars}]){re.escape(k)}(?![{word_chars}])", h):
                return True
            continue

        # Multi-word / punctuated keywords: substring is fine.
        if k in h:
            return True

    return False


def _is_relevant_turkey_news_item(item: "NormalizedNewsItem") -> bool:
    """
    Turkey feed should be "AI startup / AI systems" intelligence, not general consumer tech.

    Rules (heuristic, intentionally conservative):
    - Must mention AI (broad).
    - Must indicate startup/ecosystem relevance (funding, startup terms, hiring, policy) OR be a Turkey startup-owned item.
    - Exclude consumer product / retail chatter unless it is clearly ecosystem-relevant.
    - Exclude global big-tech product updates in the Turkey feed unless they are framed as ecosystem events.
    """
    if item.source_key == "startup_owned_feeds":
        country = str((item.payload or {}).get("startup_country") or "").strip().lower()
        if country != "turkey":
            return False
        # Avoid index/listing pages (blog/news landing pages are not "news items").
        if not is_likely_content_url(item.url or item.canonical_url or ""):
            return False
        # Treat startup-owned pages as signals only when they are clearly AI-related.
        text = f"{item.title} {item.summary or ''}".strip().casefold()
        return _contains_any(text, TR_AI_KEYWORDS)

    text = f"{item.title} {item.summary or ''}".strip().casefold()

    has_ai = _contains_any(text, TR_AI_KEYWORDS)
    if not has_ai:
        return False

    has_policy = _contains_any(text, TR_POLICY_KEYWORDS)
    has_startup_context = _contains_any(text, TR_STARTUP_CONTEXT_KEYWORDS)
    has_mna = _contains_any(text, TR_MNA_KEYWORDS)
    # "Ecosystem relevance" needs to be about companies/deals, not generic purchases (e.g. domain names).
    has_ecosystem = _contains_any(text, TR_ECOSYSTEM_KEYWORDS)
    has_strong_ecosystem = has_ecosystem and (has_startup_context or ("yatırım" in text) or ("yatirim" in text))
    # Trusted Turkey RSS sources get a lighter gate — ecosystem alone is enough.
    # API aggregators (gnews, newsapi) and Daily Sabah keep the strict filter.
    is_trusted_rss = item.source_key in {"webrazzi", "egirisim", "foundern", "swipeline", "n24_business", "startups_watch"}
    if is_trusted_rss:
        if not (has_policy or has_ecosystem or has_mna):
            return False
    else:
        if not (has_policy or has_strong_ecosystem or (has_mna and has_startup_context)):
            return False

    # For broad Turkish aggregators, require explicit Turkey context so we don't pull translated global chatter.
    if item.source_key in {"gnews_turkey", "newsapi_turkey"}:
        if not _contains_any(text, TR_CONTEXT_KEYWORDS) and not has_ecosystem:
            return False

    # Domain/SEO chatter often matches "ai" and "satın alındı" but is not startup intelligence.
    if _contains_any(text, TR_DOMAIN_EXCLUDE_KEYWORDS) and not (has_policy or has_strong_ecosystem):
        return False

    # Consumer exclusion: allow only if it's clearly an ecosystem signal (e.g. funding/acquisition)
    if _contains_any(text, TR_CONSUMER_EXCLUDE_KEYWORDS) and not (has_ecosystem or has_policy):
        return False

    # Big-tech exclusion: Turkey feed shouldn't be dominated by product updates from incumbents.
    # Require explicit Turkey context (not just generic ecosystem keywords) to override.
    # E.g. "Anthropic'in değerlemesi" has ecosystem keywords but no Turkey context → excluded.
    # But "Türk startup X, Anthropic'ten yatırım aldı" has Turkey context → allowed.
    if _contains_any(text, TR_BIGTECH_KEYWORDS):
        has_turkey_context = _contains_any(text, TR_CONTEXT_KEYWORDS)
        if not (has_policy or (has_strong_ecosystem and has_turkey_context)):
            return False

    return True


def _turkey_prefilter(item: "NormalizedNewsItem") -> bool:
    """Fast heuristic pre-filter: removes obvious noise before LLM classification.

    Catches consumer-tech, domain-flipping, and irrelevant startup-owned pages.
    Does NOT check AI keywords — that's the LLM's job.
    """
    # Startup-owned feeds: must be from Turkey and be a content URL
    if item.source_key == "startup_owned_feeds":
        country = str((item.payload or {}).get("startup_country") or "").strip().lower()
        if country != "turkey":
            return False
        if not is_likely_content_url(item.url or item.canonical_url or ""):
            return False
        return True

    text = f"{item.title} {item.summary or ''}".strip().casefold()

    # For broad API aggregators, require explicit Turkey context to avoid translated global chatter.
    if item.source_key in {"gnews_turkey", "newsapi_turkey"}:
        has_ecosystem = _contains_any(text, TR_ECOSYSTEM_KEYWORDS)
        if not _contains_any(text, TR_CONTEXT_KEYWORDS) and not has_ecosystem:
            return False

    # Domain/SEO chatter is never useful
    has_policy = _contains_any(text, TR_POLICY_KEYWORDS)
    has_ecosystem = _contains_any(text, TR_ECOSYSTEM_KEYWORDS)
    if _contains_any(text, TR_DOMAIN_EXCLUDE_KEYWORDS) and not (has_policy or has_ecosystem):
        return False

    # Consumer product noise (phone reviews, streaming, social media)
    if _contains_any(text, TR_CONSUMER_EXCLUDE_KEYWORDS) and not (has_ecosystem or has_policy):
        return False

    # Big-tech product updates that aren't ecosystem-relevant
    if _contains_any(text, TR_BIGTECH_KEYWORDS) and not (has_ecosystem or has_policy):
        return False

    return True


def _build_turkey_cluster(c: "StoryCluster", turkey_source_keys: set) -> Optional["StoryCluster"]:
    """Create a Turkey-specific version of a cluster, or None if not Turkey-relevant.

    Includes:
    - Turkey-tagged sources (and Turkey startup-owned sources)
    - Global sources only when the item has explicit Turkey context (e.g. global press
      covering a Turkish startup), to avoid translated/global chatter dominating TR.

    Then:
    - Applies strict TR relevance checks (AI + ecosystem/policy context)
    - Selects a representative article (prefer Turkish-language when available)
    """
    candidate_members: List[NormalizedNewsItem] = []
    for m in c.members:
        if m.source_key in turkey_source_keys or m.source_key == "startup_owned_feeds":
            candidate_members.append(m)
            continue

        # Global sources: require explicit Turkey context.
        text = f"{m.title} {m.summary or ''}".strip().casefold()
        if _contains_any(text, TR_CONTEXT_KEYWORDS):
            candidate_members.append(m)

    if not candidate_members:
        return None

    # Apply strict relevance filter — must be about Turkish ecosystem,
    # not just from a Turkey source reporting on global news.
    relevant_members = [m for m in candidate_members if _is_relevant_turkey_news_item(m)]
    if not relevant_members:
        return None

    # Prefer Turkish-language members for the Turkey edition.
    # Representative selection prefers Turkish, but we keep all relevant members
    # so cross-source counts remain meaningful (e.g. TR RSS + global coverage).
    primary_candidates = [m for m in relevant_members if m.language == "tr"] or relevant_members

    primary = sorted(primary_candidates, key=lambda m: (m.source_weight, m.published_at), reverse=True)[0]
    tags = classify_topic_tags(primary.title, primary.summary)
    rank_score, trust_score, reason = compute_cluster_scores(
        published_at=max(m.published_at for m in relevant_members),
        topic_tags=tags,
        members=relevant_members,
    )

    return StoryCluster(
        cluster_key=c.cluster_key,
        primary_source_key=primary.source_key,
        primary_external_id=primary.external_id,
        canonical_url=primary.canonical_url,
        title=primary.title,
        summary=primary.summary,
        published_at=max(m.published_at for m in relevant_members),
        topic_tags=tags,
        entities=extract_entities(primary.title),
        story_type=classify_story_type(tags),
        rank_score=rank_score,
        rank_reason=reason,
        trust_score=trust_score,
        builder_takeaway=c.builder_takeaway,
        llm_summary=c.llm_summary,
        llm_model=c.llm_model,
        llm_signal_score=c.llm_signal_score,
        llm_confidence_score=c.llm_confidence_score,
        llm_topic_tags=list(c.llm_topic_tags),
        llm_story_type=c.llm_story_type,
        members=relevant_members,
    )


_TURKEY_RELEVANCE_PROMPT = """\
You are a relevance classifier for a Turkish AI startup intelligence feed.

For each article, respond YES or NO.

YES = Article is about AI/ML/tech startups in the Turkish ecosystem:
- Turkish startups building or using AI/ML (funding, launch, M&A, hiring)
- AI technology being applied by Turkish companies
- Turkish tech policy or regulation related to AI
- Turkish VC/investment activity in AI/tech startups
- AI infrastructure, research, or tooling with clear Turkish ecosystem relevance

NO = Not relevant:
- Consumer tech (phone reviews, app updates, streaming services)
- Big-tech global product news without Turkish ecosystem impact
- General business/economy not involving tech startups or AI
- Non-Turkish startup news that happens to be in Turkish language
- Generic tech tutorials, listicles, or opinion pieces without startup/AI substance

Articles:
{articles}

Respond ONLY with a JSON array of booleans, one per article. Example: [true, false, true]"""


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

    if "ai" in tags or "machine learning" in tags or "llm" in tags:
        if _contains_any(text, ["infrastructure", "cloud", "compute", "gpu", "data center", "chip", "semiconductor"]):
            return _shorten_text(f"{focus} is building at the infrastructure layer. Builders should watch pricing signals and capacity constraints that affect downstream costs.")
        if _contains_any(text, ["developer", "api", "sdk", "platform", "devtool", "open source", "open-source", "framework"]):
            return _shorten_text(f"{focus} targets the developer layer. Evaluate lock-in risk, migration cost, and whether the abstraction ages well before adopting.")
        if _contains_any(text, ["agent", "agentic", "autonomous", "orchestrat", "workflow", "automat"]):
            return _shorten_text(f"{focus} is in the agentic space. Builders should watch for reliability benchmarks and real-world failure modes before integrating.")
        if _contains_any(text, ["data", "analytics", "observab", "monitoring", "eval", "benchmark"]):
            return _shorten_text(f"{focus} is tackling the data/eval layer. Prioritize integration depth and whether the product compounds with your existing data stack.")
        if _contains_any(text, ["security", "compliance", "governance", "privacy", "trust", "safety"]):
            return _shorten_text(f"{focus} addresses AI governance. Factor regulatory tailwinds and whether their approach becomes a de facto standard in your vertical.")
        if _contains_any(text, ["enterprise", "b2b", "saas", "vertical", "industry"]):
            return _shorten_text(f"{focus} is going vertical. Builders in the same space should assess whether this narrows or expands the addressable integration surface.")
        return _shorten_text(f"{focus} signals momentum in the AI landscape. Builders should assess whether this shifts build-vs-buy math for their current roadmap.")

    if _contains_any(text, ["hiring", "hire", "team", "talent", "layoff", "headcount"]):
        return _shorten_text(f"{focus} is reshaping its team. Watch whether talent moves signal a strategic pivot or just operational scaling.")

    if _contains_any(text, ["partner", "integrat", "ecosystem", "alliance", "collaborat"]):
        return _shorten_text(f"{focus} is expanding its ecosystem. Builders should evaluate whether this opens new integration paths or creates dependency risk.")

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
        self.github_token = os.getenv("GITHUB_TOKEN", "")
        self.github_trending_topics = os.getenv("GITHUB_TRENDING_TOPICS", "artificial-intelligence,llm,generative-ai")
        self.github_trending_created_days = _env_int("GITHUB_TRENDING_CREATED_DAYS", 30)
        self.github_trending_min_stars = _env_int("GITHUB_TRENDING_MIN_STARS", 50)
        self.github_trending_limit = _env_int("GITHUB_TRENDING_LIMIT", 30)
        self.github_trending_min_star_delta = _env_int("GITHUB_TRENDING_MIN_STAR_DELTA", 50)
        self.amazon_new_releases_urls = os.getenv("AMAZON_NEW_RELEASES_URLS", "")
        self.amazon_new_releases_max_items = _env_int("AMAZON_NEW_RELEASES_MAX_ITEMS", 30)
        self.amazon_new_releases_min_rank_delta = _env_int("AMAZON_NEW_RELEASES_MIN_RANK_DELTA", 10)
        self.amazon_playwright_timeout_ms = _env_int("AMAZON_PLAYWRIGHT_TIMEOUT_MS", 20000)
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "")
        self.azure_openai_api_key = os.getenv("AZURE_OPENAI_API_KEY", "")
        self.azure_openai_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
        self.azure_openai_api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01")
        # Azure uses *deployment names* as the model identifier.
        # Support both:
        # - AZURE_OPENAI_DEPLOYMENT_NAME (preferred)
        # - AZURE_OPENAI_DEPLOYMENT (legacy/back-compat)
        self.azure_openai_deployment = (
            os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
            or os.getenv("AZURE_OPENAI_DEPLOYMENT")
            or "gpt-5-nano"
        )
        # Safety net: if the configured deployment doesn't exist (404) or has
        # incompatible parameters, we try this fallback.
        self.azure_openai_fallback_deployment = (
            os.getenv("AZURE_OPENAI_FALLBACK_DEPLOYMENT_NAME") or "gpt-4o"
        )
        # Embedding deployment for semantic search (text-embedding-3-small)
        self.azure_openai_embedding_deployment = (
            os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-small")
        )
        # Daily briefs benefit from higher-quality synthesis. Prefer the "reasoning" deployment
        # (often gpt-5-mini) with low effort, but always fall back to the primary deployment.
        self.azure_openai_daily_brief_deployment = (
            os.getenv("AZURE_OPENAI_DAILY_BRIEF_DEPLOYMENT_NAME")
            or os.getenv("AZURE_OPENAI_REASONING_DEPLOYMENT_NAME")
            or self.azure_openai_deployment
        )
        self.azure_openai_daily_brief_effort = (
            os.getenv("AZURE_OPENAI_DAILY_BRIEF_EFFORT", "low").strip().lower() or "low"
        )
        self.llm_enrichment_enabled = os.getenv("NEWS_LLM_ENRICHMENT", "false").lower() in {"1", "true", "yes", "on"}
        self.llm_model = os.getenv("NEWS_LLM_MODEL", "gpt-5-nano")
        self.llm_max_clusters = max(0, int(os.getenv("NEWS_LLM_MAX_CLUSTERS", "200")))
        self.llm_concurrency = max(1, min(16, int(os.getenv("NEWS_LLM_CONCURRENCY", "8"))))
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
        if AsyncAzureOpenAI is not None and self.azure_openai_endpoint:
            if DefaultAzureCredential is not None:
                # Prefer AAD (managed identity / Azure CLI) — some resources disable key auth
                _credential = DefaultAzureCredential()
                _token_provider = get_bearer_token_provider(
                    _credential, "https://cognitiveservices.azure.com/.default"
                )
                self.azure_client = AsyncAzureOpenAI(
                    azure_ad_token_provider=_token_provider,
                    api_version=self.azure_openai_api_version,
                    azure_endpoint=self.azure_openai_endpoint,
                )
            elif self.azure_openai_api_key:
                # Fall back to API key if azure-identity not installed
                self.azure_client = AsyncAzureOpenAI(
                    api_key=self.azure_openai_api_key,
                    api_version=self.azure_openai_api_version,
                    azure_endpoint=self.azure_openai_endpoint,
                )

        # Schema feature flags (resolved at runtime in `run()`).
        self._regional_clusters_supported = False

        # Diagnostic: log daily brief prerequisites on startup
        _bp = []
        if self.azure_client is not None:
            _bp.append(f"Azure({self.azure_openai_daily_brief_deployment})")
        if self.openai_api_key:
            _bp.append("OpenAI")
        print(
            f"[news-ingest] brief config: enabled={self.llm_daily_brief_enabled} "
            f"providers=[{', '.join(_bp) or 'NONE'}] "
            f"endpoint={'set' if self.azure_openai_endpoint else 'MISSING'}"
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

    async def _supports_regional_clusters(self, conn: asyncpg.Connection) -> bool:
        """Whether `news_clusters` is region-aware (cluster_key, region uniqueness)."""
        try:
            val = await conn.fetchval(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'news_clusters' AND column_name = 'region'
                LIMIT 1
                """
            )
            return bool(val)
        except Exception:
            return False

    async def _build_raw_item_lookup(self, conn: asyncpg.Connection) -> Dict[Tuple[str, str], str]:
        """Map (source_key, external_id) -> raw_item_id for linking clusters to raw items.

        Note: This currently scans all `news_items_raw` rows. It's intentionally
        simple/robust, but can be optimized later if the table grows large.
        """
        raw_rows = await conn.fetch("SELECT id::text, source_id::text, external_id FROM news_items_raw")
        source_id_map = await self._get_source_id_map(conn)
        source_lookup: Dict[str, str] = {v: k for k, v in source_id_map.items()}
        raw_lookup: Dict[Tuple[str, str], str] = {}
        for row in raw_rows:
            source_key = source_lookup.get(row["source_id"], "")
            if source_key:
                raw_lookup[(source_key, row["external_id"])] = row["id"]
        return raw_lookup

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
                    is_active = true,
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

    async def _sync_source_activity(self, conn: asyncpg.Connection, sources: Sequence[SourceDefinition]) -> None:
        """
        Keep `news_sources.is_active` aligned with DEFAULT_SOURCES.

        This matters because:
        - The web UI uses `/api/v1/news/sources` to populate the Sources list.
        - We occasionally remove/replace sources; old rows should not stay "active"
          forever (otherwise Turkey feed UX shows consumer-tech sources we no longer ingest).
        """
        try:
            by_region: Dict[str, List[str]] = {}
            for src in sources:
                region = (src.region or "global").strip().lower() or "global"
                by_region.setdefault(region, [])
                if src.source_key not in by_region[region]:
                    by_region[region].append(src.source_key)

            for region, keys in by_region.items():
                if not keys:
                    continue
                await conn.execute(
                    """
                    UPDATE news_sources
                    SET is_active = (source_key = ANY($2::text[]))
                    WHERE region = $1
                    """,
                    region,
                    keys,
                )
        except Exception:
            # Back-compat: older schemas may not have is_active/region; don't fail ingestion.
            return

    def _github_headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.github_token:
            headers["Authorization"] = f"Bearer {self.github_token}"
        return headers

    async def _load_snapshot_payload_rows(
        self,
        conn: asyncpg.Connection,
        *,
        source_key: str,
        snapshot_date: str,
    ) -> List[Tuple[str, Dict[str, Any]]]:
        rows = await conn.fetch(
            """
            SELECT nir.canonical_url, nir.payload_json
            FROM news_items_raw nir
            JOIN news_sources ns ON ns.id = nir.source_id
            WHERE ns.source_key = $1
              AND COALESCE(nir.payload_json->>'kind', '') = 'snapshot'
              AND COALESCE(nir.payload_json->>'snapshot_date', '') = $2
            """,
            source_key,
            snapshot_date,
        )
        out: List[Tuple[str, Dict[str, Any]]] = []
        for row in rows:
            canonical = str(row.get("canonical_url") or "").strip()
            if not canonical:
                continue
            out.append((canonical, ensure_json_object(row.get("payload_json"))))
        return out

    async def _count_snapshot_rows(
        self,
        conn: asyncpg.Connection,
        *,
        source_key: str,
        snapshot_date: str,
        category_url: str = "",
    ) -> int:
        if category_url:
            value = await conn.fetchval(
                """
                SELECT COUNT(*)
                FROM news_items_raw nir
                JOIN news_sources ns ON ns.id = nir.source_id
                WHERE ns.source_key = $1
                  AND COALESCE(nir.payload_json->>'kind', '') = 'snapshot'
                  AND COALESCE(nir.payload_json->>'snapshot_date', '') = $2
                  AND COALESCE(nir.payload_json->>'category_url', '') = $3
                """,
                source_key,
                snapshot_date,
                category_url,
            )
        else:
            value = await conn.fetchval(
                """
                SELECT COUNT(*)
                FROM news_items_raw nir
                JOIN news_sources ns ON ns.id = nir.source_id
                WHERE ns.source_key = $1
                  AND COALESCE(nir.payload_json->>'kind', '') = 'snapshot'
                  AND COALESCE(nir.payload_json->>'snapshot_date', '') = $2
                """,
                source_key,
                snapshot_date,
            )
        try:
            return int(value or 0)
        except Exception:
            return 0

    @staticmethod
    def _detect_rss_language(source: SourceDefinition, parsed: Any) -> str:
        """Infer language for RSS items: explicit override > feed declaration > region fallback."""
        if source.language:
            return source.language
        feed_lang = str(getattr(parsed.feed, "language", "") or "").strip().lower()[:2]
        if feed_lang and len(feed_lang) == 2:
            return feed_lang
        if (source.region or "global") == "turkey":
            return "tr"
        return "en"

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
                language=self._detect_rss_language(source, parsed),
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

    async def _fetch_github_trending_ai(
        self,
        conn: asyncpg.Connection,
        client: httpx.AsyncClient,
        source: SourceDefinition,
        lookback_hours: int,
    ) -> List[NormalizedNewsItem]:
        del lookback_hours  # Diff sources are daily snapshots, not lookback-window feeds.

        today = datetime.now(timezone.utc).date()
        snapshot_date = today.isoformat()
        yesterday_date = (today - timedelta(days=1)).isoformat()
        today_midnight = _utc_midnight(today)
        hidden_published_at = today_midnight - timedelta(days=30)

        limit = max(1, min(100, int(self.github_trending_limit)))
        created_days = max(1, int(self.github_trending_created_days))
        created_cutoff = (today - timedelta(days=created_days)).isoformat()
        min_stars = max(0, int(self.github_trending_min_stars))
        min_star_delta = max(1, int(self.github_trending_min_star_delta))

        # Avoid unnecessary hourly calls if today's snapshot is already present.
        existing = await self._count_snapshot_rows(conn, source_key=source.source_key, snapshot_date=snapshot_date)
        if existing >= max(5, min(12, limit // 2)):
            return []

        topics: List[str] = []
        for raw in (self.github_trending_topics or "").split(","):
            t = raw.strip()
            if t and t not in topics:
                topics.append(t)
        if not topics:
            topics = ["artificial-intelligence", "llm", "generative-ai"]

        repos_by_canonical: Dict[str, Dict[str, Any]] = {}
        headers = self._github_headers()

        per_page = str(min(50, limit))
        for topic in topics:
            q = f"topic:{topic} created:>{created_cutoff} stars:>{min_stars}"
            params = {
                "q": q,
                "sort": "stars",
                "order": "desc",
                "per_page": per_page,
            }
            resp = await client.get("https://api.github.com/search/repositories", params=params, headers=headers)
            if resp.status_code >= 400:
                continue
            body = resp.json() or {}
            for repo in body.get("items") or []:
                html_url = str(repo.get("html_url") or "").strip()
                if not html_url:
                    continue
                canonical = canonicalize_url(html_url)
                if not canonical:
                    continue

                full_name = str(repo.get("full_name") or "").strip()
                description = normalize_text(str(repo.get("description") or ""))[:280]
                stars = int(repo.get("stargazers_count") or 0)
                forks = int(repo.get("forks_count") or 0)
                language = str(repo.get("language") or "").strip()
                created_at = str(repo.get("created_at") or "").strip()
                pushed_at = str(repo.get("pushed_at") or "").strip()

                existing_row = repos_by_canonical.get(canonical)
                if existing_row is None:
                    repos_by_canonical[canonical] = {
                        "full_name": full_name,
                        "html_url": html_url,
                        "canonical_url": canonical,
                        "description": description,
                        "stars": stars,
                        "forks": forks,
                        "language": language,
                        "created_at": created_at,
                        "pushed_at": pushed_at,
                        "topics_matched": [topic],
                    }
                else:
                    topics_matched = list(existing_row.get("topics_matched") or [])
                    if topic not in topics_matched:
                        topics_matched.append(topic)
                    existing_row["topics_matched"] = topics_matched
                    existing_row["stars"] = max(int(existing_row.get("stars") or 0), stars)
                    existing_row["forks"] = max(int(existing_row.get("forks") or 0), forks)
                    if not existing_row.get("description") and description:
                        existing_row["description"] = description
                    if not existing_row.get("language") and language:
                        existing_row["language"] = language
                    if not existing_row.get("pushed_at") and pushed_at:
                        existing_row["pushed_at"] = pushed_at

        if not repos_by_canonical:
            return []

        yesterday_rows = await self._load_snapshot_payload_rows(
            conn,
            source_key=source.source_key,
            snapshot_date=yesterday_date,
        )
        yesterday_map: Dict[str, Dict[str, Any]] = {c: p for c, p in yesterday_rows if c}

        ranked = sorted(
            repos_by_canonical.values(),
            key=lambda r: (int(r.get("stars") or 0), str(r.get("pushed_at") or "")),
            reverse=True,
        )[:limit]

        items: List[NormalizedNewsItem] = []
        for repo in ranked:
            canonical = str(repo.get("canonical_url") or "").strip()
            if not canonical:
                continue

            full_name = normalize_text(str(repo.get("full_name") or "")) or canonical
            description = normalize_text(str(repo.get("description") or ""))[:280]
            html_url = str(repo.get("html_url") or canonical).strip()

            stars_today = int(repo.get("stars") or 0)
            forks_today = int(repo.get("forks") or 0)
            language = str(repo.get("language") or "").strip()[:64]
            topics_matched = list(repo.get("topics_matched") or [])

            snapshot_payload = {
                "provider": "github",
                "kind": "snapshot",
                "snapshot_date": snapshot_date,
                "full_name": full_name,
                "stars": stars_today,
                "forks": forks_today,
                "language": language,
                "topics_matched": topics_matched,
                "origin": "github_search_velocity",
            }
            items.append(
                NormalizedNewsItem(
                    source_key=source.source_key,
                    source_name=source.display_name,
                    source_type=source.source_type,
                    title=f"GitHub repo: {full_name}"[:300],
                    url=html_url,
                    canonical_url=canonical,
                    summary=_shorten_text(description or f"GitHub repo snapshot ({stars_today} stars).")[:300],
                    published_at=hidden_published_at,
                    language="en",
                    external_id=_stable_external_id(source.source_key, "snapshot", snapshot_date, canonical),
                    payload=snapshot_payload,
                    source_weight=source.credibility_weight,
                )
            )

            prev = yesterday_map.get(canonical) or {}
            stars_yesterday = int(prev.get("stars") or 0)
            delta_type = ""
            stars_delta = 0
            if not prev:
                delta_type = "added"
            else:
                stars_delta = stars_today - stars_yesterday
                if stars_delta >= min_star_delta:
                    delta_type = "mover"

            if not delta_type:
                continue

            if delta_type == "added":
                delta_title = f"GitHub trending repo: {full_name}"
                delta_summary = _shorten_text(f"New repo in trending-like AI set: {full_name}. {description}")
            else:
                delta_title = f"GitHub repo mover: {full_name}"
                delta_summary = _shorten_text(
                    f"Star growth +{stars_delta} (now {stars_today}). {full_name}. {description}"
                )

            delta_payload = {
                "provider": "github",
                "kind": "delta",
                "delta_type": delta_type,
                "snapshot_date": snapshot_date,
                "full_name": full_name,
                "stars_today": stars_today,
                "stars_yesterday": stars_yesterday or None,
                "stars_delta": stars_delta or None,
                "forks": forks_today,
                "language": language,
                "topics_matched": topics_matched,
                "origin": "github_search_velocity",
            }
            items.append(
                NormalizedNewsItem(
                    source_key=source.source_key,
                    source_name=source.display_name,
                    source_type=source.source_type,
                    title=delta_title[:300],
                    url=html_url,
                    canonical_url=canonical,
                    summary=delta_summary[:300],
                    published_at=today_midnight,
                    language="en",
                    external_id=_stable_external_id(source.source_key, "delta", snapshot_date, delta_type, canonical),
                    payload=delta_payload,
                    source_weight=source.credibility_weight,
                )
            )

        return items

    async def _fetch_amazon_new_releases_ai(
        self,
        conn: asyncpg.Connection,
        source: SourceDefinition,
        lookback_hours: int,
    ) -> List[NormalizedNewsItem]:
        del lookback_hours

        raw_urls: List[str] = []
        for raw in (self.amazon_new_releases_urls or "").split(","):
            u = raw.strip()
            if not u:
                continue
            canonical = canonicalize_url(u)
            raw_urls.append(canonical or u)
        if not raw_urls:
            return []
        if async_playwright is None:
            return []

        today = datetime.now(timezone.utc).date()
        snapshot_date = today.isoformat()
        yesterday_date = (today - timedelta(days=1)).isoformat()
        today_midnight = _utc_midnight(today)
        hidden_published_at = today_midnight - timedelta(days=30)

        max_items = max(1, min(60, int(self.amazon_new_releases_max_items)))
        min_rank_delta = max(1, int(self.amazon_new_releases_min_rank_delta))

        yesterday_rows = await self._load_snapshot_payload_rows(
            conn,
            source_key=source.source_key,
            snapshot_date=yesterday_date,
        )
        yesterday_map: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for canonical, payload in yesterday_rows:
            category_url = str(payload.get("category_url") or "").strip()
            if not category_url:
                continue
            yesterday_map[(category_url, canonical)] = payload

        scrape_targets: List[str] = []
        for category_url in raw_urls:
            # If we already stored a reasonable snapshot for today, don't keep hammering Amazon hourly.
            existing = await self._count_snapshot_rows(
                conn,
                source_key=source.source_key,
                snapshot_date=snapshot_date,
                category_url=category_url,
            )
            if existing >= max(5, min(12, max_items // 2)):
                continue
            scrape_targets.append(category_url)

        if not scrape_targets:
            return []

        timeout_ms = max(5000, int(self.amazon_playwright_timeout_ms))
        items: List[NormalizedNewsItem] = []
        seen_snapshot_ids: set[str] = set()
        seen_delta_ids: set[str] = set()

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                # Use a normal browser UA; explicit bots get blocked frequently.
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                locale="en-US",
            )
            page = await context.new_page()

            for category_url in scrape_targets:
                try:
                    await page.goto(category_url, timeout=timeout_ms, wait_until="domcontentloaded")
                    html = await page.content()
                except Exception:
                    continue

                parsed = _parse_amazon_new_releases_html(
                    html,
                    category_url=category_url,
                    max_items=max_items,
                )
                if not parsed:
                    continue

                for entry in parsed:
                    canonical_url = str(entry.get("canonical_url") or "").strip()
                    asin = str(entry.get("asin") or "").strip().upper()
                    if not canonical_url or not asin:
                        continue

                    title = normalize_text(str(entry.get("title") or ""))[:300]
                    author = normalize_text(str(entry.get("author") or ""))[:200]
                    try:
                        rank = int(entry.get("rank") or 0)
                    except Exception:
                        rank = 0

                    snapshot_id = _stable_external_id(source.source_key, "snapshot", snapshot_date, category_url, canonical_url)
                    if snapshot_id not in seen_snapshot_ids:
                        seen_snapshot_ids.add(snapshot_id)
                        snapshot_payload = {
                            "provider": "amazon",
                            "kind": "snapshot",
                            "snapshot_date": snapshot_date,
                            "category_url": category_url,
                            "asin": asin,
                            "title": title,
                            "author": author,
                            "rank": rank,
                            "origin": "amazon_new_releases",
                        }
                        summary = _shorten_text(
                            f"Amazon AI book snapshot (rank #{rank}). " + (f"by {author}." if author else "")
                        )
                        items.append(
                            NormalizedNewsItem(
                                source_key=source.source_key,
                                source_name=source.display_name,
                                source_type=source.source_type,
                                title=f"Amazon AI book: {title or asin}"[:300],
                                url=canonical_url,
                                canonical_url=canonical_url,
                                summary=summary[:300],
                                published_at=hidden_published_at,
                                language="en",
                                external_id=snapshot_id,
                                payload=snapshot_payload,
                                source_weight=source.credibility_weight,
                            )
                        )

                    delta_type = ""
                    rank_yesterday = 0
                    rank_delta = 0
                    prev = yesterday_map.get((category_url, canonical_url))
                    if prev is None:
                        delta_type = "added"
                    else:
                        try:
                            rank_yesterday = int(prev.get("rank") or 0)
                        except Exception:
                            rank_yesterday = 0
                        if rank_yesterday > 0 and rank > 0:
                            rank_delta = rank_yesterday - rank
                            if rank_delta >= min_rank_delta:
                                delta_type = "mover"

                    if not delta_type:
                        continue

                    # Dedupe delta items across categories to keep the feed readable.
                    delta_id = _stable_external_id(source.source_key, "delta", snapshot_date, delta_type, canonical_url)
                    if delta_id in seen_delta_ids:
                        continue
                    seen_delta_ids.add(delta_id)

                    if delta_type == "added":
                        delta_title = f"Amazon AI new release: {title or asin}"
                        delta_summary = _shorten_text(
                            f"New on Amazon AI new releases (rank #{rank}). " + (f"by {author}. " if author else "") + title
                        )
                    else:
                        delta_title = f"Amazon AI mover: {title or asin}"
                        delta_summary = _shorten_text(
                            f"Amazon AI new releases mover: rank up {rank_delta} to #{rank} (from #{rank_yesterday}). "
                            + (f"by {author}. " if author else "")
                            + title
                        )

                    delta_payload = {
                        "provider": "amazon",
                        "kind": "delta",
                        "delta_type": delta_type,
                        "snapshot_date": snapshot_date,
                        "category_url": category_url,
                        "asin": asin,
                        "title": title,
                        "author": author,
                        "rank_today": rank,
                        "rank_yesterday": rank_yesterday or None,
                        "rank_delta": rank_delta or None,
                        "origin": "amazon_new_releases",
                    }
                    items.append(
                        NormalizedNewsItem(
                            source_key=source.source_key,
                            source_name=source.display_name,
                            source_type=source.source_type,
                            title=delta_title[:300],
                            url=canonical_url,
                            canonical_url=canonical_url,
                            summary=delta_summary[:300],
                            published_at=today_midnight,
                            language="en",
                            external_id=delta_id,
                            payload=delta_payload,
                            source_weight=source.credibility_weight,
                        )
                    )

            try:
                await context.close()
            except Exception:
                pass
            try:
                await browser.close()
            except Exception:
                pass

        return items

    async def _fetch_newsapi_turkey(self, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        if not self.newsapi_key:
            print("[news-ingest] newsapi_turkey: skipped (no NEWS_API_KEY)")
            return []

        now = datetime.now(timezone.utc)
        since = (now - timedelta(hours=max(1, lookback_hours))).isoformat()
        params = {
            "q": "girişim OR startup OR yapay zeka OR AI OR yatırım OR fonlama",
            "language": "tr",
            "sortBy": "publishedAt",
            "from": since,
            "pageSize": str(min(100, self.max_per_source)),
            "apiKey": self.newsapi_key,
        }
        resp = await client.get(source.base_url, params=params)
        if resp.status_code >= 400:
            print(f"[news-ingest] newsapi_turkey: API error {resp.status_code}")
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
                language="tr",
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

    async def _fetch_gnews_turkey(self, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        if not self.gnews_key:
            print("[news-ingest] gnews_turkey: skipped (no GNEWS_API_KEY)")
            return []

        now = datetime.now(timezone.utc)
        since = (now - timedelta(hours=max(1, lookback_hours))).isoformat()
        params = {
            "q": "girişim OR yatırım OR yapay zeka OR startup OR AI",
            "lang": "tr",
            "country": "tr",
            "max": str(min(50, self.max_per_source)),
            "from": since,
            "token": self.gnews_key,
        }
        resp = await client.get(source.base_url, params=params)
        if resp.status_code >= 400:
            print(f"[news-ingest] gnews_turkey: API error {resp.status_code}")
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
                language="tr",
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
              COALESCE(headquarters_country, '') AS headquarters_country,
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

        candidate_inputs: List[Tuple[str, str, str, str]] = []
        for row in startup_rows:
            raw_website = str(row.get("website") or "").strip()
            slug = str(row.get("slug") or "").strip()
            name = str(row.get("name") or "").strip()
            headquarters_country = str(row.get("headquarters_country") or "").strip()
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
            ):
                candidate_inputs.append((f"{root}{suffix}", slug, name, headquarters_country))

        deduped_candidates: List[Tuple[str, str, str, str]] = []
        seen_urls: set[str] = set()
        for candidate in candidate_inputs:
            if candidate[0] in seen_urls:
                continue
            seen_urls.add(candidate[0])
            deduped_candidates.append(candidate)

        sem = asyncio.Semaphore(12)
        items: List[NormalizedNewsItem] = []

        async def parse_candidate(url: str, startup_slug: str, startup_name: str, startup_country: str) -> List[NormalizedNewsItem]:
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
                        if not is_likely_content_url(link):
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
                                    "startup_country": startup_country,
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
                            "startup_country": startup_country,
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
            chunk_tasks = [parse_candidate(url, slug, name, country) for url, slug, name, country in chunk]
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
                    elif source.source_key == "github_trending_ai":
                        items = await self._fetch_github_trending_ai(conn, client, source, lookback_hours)
                    elif source.source_key == "amazon_new_releases_ai":
                        items = await self._fetch_amazon_new_releases_ai(conn, source, lookback_hours)
                    elif source.source_key == "newsapi_turkey":
                        items = await self._fetch_newsapi_turkey(client, source, lookback_hours)
                    elif source.source_key == "gnews_turkey":
                        items = await self._fetch_gnews_turkey(client, source, lookback_hours)
                    elif source.source_key == "startup_owned_feeds":
                        items = await self._fetch_startup_owned_sources(conn, client, source, lookback_hours)
                    elif source.fetch_mode == "crawler":
                        items = await self._fetch_frontier_candidates(conn, client, source, lookback_hours)
                    else:
                        items = []

                    # Turkey pipeline: two-stage filter (fast heuristic + LLM classification).
                    if (source.region or "global") == "turkey":
                        pre_filter = len(items)
                        items = [i for i in items if _turkey_prefilter(i)]
                        pre_llm = len(items)
                        items = await self._llm_classify_turkey_relevance(items, source.source_key)
                        if pre_filter > 0 or (source.region or "global") == "turkey":
                            print(f"[news-ingest] {source.source_key}: {pre_filter} fetched → {pre_llm} prefilter → {len(items)} LLM-passed")

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
                        primary_source_key=primary.source_key,
                        primary_external_id=primary.external_id,
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
                        # Builder view is LLM-only. Heuristic generation creates repetitive,
                        # low-value outputs and should not be persisted.
                        builder_takeaway=None,
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
                    primary_source_key=item.source_key,
                    primary_external_id=item.external_id,
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
                    # Builder view is LLM-only. Heuristic generation creates repetitive,
                    # low-value outputs and should not be persisted.
                    builder_takeaway=None,
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

    async def _fetch_editorial_memory(
        self,
        conn: "asyncpg.Connection",
        *,
        edition_date: date,
        region: str,
        entity_names: Sequence[str],
        lookback_days: int = 5,
    ) -> Dict[str, Any]:
        """Fetch recent brief themes + entity fact trends for editorial continuity."""
        memory: Dict[str, Any] = {}

        # --- Recent brief themes (last N days) ---
        try:
            rows = await conn.fetch(
                """
                SELECT edition_date,
                       stats_json->'daily_brief'->>'headline' AS headline,
                       stats_json->'daily_brief'->'themes' AS themes_json
                FROM news_daily_editions
                WHERE edition_date < $1
                  AND region = $2
                  AND stats_json->'daily_brief'->>'headline' IS NOT NULL
                ORDER BY edition_date DESC
                LIMIT $3
                """,
                edition_date,
                region,
                lookback_days,
            )
            if rows:
                recent_briefs = []
                for row in rows:
                    themes: List[str] = []
                    raw = row["themes_json"]
                    if raw:
                        try:
                            parsed = json.loads(raw) if isinstance(raw, str) else raw
                            if isinstance(parsed, list):
                                themes = [str(t) for t in parsed[:4]]
                        except Exception:
                            pass
                    recent_briefs.append({
                        "date": row["edition_date"].isoformat(),
                        "headline": _shorten_text(row["headline"] or "", 60),
                        "themes": themes,
                    })
                if recent_briefs:
                    memory["recent_briefs"] = recent_briefs
        except Exception as exc:
            print(f"[news-ingest] editorial memory: recent briefs query failed: {exc}")

        # --- Entity fact trends (for entities in today's clusters) ---
        if entity_names:
            try:
                names_lower = list(dict.fromkeys(
                    n.strip().lower() for n in entity_names if n.strip()
                ))[:20]
                if names_lower:
                    rows = await conn.fetch(
                        """
                        SELECT entity_name, fact_key, fact_value,
                               confirmation_count,
                               first_seen_at::date AS first_seen,
                               last_confirmed_at::date AS last_confirmed
                        FROM news_entity_facts
                        WHERE LOWER(entity_name) = ANY($1)
                          AND is_current = TRUE
                          AND confirmation_count >= 2
                        ORDER BY last_confirmed_at DESC
                        LIMIT 15
                        """,
                        names_lower,
                    )
                    if rows:
                        entity_trends = []
                        for row in rows:
                            entry = f"{row['entity_name']}: {row['fact_key']}={row['fact_value']}"
                            if row["confirmation_count"] >= 3:
                                entry += f" (confirmed {row['confirmation_count']}x)"
                            days_tracked = (edition_date - row["first_seen"]).days
                            if days_tracked >= 2:
                                entry += f" [tracked {days_tracked}d]"
                            entity_trends.append(_shorten_text(entry, 120))
                        if entity_trends:
                            memory["entity_trends"] = entity_trends
            except Exception as exc:
                print(f"[news-ingest] editorial memory: entity facts query failed: {exc}")

        return memory

    async def _llm_generate_daily_brief(self, *, conn: Optional["asyncpg.Connection"] = None, edition_date: date, region: str = "global", clusters: Sequence[StoryCluster]) -> Optional[Dict[str, Any]]:
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

        lang_instruction = (
            "\n\nIMPORTANT: Write ALL output values (headline, summary, bullets) in Turkish (Türkçe). "
            "Use native Turkish phrasing, not machine-translated English. JSON keys stay in English."
        ) if region == "turkey" else ""

        prompt = (
            "You are a senior technology correspondent writing a daily briefing "
            "for startup builders and investors. "
            "Your tone is authoritative and analytical — like a Financial Times "
            "tech column or BBC World Service technology bulletin. "
            "Synthesise ALL the stories provided into a panoramic overview of the day. "
            "The headline should capture the day's dominant theme or tension, NOT a single company. "
            "The summary is your editorial paragraph — connect the dots across stories, "
            "identify patterns, shifts, or contradictions in today's market. "
            "Each bullet MUST cover a DIFFERENT story or development from the input. "
            "Never repeat the same company or topic across bullets. "
            "Where available, use key_facts (funding amounts, investors, valuations) "
            "and key_entities to add concrete specifics. "
            "If a story has_conflicting_reports, note the tension. "
            "\n\n"
            "EDITORIAL CONTINUITY: If 'editorial_memory' is provided, use it to: "
            "(1) Note when today's themes continue or break from recent days "
            "(e.g. 'funding continues in healthcare AI for the third day' "
            "or 'a shift from yesterday's enterprise focus'). "
            "(2) Reference entity developments when relevant "
            "(e.g. 'Company X, first tracked raising $10M, now confirmed at $15M'). "
            "(3) Highlight emerging multi-day patterns or trend reversals. "
            "Weave continuity naturally into your summary — do NOT list prior headlines. "
            "If no editorial_memory is provided, write the brief as a standalone edition. "
            "\n\n"
            "Return strict JSON with keys: "
            "headline (<=80 chars, thematic — no company names), "
            "summary (<=550 chars, editorial synthesis paragraph), "
            "bullets (array of 4-6 strings, each <=120 chars, each a different story), "
            "themes (array of up to 6 lowercase hyphenated tags). "
            "Be concrete, cite specifics. No prose outside JSON."
            + lang_instruction
        )

        # Collect entity names from today's clusters for memory lookup
        all_entity_names: List[str] = []
        for c in top_clusters:
            all_entity_names.extend(c.entities)
            mr = getattr(c, "memory_result", None)
            if mr:
                for le in (getattr(mr, "linked_entities", None) or []):
                    if getattr(le, "entity_name", None):
                        all_entity_names.append(le.entity_name)

        # Fetch editorial memory (recent briefs + entity trends)
        editorial_memory: Dict[str, Any] = {}
        if conn is not None:
            try:
                editorial_memory = await self._fetch_editorial_memory(
                    conn,
                    edition_date=edition_date,
                    region=region,
                    entity_names=all_entity_names,
                )
            except Exception as exc:
                print(f"[news-ingest] editorial memory fetch failed (will proceed without): {exc}")

        def pick_summary(c: StoryCluster) -> str:
            return normalize_text(c.llm_summary or c.summary or c.rank_reason or "")

        def _memory_enrichment(c: StoryCluster) -> Dict[str, Any]:
            """Extract memory gate data for richer editorial context."""
            enrichment: Dict[str, Any] = {}
            mr = getattr(c, "memory_result", None)
            if mr is None:
                return enrichment
            # Key facts (funding amounts, round types, investors, valuations)
            claims = getattr(mr, "extracted_claims", None) or []
            if claims:
                key_facts = []
                for claim in claims[:5]:
                    key_facts.append(f"{claim.fact_key}: {claim.fact_value}")
                if key_facts:
                    enrichment["key_facts"] = key_facts
            # Named entities (companies, investors)
            entities = getattr(mr, "linked_entities", None) or []
            if entities:
                names = [e.entity_name for e in entities[:4] if e.match_score >= 0.7]
                if names:
                    enrichment["key_entities"] = names
            # Novelty signals
            if getattr(mr, "has_new_facts", False):
                enrichment["has_new_information"] = True
            if getattr(mr, "has_contradictions", False):
                enrichment["has_conflicting_reports"] = True
            return enrichment

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
                    **_memory_enrichment(c),
                }
                for c in top_clusters
            ],
        }
        if editorial_memory:
            user_payload["editorial_memory"] = editorial_memory

        def parse_daily_brief(parsed: Dict[str, Any], model_label: Optional[str]) -> Optional[Dict[str, Any]]:
            headline = _shorten_text(str(parsed.get("headline") or ""), 80)
            summary = _shorten_text(str(parsed.get("summary") or ""), 550)
            raw_bullets = parsed.get("bullets") or []
            bullets: List[str] = []
            if isinstance(raw_bullets, list):
                for b in raw_bullets:
                    if not b:
                        continue
                    bullets.append(_shorten_text(str(b), 120))
                    if len(bullets) >= 6:
                        break
            raw_themes = parsed.get("themes") or []
            themes: List[str] = []
            if isinstance(raw_themes, list):
                for t in raw_themes:
                    text = normalize_text(str(t)).lower()
                    if not text:
                        continue
                    # keep tags compact; normalize spaces to hyphens
                    text = re.sub(r"[^a-z0-9 -]+", "", text).strip().replace(" ", "-")
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
                "cluster_count": top_n,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        print(f"[news-ingest] generating daily brief for {edition_date} ({len(top_clusters)} clusters)")

        if self.azure_client is not None:
            # Prefer responses API when available so we can set reasoning effort.
            # Fall back to chat.completions for older deployments.
            preferred_models = []
            for m in [
                self.azure_openai_daily_brief_deployment,
                self.azure_openai_deployment,
                self.azure_openai_fallback_deployment,
            ]:
                if m and m not in preferred_models:
                    preferred_models.append(m)

            if hasattr(self.azure_client, "responses"):
                json_schema = {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "headline": {"type": "string", "minLength": 1, "maxLength": 120},
                        "summary": {"type": "string", "maxLength": 600},
                        "bullets": {
                            "type": "array",
                            "minItems": 4,
                            "maxItems": 6,
                            "items": {"type": "string", "maxLength": 240},
                        },
                        "themes": {
                            "type": "array",
                            "maxItems": 6,
                            "items": {"type": "string", "maxLength": 32},
                        },
                    },
                    "required": ["headline", "summary", "bullets", "themes"],
                }
                for model_name in preferred_models:
                    try:
                        payload: Dict[str, Any] = {
                            "model": model_name,
                            "input": [
                                {"role": "system", "content": prompt},
                                {"role": "user", "content": json.dumps(user_payload)},
                            ],
                            "max_output_tokens": 1024,
                            "text": {
                                "format": {
                                    "type": "json_schema",
                                    "name": "daily_news_brief",
                                    "schema": json_schema,
                                    "strict": True,
                                }
                            },
                        }
                        if _azure_supports_reasoning_effort(model_name):
                            payload["reasoning"] = {"effort": self.azure_openai_daily_brief_effort}
                        if _azure_supports_temperature(model_name):
                            payload["temperature"] = 0.25

                        try:
                            response = await self.azure_client.responses.create(**payload)
                        except Exception as exc:
                            # Some Azure deployments (notably certain reasoning models) reject non-default temperature.
                            if _is_unsupported_temperature_exception(exc):
                                payload.pop("temperature", None)
                                response = await self.azure_client.responses.create(**payload)
                            else:
                                raise

                        # openai-python returns helpers in newer versions; be defensive.
                        content = getattr(response, "output_text", None)
                        if callable(content):
                            content = content()
                        if not content:
                            # Fallback: attempt to read common dict-like shapes.
                            content = getattr(response, "text", None) or "{}"
                        parsed = json.loads(content) if isinstance(content, str) else {}
                        brief = parse_daily_brief(parsed, None)
                        if brief is not None:
                            print(f"[news-ingest] daily brief generated via Azure (responses): \"{brief.get('headline', '')}\"")
                            return brief
                    except Exception as exc:
                        print(f"[news-ingest] Azure daily brief failed (responses model={model_name}): {exc}")

            for model_name in preferred_models:
                for with_response_format in (True, False):
                    token_param = _azure_token_param_name(model_name)
                    azure_payload: Dict[str, Any] = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": prompt},
                            {"role": "user", "content": json.dumps(user_payload)},
                        ],
                    }
                    if _azure_supports_temperature(model_name):
                        azure_payload["temperature"] = 0.25
                    azure_payload[token_param] = _azure_token_budget(model_name, 1024)
                    if with_response_format:
                        azure_payload["response_format"] = {"type": "json_object"}

                    try:
                        try:
                            response = await self.azure_client.chat.completions.create(**azure_payload)
                        except Exception as exc:
                            if _is_unsupported_temperature_exception(exc):
                                azure_payload.pop("temperature", None)
                                response = await self.azure_client.chat.completions.create(**azure_payload)
                            else:
                                raise

                        content = ((response.choices or [None])[0].message.content if response.choices else "{}") or "{}"
                        parsed = json.loads(content) if isinstance(content, str) else {}
                        brief = parse_daily_brief(parsed, None)
                        if brief is not None:
                            print(f"[news-ingest] daily brief generated via Azure: \"{brief.get('headline', '')}\"")
                            return brief
                        else:
                            mode = "json_object" if with_response_format else "no_response_format"
                            print(f"[news-ingest] Azure daily brief parse returned None ({mode} model={model_name}), content: {content[:200]}")
                    except Exception as exc:
                        mode = "json_object" if with_response_format else "no_response_format"
                        print(f"[news-ingest] Azure daily brief failed ({mode} model={model_name}): {exc}")

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
                            "max_tokens": 1024,
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

    async def _llm_classify_turkey_relevance(
        self, items: List["NormalizedNewsItem"], source_key: str = ""
    ) -> List["NormalizedNewsItem"]:
        """Classify Turkey news items for AI/startup relevance using LLM.

        Sends items in batches of 20 to gpt-4o-mini. On failure, falls back to
        the keyword-based heuristic ``_is_relevant_turkey_news_item()``.
        """
        if not items:
            return []

        # No LLM provider → fall back to keyword heuristic
        if not self.azure_client and not self.openai_api_key:
            print(f"[news-ingest] {source_key}: LLM unavailable, falling back to keyword filter")
            return [i for i in items if _is_relevant_turkey_news_item(i)]

        BATCH_SIZE = 20
        kept: List["NormalizedNewsItem"] = []

        for batch_start in range(0, len(items), BATCH_SIZE):
            batch = items[batch_start : batch_start + BATCH_SIZE]
            article_lines = []
            for idx, item in enumerate(batch, 1):
                title = (item.title or "").strip()[:200]
                summary = (item.summary or "").strip()[:150]
                article_lines.append(f"{idx}. {title} | {summary}")
            articles_text = "\n".join(article_lines)
            prompt_text = _TURKEY_RELEVANCE_PROMPT.format(articles=articles_text)

            classifications: Optional[List[bool]] = None
            try:
                classifications = await self._call_turkey_classifier_llm(prompt_text, len(batch))
            except Exception as exc:
                print(f"[news-ingest] {source_key}: LLM turkey classification failed: {exc}")

            if classifications is not None and len(classifications) == len(batch):
                for item, is_relevant in zip(batch, classifications):
                    if is_relevant:
                        kept.append(item)
            else:
                # Fallback: use keyword heuristic for this batch
                for item in batch:
                    if _is_relevant_turkey_news_item(item):
                        kept.append(item)

        return kept

    async def _call_turkey_classifier_llm(self, prompt: str, expected_count: int) -> Optional[List[bool]]:
        """Call Azure OpenAI (or OpenAI fallback) with the turkey relevance prompt."""
        messages = [{"role": "user", "content": prompt}]

        # Try Azure first
        if self.azure_client is not None:
            for model_name in [self.azure_openai_deployment, self.azure_openai_fallback_deployment]:
                if not model_name:
                    continue
                try:
                    token_param = _azure_token_param_name(model_name)
                    payload: Dict[str, Any] = {
                        "model": model_name,
                        "messages": messages,
                        token_param: _azure_token_budget(model_name, max(10, expected_count * 8)),
                        "response_format": {"type": "json_object"},
                    }
                    if _azure_supports_temperature(model_name):
                        payload["temperature"] = 0.0
                    try:
                        response = await self.azure_client.chat.completions.create(**payload)
                    except Exception as exc:
                        if _is_unsupported_temperature_exception(exc):
                            payload.pop("temperature", None)
                            response = await self.azure_client.chat.completions.create(**payload)
                        else:
                            raise
                    content = ((response.choices or [None])[0].message.content if response.choices else "[]") or "[]"
                    return self._parse_classification_response(content, expected_count)
                except Exception:
                    continue

        # Fallback: OpenAI API
        if self.openai_api_key:
            try:
                timeout = httpx.Timeout(30.0)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {self.openai_api_key}", "Content-Type": "application/json"},
                        json={
                            "model": self.llm_model,
                            "temperature": 0.0,
                            "max_tokens": max(10, expected_count * 8),
                            "response_format": {"type": "json_object"},
                            "messages": messages,
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "[]")
                    return self._parse_classification_response(content, expected_count)
            except Exception:
                pass

        return None

    @staticmethod
    def _parse_classification_response(content: str, expected_count: int) -> Optional[List[bool]]:
        """Parse LLM JSON response into a list of booleans."""
        try:
            parsed = json.loads(content)
            # Handle both bare array and wrapped object (e.g. {"results": [...]})
            if isinstance(parsed, list):
                arr = parsed
            elif isinstance(parsed, dict):
                # Find the first list value in the dict
                arr = next((v for v in parsed.values() if isinstance(v, list)), None)
                if arr is None:
                    return None
            else:
                return None
            result = [bool(v) for v in arr]
            if len(result) != expected_count:
                return None
            return result
        except (json.JSONDecodeError, TypeError, ValueError):
            return None

    async def _llm_enrich_cluster(self, cluster: StoryCluster) -> LLMEnrichmentResult:
        if not self.openai_api_key and not self.azure_client:
            return LLMEnrichmentResult(None, None, None, None, None, None, None, error_code="no_provider")

        prompt = (
            "You are an analyst writing 1-sentence builder takeaways for startup news. "
            "A builder takeaway is a practical, specific insight for technical founders and engineers. "
            "It must reference the specific company or technology by name, not use generic advice. "
            "BAD: 'Prioritize defensible data and eval quality over model-chasing.' (too generic) "
            "GOOD: 'Cursor\\'s $100M raise validates AI-native IDEs — builders should watch whether "
            "they lock in proprietary UX or stay model-agnostic, as that determines switching cost.' "
            "GOOD: 'Stripe\\'s acquisition signals payment infra consolidation — if you depend on "
            "competing APIs, evaluate migration paths now before integration points disappear.' "
            "Return strict JSON with ALL of these keys (every key is REQUIRED): "
            "builder_takeaway (<=140 chars, specific and actionable — THIS IS THE MOST IMPORTANT FIELD), "
            "summary (<=160 chars), "
            "story_type (funding|launch|mna|regulation|hiring|news), "
            "topic_tags (array of up to 6 lowercase tags), "
            "signal_score (0-1), confidence_score (0-1). "
            "No prose outside JSON."
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
            candidate_models: List[str] = []
            for m in [self.azure_openai_deployment, self.azure_openai_fallback_deployment]:
                if m and m not in candidate_models:
                    candidate_models.append(m)

            for model_name in candidate_models:
                for with_response_format in (True, False):
                    token_param = _azure_token_param_name(model_name)
                    azure_payload: Dict[str, Any] = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": prompt},
                            {"role": "user", "content": json.dumps(user_payload)},
                        ],
                    }
                    if _azure_supports_temperature(model_name):
                        azure_payload["temperature"] = 0.2
                    azure_payload[token_param] = _azure_token_budget(model_name, 350)
                    if with_response_format:
                        azure_payload["response_format"] = {"type": "json_object"}

                    try:
                        try:
                            response = await self.azure_client.chat.completions.create(**azure_payload)
                        except Exception as exc:
                            if _is_unsupported_temperature_exception(exc):
                                azure_payload.pop("temperature", None)
                                response = await self.azure_client.chat.completions.create(**azure_payload)
                            else:
                                raise

                        content = ((response.choices or [None])[0].message.content if response.choices else "{}") or "{}"
                        parsed = json.loads(content) if isinstance(content, str) else {}
                        return parse_llm_payload(parsed, f"azure:{model_name}")
                    except Exception as exc:
                        if debug_llm:
                            mode = "json_object" if with_response_format else "no_response_format"
                            print(f"[news-ingest] Azure LLM enrichment failed ({mode} model={model_name}): {exc}")
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
                            "max_tokens": 350,
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

    async def _run_memory_gate(
        self, conn: asyncpg.Connection, clusters: Sequence[StoryCluster], region: str = "global"
    ) -> Dict[str, Any]:
        """Run memory gate on clusters for a specific region.

        Populates cluster.memory_result for each cluster. Does NOT persist yet
        (persistence happens after _persist_clusters creates the cluster IDs).

        Args:
            region: 'global' or 'turkey'. Controls which entity facts are visible
                    and whether Turkish-language patterns are applied.
        """
        from .memory_gate import MemoryGate

        gate = MemoryGate()
        try:
            await gate.load(conn, region=region)
        except Exception as exc:
            print(f"[memory_gate:{region}] Load failed (tables may not exist yet): {exc}")
            return {"skipped": True, "error": str(exc)}

        for cluster in clusters:
            try:
                member_urls = [m.url for m in cluster.members if m.url]
                result = await gate.process_cluster(
                    conn,
                    cluster_key=cluster.cluster_key,
                    title=cluster.title,
                    summary=cluster.summary or "",
                    story_type=cluster.story_type,
                    entities=cluster.entities,
                    canonical_url=cluster.canonical_url or "",
                    trust_score=cluster.trust_score,
                    members_urls=member_urls,
                    region=region,
                )
                cluster.memory_result = result
            except Exception as exc:
                print(f"[memory_gate:{region}] Failed for cluster {cluster.cluster_key}: {exc}")

        # Store gate per region for later persistence
        if not hasattr(self, "_memory_gates"):
            self._memory_gates: Dict[str, Any] = {}
        self._memory_gates[region] = gate
        # Keep backward compat
        self._memory_gate = gate
        return gate.stats

    async def _persist_memory_results(
        self,
        conn: asyncpg.Connection,
        clusters: Sequence[StoryCluster],
        cluster_ids: Dict[str, str],
        region: str = "global",
    ) -> int:
        """Persist memory gate results (extractions + facts) after clusters are saved."""
        gates = getattr(self, "_memory_gates", {})
        gate = gates.get(region) or getattr(self, "_memory_gate", None)
        if not gate:
            return 0

        facts_written = 0
        for cluster in clusters:
            result = cluster.memory_result
            if not result:
                continue
            cid = cluster_ids.get(cluster.cluster_key)
            if not cid:
                continue
            try:
                await gate.persist_extraction(conn, cid, result)
                facts_written += await gate.persist_facts(
                    conn, cid, cluster.canonical_url or "", result, region=region,
                )
            except Exception as exc:
                print(f"[memory_gate:{region}] Persist failed for cluster {cluster.cluster_key}: {exc}")

        return facts_written

    async def _run_scoring_and_gating(
        self,
        conn: "asyncpg.Connection",
        clusters: Sequence[StoryCluster],
        region: str = "global",
    ) -> Dict[str, Any]:
        """Score and gate clusters using heuristic rubric. No LLM calls.

        Populates cluster.gating_decision, gating_scores, gating_patterns,
        gating_gtm_tags, gating_delivery_model, gating_reason for each cluster.

        Returns stats dict with decision distribution.
        """
        from .memory_gate import (
            PatternMatcher,
            GTMClassifier,
            HeuristicScorer,
            GatingRouter,
            detect_narrative_dup,
        )

        pattern_matcher = PatternMatcher()
        gtm_classifier = GTMClassifier()
        scorer = HeuristicScorer()
        router = GatingRouter()

        try:
            await pattern_matcher.load(conn, region)
            await gtm_classifier.load(conn, region)
        except Exception as exc:
            print(f"[gating:{region}] Load failed (tables may not exist yet): {exc}")
            return {"skipped": True, "error": str(exc)}

        # Index clusters for narrative-dup detection (entity -> [(cluster, published_at)])
        entity_cluster_index: Dict[str, List[Tuple[StoryCluster, datetime]]] = {}
        for cluster in clusters:
            for entity in cluster.entities:
                key = entity.lower().strip()
                if key:
                    entity_cluster_index.setdefault(key, []).append(
                        (cluster, cluster.published_at)
                    )

        decision_counts: Dict[str, int] = {
            "publish": 0, "borderline": 0, "watchlist": 0,
            "accumulate": 0, "drop": 0,
        }

        for cluster in clusters:
            try:
                # 1. Pattern matching
                patterns = pattern_matcher.match(
                    cluster.title,
                    cluster.summary or "",
                    cluster.topic_tags,
                )

                # 2. GTM classification
                gtm_tags, delivery_model = gtm_classifier.classify(
                    cluster.title, cluster.summary or ""
                )

                # 3. Narrative-dup detection
                dup_of = None
                for entity in cluster.entities:
                    key = entity.lower().strip()
                    candidates = entity_cluster_index.get(key, [])
                    existing_decisions = [
                        {
                            "primary_entity": entity,
                            "story_type": other.story_type,
                            "published_at": pub_at,
                            "cluster_id": other.cluster_key,
                        }
                        for other, pub_at in candidates
                        if other is not cluster  # don't match self
                    ]
                    dup_of = detect_narrative_dup(
                        entity_name=entity,
                        story_type=cluster.story_type,
                        published_at=cluster.published_at,
                        existing_decisions=existing_decisions,
                    )
                    if dup_of:
                        break

                # 4. Heuristic scoring
                source_count = len(cluster.members)
                source_credibility = max(
                    (m.source_weight for m in cluster.members), default=0.65
                )
                scores = scorer.score(
                    story_type=cluster.story_type,
                    topic_tags=cluster.topic_tags,
                    source_count=source_count,
                    trust_score=cluster.trust_score,
                    source_credibility=source_credibility,
                    memory_result=cluster.memory_result,
                    patterns=patterns,
                    gtm_tags=gtm_tags,
                    pattern_matcher=pattern_matcher,
                    gtm_classifier=gtm_classifier,
                )

                # 5. Override: narrative dup → accumulate
                if dup_of:
                    decision = "accumulate"
                    reason = f"Narrative dup of cluster {dup_of}"
                else:
                    decision, reason = router.decide_with_reason(scores)

                # Populate cluster fields
                cluster.gating_decision = decision
                cluster.gating_scores = scores.to_dict()
                cluster.gating_patterns = patterns
                cluster.gating_gtm_tags = gtm_tags
                cluster.gating_delivery_model = delivery_model
                cluster.gating_reason = reason

                decision_counts[decision] = decision_counts.get(decision, 0) + 1

            except Exception as exc:
                print(f"[gating:{region}] Failed for cluster {cluster.cluster_key}: {exc}")
                # Default: let it through to LLM (publish)
                cluster.gating_decision = "publish"
                cluster.gating_reason = f"Gating error: {exc}"
                decision_counts["publish"] = decision_counts.get("publish", 0) + 1

        # Update pattern/GTM counts for accumulate+ tiers
        for cluster in clusters:
            if cluster.gating_decision in ("accumulate", "watchlist", "borderline", "publish"):
                try:
                    if cluster.gating_patterns:
                        await pattern_matcher.update_counts(
                            conn, cluster.gating_patterns,
                            cluster.cluster_key, region,
                        )
                    if cluster.gating_gtm_tags:
                        await gtm_classifier.update_counts(
                            conn, cluster.gating_gtm_tags, region,
                        )
                except Exception:
                    pass  # Non-critical

        total = len(clusters)
        print(
            f"[gating:{region}] {total} clusters scored — "
            f"publish={decision_counts['publish']} borderline={decision_counts['borderline']} "
            f"watchlist={decision_counts['watchlist']} accumulate={decision_counts['accumulate']} "
            f"drop={decision_counts['drop']}"
        )

        return {
            "total": total,
            "decisions": dict(decision_counts),
            "llm_candidates": decision_counts.get("publish", 0) + decision_counts.get("borderline", 0),
        }

    async def _persist_gating_decisions(
        self,
        conn: "asyncpg.Connection",
        clusters: Sequence[StoryCluster],
        cluster_ids: Dict[str, str],
        region: str = "global",
    ) -> int:
        """Persist gating decisions to news_item_decisions table."""
        persisted = 0
        for cluster in clusters:
            if not cluster.gating_decision or not cluster.gating_scores:
                continue
            cid = cluster_ids.get(cluster.cluster_key)
            if not cid:
                continue
            scores = cluster.gating_scores
            try:
                await conn.execute(
                    """
                    INSERT INTO news_item_decisions (
                        cluster_id, region,
                        score_builder_insight, score_pattern_novelty,
                        score_gtm_uniqueness, score_evidence_quality,
                        score_composite, decision, decision_reason,
                        has_contradiction, contradictions_json,
                        scoring_method
                    ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
                    ON CONFLICT (cluster_id) DO UPDATE SET
                        region = EXCLUDED.region,
                        score_builder_insight = EXCLUDED.score_builder_insight,
                        score_pattern_novelty = EXCLUDED.score_pattern_novelty,
                        score_gtm_uniqueness = EXCLUDED.score_gtm_uniqueness,
                        score_evidence_quality = EXCLUDED.score_evidence_quality,
                        score_composite = EXCLUDED.score_composite,
                        decision = EXCLUDED.decision,
                        decision_reason = EXCLUDED.decision_reason,
                        has_contradiction = EXCLUDED.has_contradiction,
                        contradictions_json = EXCLUDED.contradictions_json,
                        scoring_method = EXCLUDED.scoring_method
                    """,
                    cid,
                    region,
                    scores.get("builder_insight", 0),
                    scores.get("pattern_novelty", 0),
                    scores.get("gtm_uniqueness", 0),
                    scores.get("evidence_quality", 0),
                    scores.get("composite", 0.0),
                    cluster.gating_decision,
                    cluster.gating_reason or "",
                    bool(
                        cluster.memory_result
                        and cluster.memory_result.has_contradictions
                    ),
                    json.dumps(
                        [
                            {
                                "fact_key": fc.claim.fact_key,
                                "new_value": fc.claim.fact_value,
                                "old_value": fc.existing_value,
                            }
                            for fc in (
                                cluster.memory_result.fact_comparisons
                                if cluster.memory_result
                                else []
                            )
                            if fc.status == "contradiction"
                        ]
                    ),
                    "heuristic",
                )
                # Also update heuristic_scores_json on news_item_extractions
                await conn.execute(
                    """
                    UPDATE news_item_extractions
                    SET heuristic_scores_json = $2::jsonb,
                        updated_at = NOW()
                    WHERE cluster_id = $1::uuid
                    """,
                    cid,
                    json.dumps(scores),
                )
                persisted += 1
            except Exception as exc:
                print(f"[gating:{region}] Decision persist failed for {cluster.cluster_key}: {exc}")

        return persisted

    async def _persist_clusters(
        self,
        conn: asyncpg.Connection,
        clusters: Sequence[StoryCluster],
        *,
        region: str,
        raw_lookup: Dict[Tuple[str, str], str],
    ) -> Dict[str, str]:
        cluster_ids: Dict[str, str] = {}
        for cluster in clusters:
            if self._regional_clusters_supported:
                cluster_id = await conn.fetchval(
                    """
                    INSERT INTO news_clusters (
                        cluster_key, region,
                        canonical_url, title, summary, published_at, updated_at,
                        topic_tags, entities, story_type, source_count, rank_score, rank_reason, trust_score,
                        builder_takeaway, llm_summary, llm_model, llm_signal_score, llm_confidence_score,
                        llm_topic_tags, llm_story_type
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7::text[], $8::text[], $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::text[], $20)
                    ON CONFLICT (cluster_key, region) DO UPDATE
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
                        builder_takeaway = CASE
                            WHEN EXCLUDED.llm_model IS NOT NULL
                              AND EXCLUDED.builder_takeaway IS NOT NULL
                              AND LENGTH(BTRIM(EXCLUDED.builder_takeaway)) > 0
                                THEN EXCLUDED.builder_takeaway
                            WHEN news_clusters.llm_model IS NOT NULL
                                THEN news_clusters.builder_takeaway
                            ELSE NULL
                        END,
                        llm_summary = COALESCE(EXCLUDED.llm_summary, news_clusters.llm_summary),
                        llm_model = COALESCE(EXCLUDED.llm_model, news_clusters.llm_model),
                        llm_signal_score = COALESCE(EXCLUDED.llm_signal_score, news_clusters.llm_signal_score),
                        llm_confidence_score = COALESCE(EXCLUDED.llm_confidence_score, news_clusters.llm_confidence_score),
                        llm_topic_tags = CASE
                            WHEN array_length(EXCLUDED.llm_topic_tags, 1) IS NULL OR array_length(EXCLUDED.llm_topic_tags, 1) = 0
                                THEN news_clusters.llm_topic_tags
                            ELSE EXCLUDED.llm_topic_tags
                        END,
                        llm_story_type = COALESCE(EXCLUDED.llm_story_type, news_clusters.llm_story_type)
                    RETURNING id::text
                    """,
                    cluster.cluster_key,
                    region,
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
            else:
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
                        builder_takeaway = CASE
                            WHEN EXCLUDED.llm_model IS NOT NULL
                              AND EXCLUDED.builder_takeaway IS NOT NULL
                              AND LENGTH(BTRIM(EXCLUDED.builder_takeaway)) > 0
                                THEN EXCLUDED.builder_takeaway
                            WHEN news_clusters.llm_model IS NOT NULL
                                THEN news_clusters.builder_takeaway
                            ELSE NULL
                        END,
                        llm_summary = COALESCE(EXCLUDED.llm_summary, news_clusters.llm_summary),
                        llm_model = COALESCE(EXCLUDED.llm_model, news_clusters.llm_model),
                        llm_signal_score = COALESCE(EXCLUDED.llm_signal_score, news_clusters.llm_signal_score),
                        llm_confidence_score = COALESCE(EXCLUDED.llm_confidence_score, news_clusters.llm_confidence_score),
                        llm_topic_tags = CASE
                            WHEN array_length(EXCLUDED.llm_topic_tags, 1) IS NULL OR array_length(EXCLUDED.llm_topic_tags, 1) = 0
                                THEN news_clusters.llm_topic_tags
                            ELSE EXCLUDED.llm_topic_tags
                        END,
                        llm_story_type = COALESCE(EXCLUDED.llm_story_type, news_clusters.llm_story_type)
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
            primary_idx = 0
            if cluster.primary_source_key and cluster.primary_external_id:
                for i, m in enumerate(ranked_members):
                    if m.source_key == cluster.primary_source_key and m.external_id == cluster.primary_external_id:
                        primary_idx = i
                        break
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
                    i == primary_idx,
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

        daily_brief = await self._llm_generate_daily_brief(conn=conn, edition_date=edition_date, region=region, clusters=clusters)
        if daily_brief:
            stats["daily_brief"] = daily_brief
        else:
            # Preserve existing brief from a previous successful run to avoid
            # erasure when LLM calls fail on re-runs.
            existing = await conn.fetchval(
                "SELECT stats_json->'daily_brief' FROM news_daily_editions WHERE edition_date = $1 AND region = $2",
                edition_date,
                region,
            )
            if existing:
                try:
                    prev = json.loads(existing) if isinstance(existing, str) else existing
                    if isinstance(prev, dict) and prev.get("headline"):
                        stats["daily_brief"] = prev
                        print(f"[news-ingest] preserving existing daily brief for {edition_date} {region}")
                except Exception:
                    pass

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

    # ------------------------------------------------------------------
    # Embedding (semantic search + editorial memory)
    # ------------------------------------------------------------------

    async def _embed_clusters(
        self,
        conn: Any,
        clusters: Sequence,
        cluster_ids: Dict[str, str],
    ) -> Dict[str, Any]:
        """Generate embeddings for newly persisted clusters. Non-blocking."""
        from .embedding import EmbeddingService

        service = EmbeddingService(
            azure_client=self.azure_client,
            deployment_name=self.azure_openai_embedding_deployment,
        )
        try:
            return await service.embed_clusters(conn, clusters, cluster_ids)
        except Exception as exc:
            print(f"[embedding] Non-fatal failure: {exc}")
            return {"skipped": True, "error": str(exc)}

    async def _populate_related_clusters(
        self,
        conn: Any,
        cluster_ids: Dict[str, str],
    ) -> int:
        """Populate related_cluster_ids for newly embedded clusters."""
        from .embedding import EmbeddingService

        service = EmbeddingService(
            azure_client=self.azure_client,
            deployment_name=self.azure_openai_embedding_deployment,
        )
        try:
            new_ids = list(cluster_ids.values())
            return await service.populate_related_clusters(conn, new_ids)
        except Exception as exc:
            print(f"[related-clusters] Non-fatal failure: {exc}")
            return 0

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
                await self._sync_source_activity(conn, DEFAULT_SOURCES)

                if not rebuild_only:
                    collected, collect_errors, sources_attempted = await self._collect_items(conn, lookback_hours)
                    errors.extend(collect_errors)
                    items_fetched = len(collected)
                    items_kept = await self._insert_raw_items(conn, collected)

                items_for_clustering = await self._load_recent_items(conn, lookback_hours)
                clusters = self._cluster_items(items_for_clustering)

                # --- Split into global / turkey clusters FIRST ---
                # Build Turkey-specific cluster copies: Turkey-relevant members
                # (Turkey sources + Turkey-context global coverage) with a TR-safe
                # representative selection to prevent global leakage.
                turkey_source_keys = {s.source_key for s in DEFAULT_SOURCES if (s.region or "global") == "turkey"}
                turkey_clusters: List[StoryCluster] = []
                for c in clusters:
                    tc = _build_turkey_cluster(c, turkey_source_keys)
                    if tc:
                        turkey_clusters.append(tc)

                # --- Memory gate: run per-region (global then turkey) ---
                memory_stats_global = await self._run_memory_gate(conn, clusters, region="global")
                memory_stats_turkey = await self._run_memory_gate(conn, turkey_clusters, region="turkey")
                memory_stats = {
                    "global": memory_stats_global,
                    "turkey": memory_stats_turkey,
                }

                # --- Scoring + gating: heuristic filter (no LLM) ---
                gating_stats_global = await self._run_scoring_and_gating(conn, clusters, region="global")
                gating_stats_turkey = await self._run_scoring_and_gating(conn, turkey_clusters, region="turkey")
                gating_stats = {
                    "global": gating_stats_global,
                    "turkey": gating_stats_turkey,
                }

                # Enrich all clusters with LLM (gated by NEWS_LLM_MAX_CLUSTERS)
                await self._enrich_clusters_with_llm(clusters)
                images_enriched = await self._enrich_missing_images(conn, clusters)

                # Resolve schema capabilities once per run.
                self._regional_clusters_supported = await self._supports_regional_clusters(conn)

                raw_lookup = await self._build_raw_item_lookup(conn)

                # Persist clusters per-region when supported. Otherwise fall back
                # to legacy shared clusters (global-only persistence).
                cluster_ids_global = await self._persist_clusters(conn, clusters, region="global", raw_lookup=raw_lookup)
                if self._regional_clusters_supported:
                    cluster_ids_turkey = await self._persist_clusters(conn, turkey_clusters, region="turkey", raw_lookup=raw_lookup)
                else:
                    cluster_ids_turkey = cluster_ids_global

                # Persist memory gate results per-region
                mem_facts_global = await self._persist_memory_results(conn, clusters, cluster_ids_global, region="global")
                mem_facts_turkey = await self._persist_memory_results(conn, turkey_clusters, cluster_ids_turkey, region="turkey")
                memory_stats["facts_written"] = mem_facts_global + mem_facts_turkey

                # Persist gating decisions per-region
                gating_persisted_global = await self._persist_gating_decisions(conn, clusters, cluster_ids_global, region="global")
                gating_persisted_turkey = await self._persist_gating_decisions(conn, turkey_clusters, cluster_ids_turkey, region="turkey")
                gating_stats["decisions_persisted"] = gating_persisted_global + gating_persisted_turkey

                # --- Embed clusters (non-blocking) ---
                embed_stats = await self._embed_clusters(conn, clusters, cluster_ids_global)
                related_count = await self._populate_related_clusters(conn, cluster_ids_global)

                # Minimal editorial reduction for Turkey feed: hide "drop" clusters.
                turkey_clusters_for_edition = [c for c in turkey_clusters if c.gating_decision != "drop"]

                global_stats = await self._persist_edition(
                    conn,
                    edition_date=e_date,
                    region="global",
                    clusters=clusters,
                    cluster_ids=cluster_ids_global,
                )
                turkey_stats = await self._persist_edition(
                    conn,
                    edition_date=e_date,
                    region="turkey",
                    clusters=turkey_clusters_for_edition,
                    cluster_ids=cluster_ids_turkey,
                )

                stats = {
                    **global_stats,
                    "regions": {
                        "global_total_clusters": int(global_stats.get("total_clusters") or 0),
                        "turkey_total_clusters": int(turkey_stats.get("total_clusters") or 0),
                    },
                    "llm": dict(self._llm_metrics),
                    "memory": memory_stats,
                    "gating": gating_stats,
                    "embedding": embed_stats,
                    "related_clusters_populated": related_count,
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
