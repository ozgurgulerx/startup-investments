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
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple
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

# Intel-first enrichment prompt version — bump when prompt changes to invalidate cache
ENRICHMENT_PROMPT_VERSION = "intel-v2"

# Feature gate: set INTEL_FIRST_PROMPT=true on the VM to enable the new intel-first LLM prompt
INTEL_FIRST_PROMPT_ENABLED = os.getenv("INTEL_FIRST_PROMPT", "false").lower() in ("1", "true", "yes")

INTEL_SOURCE_REVIEW_ERROR_CODES = {
    "intel_source_review_count_missing",
    "intel_source_review_count_mismatch",
    "intel_source_review_urls_missing",
    "intel_source_review_urls_mismatch",
}

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
    # English
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it",
    "its", "of", "on", "or", "that", "the", "to", "with", "will", "new", "startup", "startups",
    # Turkish
    "bir", "ve", "bu", "da", "de", "ile", "için", "olan", "den", "dan", "mi", "mı",
}

GENERIC_ENTITIES = {
    "AI", "Startup", "Startups", "Today", "Breaking", "News", "Tech", "Series", "Funding", "Round",
}

TOPIC_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "funding": ("raises", "raised", "funding", "series a", "series b", "series c", "seed", "pre-seed", "valuation"),
    "ai": ("ai", "genai", "llm", "model", "agent", "inference", "gpu", "foundation model"),
    "ai_hardware": (
        "hbm",
        "nvlink",
        "ualink",
        "pcie",
        "cxl",
        "cowos",
        "interconnect",
        "infiniband",
        "ethernet",
        "ndr",
        "xdr",
        "liquid cooling",
        "rack-scale",
        "rack scale",
        "power delivery",
        "gpu",
        "gpus",
        "asic",
        "asics",
        "tpu",
        "trainium",
        "packaging",
        "wafer",
        "foundry",
        "memory",
    ),
    "launch": ("launch", "launched", "debut", "introduces", "release", "released", "product hunt"),
    "mna": ("acquire", "acquisition", "merger", "buys", "deal"),
    "hiring": ("hiring", "careers", "joins", "appointed", "head of"),
    "regulation": ("regulation", "compliance", "policy", "law", "act", "eu ai act", "ftc", "sec"),
    "security": ("security", "breach", "vulnerability", "cyber", "zero-day"),
}

AI_HARDWARE_TOPIC_TAG = "AI Hardware"
AI_HARDWARE_KEYWORDS: Tuple[str, ...] = (
    "hbm",
    "nvlink",
    "ualink",
    "pcie",
    "cxl",
    "cowos",
    "wafer",
    "foundry",
    "interconnect",
    "infiniband",
    "ethernet",
    "ndr",
    "xdr",
    "liquid cooling",
    "rack-scale",
    "rack scale",
    "power delivery",
    "gpus",
    "gpu",
    "asic",
    "asics",
    "tpu",
    "trainium",
    "packaging",
    "memory",
)

ALLOWED_STORY_TYPES = {
    "funding",
    "launch",
    "mna",
    "regulation",
    "hiring",
    "news",
    "investigation",
    "research",
    "analysis",
    "interview",
}

AI_HARDWARE_SOURCE_KEYS: Tuple[str, ...] = (
    "semianalysis",
    "nextplatform",
    "servethehome",
    "chipsandcheese",
    "eetimes_ai_accelerator",
    "blocksandfiles",
    "datacenterdynamics_ai",
    "theregister_ai_datacenter",
    "trendforce",
    "reuters_technology",
    "mlcommons_mlperf",
    "nvidia_developer_blog",
    "amd_ir",
    "intel_newsroom_ai",
)
AI_HARDWARE_SOURCE_KEY_SET = frozenset(AI_HARDWARE_SOURCE_KEYS)

IMPACT_FRAMES = {
    "UNDERWRITING_TAKE", "ADOPTION_PLAY", "COST_CURVE", "LATENCY_LEVER",
    "BENCHMARK_TRAP", "DATA_MOAT", "PROCUREMENT_WEDGE", "REGULATORY_CONSTRAINT",
    "ATTACK_SURFACE", "CONSOLIDATION_SIGNAL", "HIRING_SIGNAL",
    "PLATFORM_SHIFT", "GO_TO_MARKET_EDGE", "EARLY_SIGNAL",
}

FRAME_LABELS = {
    "UNDERWRITING_TAKE": "Underwriting Take",
    "ADOPTION_PLAY": "Adoption Play",
    "COST_CURVE": "Cost Curve",
    "LATENCY_LEVER": "Latency Lever",
    "BENCHMARK_TRAP": "Benchmark Trap",
    "DATA_MOAT": "Data Moat",
    "PROCUREMENT_WEDGE": "Procurement Wedge",
    "REGULATORY_CONSTRAINT": "Regulatory Constraint",
    "ATTACK_SURFACE": "Attack Surface",
    "CONSOLIDATION_SIGNAL": "Consolidation Signal",
    "HIRING_SIGNAL": "Hiring Signal",
    "PLATFORM_SHIFT": "Platform Shift",
    "GO_TO_MARKET_EDGE": "Go-to-Market Edge",
    "EARLY_SIGNAL": "Early Signal",
}

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

# Superset of TR_CONTEXT_KEYWORDS — any signal that an article has a Turkey connection.
# Used by _has_turkey_nexus() to reject foreign startup news from Turkish-language sources.
TR_NEXUS_SIGNALS: Tuple[str, ...] = (
    # Country / nationality
    "türkiye", "turkiye", "turkey", "türk", "turk", "turkish",
    # Major cities
    "istanbul", "ankara", "izmir", "antalya", "bursa", "gaziantep",
    "eskişehir", "eskisehir", "kocaeli", "konya", "adana", "mersin",
    "kayseri", "samsun", "trabzon", "diyarbakır", "diyarbakir",
    # Institutions / regulators
    "tübitak", "tubitak", "kosgeb", "teknopark", "teknokent",
    "borsa istanbul", "borsa İstanbul", "bist", "spk", "btk", "bddk",
    "tobb", "müsiad", "musiad", "tüsiad", "tusiad",
    # Corporate suffixes (Turkish legal forms)
    "a.ş.", "a.s.",
)

# Well-known Turkish startups whose name alone signals Turkey relevance.
TR_KNOWN_ENTITIES: Tuple[str, ...] = (
    "getir", "trendyol", "hepsiburada", "peak games", "dream games",
    "papara", "insider", "iyzico", "jotform", "opsgenie", "foriba",
    "parasut", "paraşüt", "modanisa", "armut", "scotty", "vivense",
    "tapu.com", "martı", "marti", "obilet", "ikas", "storyly",
    "segmentify", "rakam", "useinsider", "clockin", "fibabanka",
    "colendi", "param", "simpra", "logo yazılım", "logo yazilim",
    "softtech", "intertech", "etiya", "akinon", "invio",
)

# Sources that exclusively cover the Turkish ecosystem — exempt from nexus check.
TR_ENDEMIC_SOURCES: frozenset = frozenset({
    "startups_watch", "vc_212", "finberg", "endeavor_turkey",
    "startupcentrum_tr", "vc_turkey_blogs", "startup_owned_feeds",
})

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
    fetch_mode: str = "rss"  # rss|api|crawler|digest_rss|x_recent_search|paid_headlines|latest_posts
    enabled: bool = True  # if False, source is kept in registry but skipped by collector
    credibility_weight: float = 0.65
    legal_mode: str = "headline_snippet"
    language: str = ""  # override auto-detection (e.g. "en" for English Turkey sources)
    lookback_hours_override: int = 0  # 0 = use global default; set >0 for low-frequency sources
    topic_tags: Tuple[str, ...] = ()  # deterministic tags forced for all clusters sourced from this source
    crawl_seed_urls: Tuple[str, ...] = ()  # optional alternate entry URLs (seed pages for latest-posts modes)
    crawl_delay_ms: int = 500  # polite pacing between page fetches when frontier-style crawling
    max_items_per_source: int = 0  # override max items for this source (0 = use self.max_per_source)


@dataclass
class SourceFetchResult:
    """Outcome of a single source fetch attempt for health tracking."""
    source_key: str
    success: bool
    items_count: int = 0
    duration_ms: int = 0
    error: str = ""


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
    # SemiAnalysis RSS appears low-frequency and may not reflect the most recent updates.
    # Keep a long lookback window so we still ingest the latest feed entries reliably.
    SourceDefinition(
        "semianalysis",
        "SemiAnalysis",
        "rss",
        "https://semianalysis.com/feed/",
        credibility_weight=0.90,
        language="en",
        lookback_hours_override=8760,
        topic_tags=(AI_HARDWARE_TOPIC_TAG,),
    ),
    SourceDefinition("webrazzi", "Webrazzi", "rss", "https://webrazzi.com/feed/", region="turkey", credibility_weight=0.74),
    SourceDefinition("egirisim", "Egirisim", "rss", "https://egirisim.com/feed/", region="turkey", credibility_weight=0.70),
    # Turkey: AI-focused feeds (keeps the Turkey edition AI-heavy without pulling in consumer-tech noise)
    SourceDefinition("webrazzi_yapay_zeka", "Webrazzi (Yapay Zeka)", "rss", "https://webrazzi.com/etiket/yapay-zeka/feed/", region="turkey", credibility_weight=0.76, language="tr"),
    SourceDefinition("egirisim_yapay_zeka", "Egirisim (Yapay Zeka)", "rss", "https://egirisim.com/etiket/yapay-zeka/feed/", region="turkey", credibility_weight=0.72, language="tr"),
    SourceDefinition("techinside_yapay_zeka", "TechInside (Yapay Zeka)", "rss", "https://www.techinside.com/yapay-zeka/feed/", region="turkey", credibility_weight=0.65, language="tr"),
    SourceDefinition("turkiye_ai", "Turkiye AI (TRAI)", "rss", "https://turkiye.ai/feed/", region="turkey", credibility_weight=0.66, language="tr", lookback_hours_override=168),
    # Turkey: API sources (Turkish language queries via existing API keys)
    SourceDefinition("gnews_turkey", "GNews Turkey", "api", "https://gnews.io/api/v4/search", region="turkey", fetch_mode="api", credibility_weight=0.66),
    SourceDefinition("newsapi_turkey", "NewsAPI Turkey", "api", "https://newsapi.org/v2/everything", region="turkey", fetch_mode="api", credibility_weight=0.67),
    # Turkey: Additional RSS sources (Turkish ecosystem-focused)
    SourceDefinition("foundern", "FounderN", "rss", "https://foundern.com/feed/", region="turkey", credibility_weight=0.72, language="en"),
    SourceDefinition("swipeline", "Swipeline", "rss", "https://swipeline.co/feed/", region="turkey", credibility_weight=0.70, language="en"),
    SourceDefinition("n24_business", "N24 Business", "rss", "https://n24.com.tr/feed", region="turkey", credibility_weight=0.60),
    SourceDefinition("daily_sabah_tech", "Daily Sabah Tech", "rss", "https://www.dailysabah.com/rss/business/tech", region="turkey", credibility_weight=0.58, language="en"),
    SourceDefinition("startups_watch", "Startups.watch", "rss", "https://medium.com/feed/startups-watch", region="turkey", credibility_weight=0.75, language="en"),
    # Turkey: VC & ecosystem RSS feeds
    SourceDefinition("vc_212", "212 VC", "rss", "https://212.vc/feed/", region="turkey", credibility_weight=0.70, language="en", lookback_hours_override=168),
    SourceDefinition("finberg", "Finberg", "rss", "https://finberg.com.tr/feed", region="turkey", credibility_weight=0.68, lookback_hours_override=168),
    SourceDefinition("endeavor_turkey", "Endeavor Türkiye", "rss", "https://turkiye.endeavor.org/feed", region="turkey", credibility_weight=0.68, lookback_hours_override=168),
    SourceDefinition("startupcentrum_tr", "StartupCentrum TR", "rss", "https://media.startupcentrum.com/tr/feed", region="turkey", credibility_weight=0.65, lookback_hours_override=168),
    # Turkey: VC blog crawler (non-RSS VC sites — tries RSS discovery, falls back to HTML)
    SourceDefinition("vc_turkey_blogs", "Turkey VC Blogs", "crawler", "vc://turkey-blogs", region="turkey", fetch_mode="crawler", credibility_weight=0.65, lookback_hours_override=168),
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
    # AI Hardware news pack (chip/AI infra + AI datacenter coverage)
    SourceDefinition("nextplatform", "The Next Platform", "rss", "https://www.nextplatform.com/feed/", topic_tags=(AI_HARDWARE_TOPIC_TAG,), max_items_per_source=20, crawl_delay_ms=650),
    SourceDefinition("servethehome", "ServeTheHome", "rss", "https://www.servethehome.com/feed/", topic_tags=(AI_HARDWARE_TOPIC_TAG,), max_items_per_source=20, crawl_delay_ms=700),
    SourceDefinition("chipsandcheese", "Chips and Cheese", "rss", "https://chipsandcheese.com/feed/", topic_tags=(AI_HARDWARE_TOPIC_TAG,), max_items_per_source=20, crawl_delay_ms=650),
    SourceDefinition(
        "eetimes_ai_accelerator",
        "EE Times (AI accelerator)",
        "rss",
        "https://www.eetimes.com/tag/ai-accelerator/feed/",
        topic_tags=(AI_HARDWARE_TOPIC_TAG,),
        max_items_per_source=20,
        crawl_delay_ms=800,
    ),
    SourceDefinition("blocksandfiles", "Blocks & Files", "rss", "https://blocksandfiles.com/feed/", topic_tags=(AI_HARDWARE_TOPIC_TAG,), max_items_per_source=20, crawl_delay_ms=700),
    SourceDefinition(
        "datacenterdynamics_ai",
        "DataCenterDynamics (AI)",
        "crawler",
        "https://www.datacenterdynamics.com/en/news/",
        topic_tags=(AI_HARDWARE_TOPIC_TAG,),
        fetch_mode="latest_posts",
        crawl_seed_urls=("https://www.datacenterdynamics.com/en/news/", "https://www.datacenterdynamics.com/en/news/tag/semiconductor/"),
        max_items_per_source=20,
        crawl_delay_ms=850,
    ),
    SourceDefinition(
        "theregister_ai_datacenter",
        "The Register (AI/Datacenter)",
        "crawler",
        "https://www.theregister.com/",
        topic_tags=(AI_HARDWARE_TOPIC_TAG,),
        fetch_mode="latest_posts",
        crawl_seed_urls=("https://www.theregister.com", "https://www.theregister.com/AI/", "https://www.theregister.com/Datacenter/"),
        max_items_per_source=20,
        crawl_delay_ms=900,
    ),
    SourceDefinition(
        "trendforce",
        "TrendForce",
        "crawler",
        "https://www.trendforce.com/",
        topic_tags=(AI_HARDWARE_TOPIC_TAG,),
        fetch_mode="latest_posts",
        crawl_seed_urls=("https://www.trendforce.com/",),
        max_items_per_source=20,
        crawl_delay_ms=900,
    ),
    SourceDefinition(
        "reuters_technology",
        "Reuters (Technology) (manual-only)",
        "community",
        "https://www.reuters.com/technology/",
        enabled=False,
        topic_tags=(AI_HARDWARE_TOPIC_TAG,),
        crawl_seed_urls=(),
        legal_mode="manual_only",
        fetch_mode="manual_only",
        max_items_per_source=0,
    ),
    SourceDefinition(
        "mlcommons_mlperf",
        "MLCommons MLPerf",
        "crawler",
        "https://mlcommons.org/benchmarks/",
        topic_tags=(AI_HARDWARE_TOPIC_TAG,),
        fetch_mode="latest_posts",
        crawl_seed_urls=("https://mlcommons.org/benchmarks/",),
        max_items_per_source=20,
        crawl_delay_ms=600,
    ),
    SourceDefinition(
        "nvidia_developer_blog",
        "NVIDIA Developer Blog",
        "crawler",
        "https://developer.nvidia.com/blog/",
        topic_tags=(AI_HARDWARE_TOPIC_TAG,),
        fetch_mode="latest_posts",
        crawl_seed_urls=("https://developer.nvidia.com/blog/",),
        max_items_per_source=20,
        crawl_delay_ms=500,
    ),
    SourceDefinition(
        "amd_ir",
        "AMD IR / Newsroom",
        "crawler",
        "https://ir.amd.com",
        topic_tags=(AI_HARDWARE_TOPIC_TAG,),
        fetch_mode="latest_posts",
        crawl_seed_urls=("https://ir.amd.com",),
        max_items_per_source=20,
        crawl_delay_ms=700,
    ),
    SourceDefinition(
        "intel_newsroom_ai",
        "Intel Newsroom (AI)",
        "crawler",
        "https://newsroom.intel.com/artificial-intelligence/",
        topic_tags=(AI_HARDWARE_TOPIC_TAG,),
        fetch_mode="latest_posts",
        crawl_seed_urls=("https://newsroom.intel.com/artificial-intelligence/",),
        max_items_per_source=20,
        crawl_delay_ms=700,
    ),
    # Big-tech startup program blogs
    SourceDefinition("ms_startups", "Microsoft for Startups", "rss", "https://www.microsoft.com/en-us/startups/blog/feed/", credibility_weight=0.68),
    SourceDefinition("aws_ml_blog", "AWS ML Blog", "rss", "https://aws.amazon.com/blogs/machine-learning/feed/", credibility_weight=0.65),
    SourceDefinition("google_startups", "Google for Startups", "rss", "https://blog.google/outreach-initiatives/entrepreneurs/rss/", credibility_weight=0.62),
    SourceDefinition("producthunt_api", "Product Hunt API", "api", "https://api.producthunt.com/v2/api/graphql", fetch_mode="api", credibility_weight=0.86),
    SourceDefinition("hackernews_api", "Hacker News API", "api", "https://hacker-news.firebaseio.com/v0", fetch_mode="api", credibility_weight=0.88),
    SourceDefinition("newsapi", "NewsAPI", "api", "https://newsapi.org/v2/everything", fetch_mode="api", credibility_weight=0.67),
    SourceDefinition("gnews", "GNews", "api", "https://gnews.io/api/v4/search", fetch_mode="api", credibility_weight=0.66),
    # Paid source leads (headline-only); used as triggers for open-web corroboration.
    SourceDefinition(
        "theinformation",
        "The Information",
        "community",
        "https://www.theinformation.com",
        fetch_mode="paid_headlines",
        credibility_weight=0.05,
        legal_mode="headline_only",
    ),
    SourceDefinition("x_recent_search_global", "X Recent Search (Global)", "api", "https://api.x.com/2/tweets/search/recent", fetch_mode="x_recent_search", credibility_weight=0.64),
    SourceDefinition("x_recent_search_turkey", "X Recent Search (Turkey)", "api", "https://api.x.com/2/tweets/search/recent", region="turkey", fetch_mode="x_recent_search", credibility_weight=0.65, language="tr"),
    # Diff-based sources (daily snapshots + deltas), fetched from the hourly job.
    SourceDefinition("github_trending_ai", "GitHub Trending AI (Search)", "api", "github://search/repositories", fetch_mode="api", credibility_weight=0.70),
    SourceDefinition("amazon_new_releases_ai", "Amazon New Releases (AI Books)", "community", "amazon://new-releases", fetch_mode="api", credibility_weight=0.55),
    SourceDefinition("frontier_news", "Frontier News URLs", "crawler", "frontier://news", fetch_mode="crawler", credibility_weight=0.62),
    SourceDefinition("startup_owned_feeds", "Startup-Owned Sources", "crawler", "startup://owned", fetch_mode="crawler", credibility_weight=0.79),
    # Newsletter digests (parsed into individual items)
    SourceDefinition("ainews_digest", "AINews by swyx", "rss", "https://news.smol.ai/rss.xml", fetch_mode="digest_rss", credibility_weight=0.88, language="en"),
    SourceDefinition("latentspace_digest", "Latent Space by swyx", "rss", "https://www.latent.space/feed", fetch_mode="digest_rss", credibility_weight=0.85, language="en", lookback_hours_override=168),
    # Research papers (community-curated trending arXiv papers)
    SourceDefinition("huggingface_papers", "HF Daily Papers", "api", "https://huggingface.co/api/daily_papers", fetch_mode="api", credibility_weight=0.72),
]


SOURCE_TOPIC_TAGS_BY_SOURCE: Dict[str, Tuple[str, ...]] = {
    src.source_key: tuple(
        str(tag).strip().lower()
        for tag in src.topic_tags
        if str(tag).strip()
    )
    for src in DEFAULT_SOURCES
}


def _source_topic_tags_for_members(members: Sequence["NormalizedNewsItem"]) -> Tuple[str, ...]:
    tags: List[str] = []
    seen: set[str] = set()
    for item in members:
        for tag in SOURCE_TOPIC_TAGS_BY_SOURCE.get(item.source_key, ()):
            if tag and tag not in seen:
                tags.append(tag)
                seen.add(tag)
    return tuple(tags)


def _apply_source_topic_overrides(topic_tags: Sequence[str], members: Sequence["NormalizedNewsItem"]) -> List[str]:
    ordered: List[str] = []
    seen: set[str] = set()
    for tag in topic_tags:
        normalized = str(tag).strip().lower()
        if normalized and normalized not in seen:
            ordered.append(normalized)
            seen.add(normalized)
    for tag in _source_topic_tags_for_members(members):
        if tag and tag not in seen:
            ordered.append(tag)
            seen.add(tag)
    if not ordered:
        ordered = ["startup"]
    return ordered


def _effective_source_limit(source: SourceDefinition, fallback: int) -> int:
    if source.max_items_per_source and source.max_items_per_source > 0:
        return int(source.max_items_per_source)
    return int(fallback)


# Turkish VC & ecosystem blog URLs (no usable RSS feed).
# Each tuple is (VC name, homepage or blog URL).
_TURKEY_VC_BLOG_URLS: Tuple[Tuple[str, str], ...] = (
    ("500 Istanbul", "https://istanbul.500.co"),
    ("ACT Venture Partners", "https://actvp.vc"),
    ("APY Ventures", "https://www.apyventures.com"),
    ("Aksoy Internet Ventures", "https://aksoyinternetventures.com"),
    ("Alarko Ventures", "https://alarkoventures.com"),
    ("Aslanoba Capital", "https://aslanobacapital.com"),
    ("Atanova Venture", "https://atanova.vc"),
    ("AeroBased", "https://aerobased.com"),
    ("BIST Private Market", "https://bistprivatemarket.com"),
    ("Boğaziçi Ventures", "https://bogaziciventures.com"),
    ("DCP", "https://dcp.com.tr"),
    ("Driventure", "https://driventure.com"),
    ("Eczacıbaşı Momentum", "https://momentum.eczacibasi.com.tr"),
    ("e2vc", "https://e2.vc"),
    ("Esas Ventures", "https://esasventures.com"),
    ("Founder One", "https://founderone.vc"),
    ("Idacapital", "https://idacapital.com"),
    ("Inventram", "https://inventram.com"),
    ("Lima Ventures", "https://limaventures.com"),
    ("Logo Ventures", "https://logoventures.com.tr"),
    ("MMV Capital Partners", "https://mmvcapital.com"),
    ("Omurga Capital", "https://omurga.vc"),
    ("QNBEYOND Ventures", "https://qnbeyond.com"),
    ("RePie", "https://repie.com.tr"),
    ("ScaleX Ventures", "https://scalexventures.com"),
    ("StartupFon", "https://startupfon.com"),
    ("Teknoloji Yatırım", "https://teknolojiyatirim.com.tr"),
    ("TT Ventures", "https://ttventures.com.tr"),
    ("Türk Telekom Ventures", "https://turktelekom.com.tr/en/ventures"),
    ("Turkey Development Fund", "https://tvkf.com.tr"),
    ("Turkcell GSYF", "https://turkcellgsyf.com.tr"),
    ("Yapay Zeka Fabrikası", "https://yapayzekafabrikasi.com"),
)


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
    # Research context (populated from news_clusters.research_context by prior research runs)
    research_context: Optional[Dict[str, Any]] = None
    # Structured impact object (populated by LLM enrichment)
    impact: Optional[Dict[str, Any]] = None
    # Intel-first enrichment fields
    ba_title: Optional[str] = None
    ba_bullets: Optional[List[str]] = None
    why_it_matters: Optional[str] = None
    evidence_json: Optional[List[Dict[str, Any]]] = None
    enrichment_hash: Optional[str] = None
    prompt_version: Optional[str] = None


@dataclass
class LLMEnrichmentResult:
    llm_summary: Optional[str]
    builder_takeaway: Optional[str]
    llm_model: Optional[str]
    llm_signal_score: Optional[float]
    llm_confidence_score: Optional[float]
    llm_topic_tags: Optional[List[str]]
    llm_story_type: Optional[str]
    impact: Optional[Dict[str, Any]] = None
    timed_out: bool = False
    error_code: Optional[str] = None
    ba_title: Optional[str] = None
    ba_bullets: Optional[List[str]] = None
    why_it_matters: Optional[str] = None


def _build_evidence_json(cluster: StoryCluster) -> List[Dict[str, Any]]:
    """Build structured evidence from cluster members (deterministic, zero LLM cost)."""
    evidence: List[Dict[str, Any]] = []
    seen_sources: set[str] = set()
    for member in cluster.members:
        if member.source_key in seen_sources:
            continue
        seen_sources.add(member.source_key)
        entry: Dict[str, Any] = {
            "publisher": member.source_key,
            "url": member.url,
            "canonical_url": member.canonical_url,
            "published_at": member.published_at.isoformat() if member.published_at else None,
        }
        if member.author:
            entry["author"] = member.author
        if member.payload:
            if member.payload.get("fetched_at"):
                entry["fetched_at"] = str(member.payload["fetched_at"])
            if member.payload.get("paywalled"):
                entry["paywalled"] = True
        evidence.append(entry)
    return evidence


def _compute_enrichment_hash(cluster: StoryCluster) -> str:
    """SHA-256 of sorted canonical URLs + lowercase title — used for LLM cache invalidation."""
    urls = sorted(m.canonical_url for m in cluster.members if m.canonical_url)
    raw = "|".join(urls) + "|" + (cluster.title or "").strip().lower()
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _truncate_at_word(text: str, max_len: int) -> str:
    """Truncate text to max_len at the nearest word boundary, avoiding mid-word cuts."""
    if len(text) <= max_len:
        return text
    # Leave room for ellipsis
    cut = text[: max_len - 1].rsplit(" ", 1)[0]
    # If no space found (single giant word), hard cut
    if not cut:
        cut = text[: max_len - 1]
    return cut.rstrip(",-—:; ") + "\u2026"


def _validate_intel_fields(
    result: LLMEnrichmentResult,
    cluster_title: str = "",
    cluster_summary: str = "",
    member_titles: Optional[Sequence[str]] = None,
) -> Optional[str]:
    """Enforce hard caps and validation rules on intel-first enrichment fields (mutates in place)."""
    validation_error: Optional[str] = None

    # ba_title: hard cap 90 chars (prompt targets 80; truncate at word boundary as safety net)
    if result.ba_title:
        if len(result.ba_title) > 90:
            result.ba_title = _truncate_at_word(result.ba_title, 90)

    # why_it_matters: hard cap 160 chars (truncate at word boundary)
    if result.why_it_matters:
        if len(result.why_it_matters) > 160:
            result.why_it_matters = _truncate_at_word(result.why_it_matters, 160)

    # ba_bullets: max 4 items, each <=180 chars (truncate at word boundary)
    if result.ba_bullets:
        result.ba_bullets = result.ba_bullets[:4]
        for i, bullet in enumerate(result.ba_bullets):
            if len(bullet) > 180:
                result.ba_bullets[i] = _truncate_at_word(bullet, 180)

        # Anti-copy heuristic: flag bullets with >40 char overlap with title/summary
        ref_texts = [cluster_title.lower(), cluster_summary.lower()]
        cleaned: List[str] = []
        for bullet in result.ba_bullets:
            bl = bullet.lower()
            flagged = False
            for ref in ref_texts:
                if ref and len(ref) >= 40:
                    # Check for 40-char substring match
                    for start in range(0, len(bl) - 39):
                        chunk = bl[start : start + 40]
                        if chunk in ref:
                            flagged = True
                            break
                if flagged:
                    break
            if flagged:
                # Truncate overlapping bullet instead of removing
                cleaned.append(bullet[:80] + "..." if len(bullet) > 80 else bullet)
            else:
                cleaned.append(bullet)
        result.ba_bullets = cleaned

    # Title anti-copy heuristic: reject intel fields when title mirrors source headlines.
    if result.ba_title and member_titles:
        ba_norm = normalize_text(result.ba_title).lower()
        for ref_title in member_titles:
            ref_norm = normalize_text(ref_title).lower()
            if not ref_norm:
                continue

            # Catch exact or near-exact headline reuse.
            if ba_norm == ref_norm or title_similarity(result.ba_title, ref_title) >= 0.86:
                result.ba_title = None
                result.ba_bullets = None
                result.why_it_matters = None
                validation_error = "intel_title_too_similar_source"
                break

            # Catch long substring overlap in either direction.
            if len(ba_norm) >= 28 and ba_norm in ref_norm:
                result.ba_title = None
                result.ba_bullets = None
                result.why_it_matters = None
                validation_error = "intel_title_too_similar_source"
                break
            if len(ref_norm) >= 28 and ref_norm in ba_norm:
                result.ba_title = None
                result.ba_bullets = None
                result.why_it_matters = None
                validation_error = "intel_title_too_similar_source"
                break

    return validation_error


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


def _repo_root() -> Path:
    # packages/analysis/src/automation/news_ingest.py -> repo root
    return Path(__file__).resolve().parents[4]


def _slack_notify_script() -> Path:
    return _repo_root() / "scripts" / "slack_notify.py"


def _send_slack_notification(
    *,
    title: str,
    status: str,
    body: str,
    context: Optional[Dict[str, Any]] = None,
) -> bool:
    """Best-effort Slack notify via scripts/slack_notify.py (no-op if not configured)."""
    script_path = _slack_notify_script()
    if not script_path.exists():
        return False

    env = os.environ.copy()
    env["SLACK_TITLE"] = title
    env["SLACK_STATUS"] = status
    env["SLACK_BODY"] = body
    # Optional machine-readable bits (rendered as Slack context lines).
    if context:
        try:
            env["SLACK_CONTEXT_JSON"] = json.dumps(context, ensure_ascii=True)
        except Exception:
            pass

    # Avoid stale buttons; we embed any needed links directly in the body.
    env.pop("SLACK_URL", None)

    try:
        completed = subprocess.run(
            [sys.executable, str(script_path)],
            env=env,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except Exception:
        return False

    return completed.returncode == 0


def normalize_text(value: str) -> str:
    cleaned = (value or "").replace("\x00", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def _sanitize_for_pg(obj):
    """Recursively strip null bytes from strings in a JSON-serializable structure."""
    if isinstance(obj, str):
        return obj.replace("\x00", "")
    if isinstance(obj, dict):
        return {k: _sanitize_for_pg(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_pg(v) for v in obj]
    return obj


def _is_lead_only_item(item: "NormalizedNewsItem") -> bool:
    """True when an item is a headline-only lead (e.g. paywalled seed URL)."""
    try:
        return bool((item.payload or {}).get("lead_only"))
    except Exception:
        return False


def _non_lead_members(members: Sequence["NormalizedNewsItem"]) -> List["NormalizedNewsItem"]:
    return [m for m in members if not _is_lead_only_item(m)]


def _count_non_lead_members(members: Sequence["NormalizedNewsItem"]) -> int:
    return len(_non_lead_members(members))


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


def _parse_open_datetime(raw: Any) -> Optional[datetime]:
    """Best-effort parser for timestamp-like strings from HTML attrs/text."""
    if raw is None:
        return None
    value = normalize_text(str(raw))
    if not value:
        return None

    candidates = [value]
    lower = value.lower()
    if lower.endswith("z"):
        candidates.append(value[:-1] + "+00:00")
    if "." in value:
        candidates.append(re.sub(r"\.(\d{3,})", ".000", value))
        candidates.append(value.replace(".", "", 1))

    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            else:
                parsed = parsed.astimezone(timezone.utc)
            return parsed
        except Exception:
            pass

    # Common human-readable variants.
    parsed_formats = [
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%B %d, %Y",
        "%b %d, %Y",
        "%Y/%m/%d",
        "%m/%d/%Y",
        "%d %b %Y",
    ]
    for fmt in parsed_formats:
        try:
            dt = datetime.strptime(value, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            continue
    return None


def parse_theinformation_technology_headlines(
    html: str,
    section_url: str,
    max_items: int = 40,
) -> List[Dict[str, Any]]:
    """Extract headline links from The Information technology page HTML.

    Returns a list of dicts with `url`, `canonical_url`, optional `title`, and
    optional `published_at`.
    """
    html = html or ""
    limit = max(1, int(max_items))
    section = normalize_text(section_url)
    if not section:
        return []

    seen: set[str] = set()
    out: List[Dict[str, Any]] = []

    def _record(raw_url: str, title: str = "", published_at: Optional[datetime] = None) -> None:
        if len(out) >= limit:
            return
        url = normalize_text(raw_url)
        if not url:
            return
        if any(fragment in url.lower() for fragment in ("javascript:", "mailto:", "tel:", "#")):
            return
        if url.startswith("/"):
            url = urljoin(section, url)
        if not url.startswith(("http://", "https://")):
            return
        parsed = urlparse(url)
        host = (parsed.netloc or "").lower()
        if not host.endswith("theinformation.com"):
            return
        path = normalize_text(parsed.path).lower()
        if "/articles/" not in path:
            return
        canonical = canonicalize_url(url)
        if canonical in seen:
            return
        safe_title = normalize_text(title or "")
        seen.add(canonical)
        out.append({
            "url": url,
            "canonical_url": canonical,
            "title": safe_title,
            "published_at": published_at,
        })

    if BeautifulSoup is None:
        # Regex fallback if bs4 isn't installed.
        for m in re.finditer(
            r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
            html,
            flags=re.I | re.S,
        ):
            if len(out) >= limit:
                break
            href = normalize_text(m.group(1))
            text = re.sub(r"<[^>]+>", " ", m.group(2) or "")
            title = normalize_text(text)
            _record(href, title, None)
        return out[:limit]

    soup = BeautifulSoup(html, "html.parser")
    for anchor in soup.find_all("a", href=True):
        if len(out) >= limit:
            break
        href = str(anchor.get("href") or "")

        # Prefer explicit publication date in/near anchor tag.
        candidate_dt: Optional[datetime] = None
        for probe in [anchor, getattr(anchor, "parent", None), getattr(getattr(anchor, "parent", None), "parent", None)]:
            if not probe:
                continue
            if not hasattr(probe, "find"):
                continue
            time_node = probe.find("time")
            if time_node:
                candidate_dt = _parse_open_datetime(time_node.get("datetime") or time_node.get_text(" ", strip=True))
            if candidate_dt is not None:
                break

        if candidate_dt is None:
            candidate_dt = _parse_open_datetime(anchor.get("data-date") or anchor.get("data-time") or anchor.get("title"))

        text = normalize_text(anchor.get_text(" ", strip=True))
        _record(href, text, candidate_dt)

        # A single page often includes duplicates in nested anchors; avoid extra loops.
        if len(out) >= limit:
            break

    return out[:limit]


def tokenize_title(title: str) -> List[str]:
    raw = re.findall(r"[\w]+", title.lower(), re.UNICODE)
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


_TR_UPPER = "ÇĞİÖŞÜ"
_TR_LOWER = "çğıöşü"


def extract_entities(title: str) -> List[str]:
    pattern = re.compile(
        rf"\b([A-Z{_TR_UPPER}][a-zA-Z{_TR_LOWER}{_TR_UPPER}0-9&.-]*"
        rf"(?:\s+[A-Z{_TR_UPPER}][a-zA-Z{_TR_LOWER}{_TR_UPPER}0-9&.-]*)"
        r"{0,2})\b"
    )
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


_PAID_HEADLINE_QUERY_STOPWORDS = {
    "top",
    "most",
    "biggest",
    "funded",
}


def build_paid_headline_search_query(title: str) -> str:
    """Build a conservative open-web corroboration query from a paid headline.

    We never try to reconstruct paywalled content. This query is used to find
    independent accessible coverage (e.g. via GNews/NewsAPI).
    """
    title_norm = normalize_text(title or "")
    if not title_norm:
        return ""

    anchor = ""
    for entity in extract_entities(title_norm):
        cand = normalize_text(entity)
        if not cand:
            continue
        if cand in GENERIC_ENTITIES:
            continue
        # Avoid adjective-y matches like "Top-funded" that pollute queries.
        if "-" in cand:
            continue
        # Avoid short acronyms as anchors (we prefer proper names).
        if len(cand) < 3:
            continue
        if cand.isupper() and len(cand) <= 4:
            continue
        anchor = cand
        break

    tokens = tokenize_title(title_norm)
    used: Set[str] = set()
    if anchor:
        used.add(anchor.lower())

    parts: List[str] = []
    if anchor:
        parts.append(f"\"{anchor}\"")

    for tok in tokens:
        if tok in used:
            continue
        if tok in _PAID_HEADLINE_QUERY_STOPWORDS:
            continue
        parts.append(tok)
        used.add(tok)
        if len(parts) >= 6:
            break

    if not parts:
        # Worst-case fallback: a compacted title query (still safe; it's just a search string).
        parts = [re.sub(r"\s+", " ", title_norm)[:120]]

    query = " ".join(parts).strip()
    return query[:200]


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
    signal_score: float = 0.0,
) -> Tuple[float, float, str]:
    now_ts = now or datetime.now(timezone.utc)
    age_hours = max(0.0, (now_ts - published_at).total_seconds() / 3600.0)
    recency = max(0.0, 1.0 - (age_hours / 72.0))

    # Lead-only items (e.g. paywalled headline seeds) should not inflate
    # source diversity/credibility/engagement for scoring.
    effective_members = _non_lead_members(members)
    if effective_members:
        source_weight = max((m.source_weight for m in effective_members), default=0.6)
        diversity = min(1.0, len({m.source_key for m in effective_members}) / 4.0)
    else:
        source_weight = 0.05
        diversity = 0.0
    engagement_raw = 0.0
    for item in effective_members:
        points = float(item.engagement.get("points") or item.engagement.get("votes") or 0.0)
        engagement_raw = max(engagement_raw, min(1.0, points / 500.0))

    member_text = " ".join(
        [
            item.title + " " + (item.summary or "")
            for item in effective_members
        ]
    )
    ai_hardware_source_hit = any(m.source_key in AI_HARDWARE_SOURCE_KEY_SET for m in effective_members)
    ai_hardware_keyword_hit = bool(member_text) and _contains_ai_hardware_keywords(member_text)
    cluster_tags = {str(tag).strip().lower() for tag in topic_tags}
    has_ai_hardware_topic = AI_HARDWARE_TOPIC_TAG.lower() in cluster_tags
    ai_hardware_boost = 0.0
    if ai_hardware_keyword_hit and has_ai_hardware_topic:
        ai_hardware_boost += 0.06
    if ai_hardware_source_hit:
        ai_hardware_boost += 0.04

    ai_boost = 0.12 if "ai" in topic_tags else 0.0
    funding_boost = 0.08 if "funding" in topic_tags else 0.0
    signal_boost = signal_score * 0.08  # 8% weight from community signals

    rank_score = (
        recency * 0.42
        + source_weight * 0.24
        + diversity * 0.14
        + engagement_raw * 0.10
        + signal_boost
        + ai_hardware_boost
        + ai_boost
        + funding_boost
    )
    rank_score = max(0.0, min(1.0, rank_score))

    trust_score = max(0.0, min(1.0, source_weight * 0.45 + diversity * 0.40 + 0.15))

    effective_count = len(effective_members)
    reasons: List[str] = []
    if recency > 0.75:
        reasons.append("breaking")
    if effective_count >= 3:
        reasons.append(f"covered by {effective_count} sources")
    if "funding" in topic_tags:
        reasons.append("funding signal")
    if "ai" in topic_tags:
        reasons.append("ai-priority")
    if ai_hardware_boost:
        reasons.append("ai-hardware signal")
    if engagement_raw >= 0.4:
        reasons.append("high community engagement")
    if signal_score > 0.6:
        reasons.append("community-endorsed")
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

    GPT-5 and o-series models use reasoning tokens (~1000+) before producing output.
    ``max_completion_tokens`` covers both reasoning + output, so we scale up 8x
    to leave room for the actual output after reasoning.
    """
    m = (model_name or "").strip().lower()
    if m.startswith("gpt-5") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4"):
        return desired_output_tokens * 8
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


def _contains_ai_hardware_keywords(haystack: str) -> bool:
    return _contains_any(haystack, AI_HARDWARE_KEYWORDS)


def _is_relevant_turkey_news_item_strict(item: "NormalizedNewsItem") -> bool:
    """
    Strict AI-required filter for Turkey news. Used for startup_owned_feeds
    and as the inner logic when AI keywords are a hard gate.

    Rules (heuristic, intentionally conservative):
    - Must mention AI (broad).
    - Must indicate startup/ecosystem relevance (funding, startup terms, hiring, policy).
    - Exclude consumer product / retail chatter unless clearly ecosystem-relevant.
    - Exclude global big-tech product updates unless framed as ecosystem events.
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
    has_ecosystem = _contains_any(text, TR_ECOSYSTEM_KEYWORDS)
    has_strong_ecosystem = has_ecosystem and (has_startup_context or ("yatırım" in text) or ("yatirim" in text))
    is_trusted_rss = item.source_key in {"webrazzi", "egirisim", "foundern", "swipeline", "n24_business", "startups_watch", "vc_212", "finberg", "endeavor_turkey", "startupcentrum_tr"}
    if is_trusted_rss:
        if not (has_policy or has_ecosystem or has_mna):
            return False
    else:
        if not (has_policy or has_strong_ecosystem or (has_mna and has_startup_context)):
            return False

    if item.source_key in {"gnews_turkey", "newsapi_turkey"}:
        if not _contains_any(text, TR_CONTEXT_KEYWORDS) and not has_ecosystem:
            return False

    if _contains_any(text, TR_DOMAIN_EXCLUDE_KEYWORDS) and not (has_policy or has_strong_ecosystem):
        return False

    if _contains_any(text, TR_CONSUMER_EXCLUDE_KEYWORDS) and not (has_ecosystem or has_policy):
        return False

    if _contains_any(text, TR_BIGTECH_KEYWORDS):
        has_turkey_context = _contains_any(text, TR_CONTEXT_KEYWORDS)
        if not (has_policy or (has_strong_ecosystem and has_turkey_context)):
            return False

    return True


def _is_relevant_turkey_news_item(item: "NormalizedNewsItem") -> bool:
    """
    Broad Turkey news relevance filter — startup-first, not AI-first.

    Accepts Turkish startup/ecosystem news (funding, M&A, launches, policy)
    even without AI keywords. AI articles still pass if they have startup context.
    startup_owned_feeds delegates to the strict (AI-required) version.

    This matches the LLM prompt intent: score 1 = relevant Turkish startup news.
    """
    # startup_owned_feeds: delegate to strict AI-required filter
    if item.source_key == "startup_owned_feeds":
        return _is_relevant_turkey_news_item_strict(item)

    text = f"{item.title} {item.summary or ''}".strip().casefold()

    has_ai = _contains_any(text, TR_AI_KEYWORDS)
    has_policy = _contains_any(text, TR_POLICY_KEYWORDS)
    has_startup_context = _contains_any(text, TR_STARTUP_CONTEXT_KEYWORDS)
    has_mna = _contains_any(text, TR_MNA_KEYWORDS)
    has_ecosystem = _contains_any(text, TR_ECOSYSTEM_KEYWORDS)
    has_strong_ecosystem = has_ecosystem and (has_startup_context or ("yatırım" in text) or ("yatirim" in text))

    # Core signal: must have startup/ecosystem OR policy OR (AI + startup context).
    # This removes the hard AI gate — a fintech funding round without "AI" now passes.
    has_startup_signal = has_ecosystem or has_mna or has_policy
    has_ai_with_context = has_ai and (has_startup_context or has_ecosystem)
    if not (has_startup_signal or has_ai_with_context):
        return False

    # Turkey nexus: non-endemic sources must mention Turkey somewhere to avoid
    # foreign startup news translated into Turkish passing through.
    if item.source_key not in TR_ENDEMIC_SOURCES and not _has_turkey_nexus(item):
        return False

    is_trusted_rss = item.source_key in {"webrazzi", "egirisim", "foundern", "swipeline", "n24_business", "startups_watch", "vc_212", "finberg", "endeavor_turkey", "startupcentrum_tr"}

    # For broad API aggregators, require explicit Turkey context to avoid global chatter.
    if item.source_key in {"gnews_turkey", "newsapi_turkey"}:
        if not _contains_any(text, TR_CONTEXT_KEYWORDS) and not has_ecosystem:
            return False

    # Noise exclusions (same as strict version)
    if _contains_any(text, TR_DOMAIN_EXCLUDE_KEYWORDS) and not (has_policy or has_strong_ecosystem):
        return False

    if _contains_any(text, TR_CONSUMER_EXCLUDE_KEYWORDS) and not (has_ecosystem or has_policy):
        return False

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


def _has_turkey_nexus(item: "NormalizedNewsItem") -> bool:
    """Check whether a news item has any Turkey-connection signal in title+summary.

    Returns True if the text mentions a Turkish city, institution, corporate suffix,
    or a well-known Turkish startup name.  Used to reject foreign startup news that
    Turkish-language sources translate and republish.
    """
    text = f"{item.title} {item.summary or ''}".strip().casefold()
    if not text:
        return False
    return _contains_any(text, TR_NEXUS_SIGNALS) or _contains_any(text, TR_KNOWN_ENTITIES)


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

    # Apply relevance filter — must be about Turkish ecosystem,
    # not just from a Turkey source reporting on global news.
    # Items the LLM already classified (turkey_priority >= 1) are kept directly;
    # only unclassified items go through the keyword heuristic.
    # Non-endemic sources also require a Turkey-nexus signal.
    relevant_members = []
    for m in candidate_members:
        # Nexus gate: non-endemic sources must mention Turkey somehow
        if m.source_key not in TR_ENDEMIC_SOURCES and not _has_turkey_nexus(m):
            continue
        llm_score = (m.payload or {}).get("turkey_priority")
        if llm_score is not None and llm_score >= 1:
            relevant_members.append(m)        # LLM already approved
        elif _is_relevant_turkey_news_item(m):
            relevant_members.append(m)        # No LLM score — apply heuristic
    if not relevant_members:
        return None

    # Prefer Turkish-language members for the Turkey edition.
    # Representative selection prefers Turkish, but we keep all relevant members
    # so cross-source counts remain meaningful (e.g. TR RSS + global coverage).
    primary_candidates = [m for m in relevant_members if m.language == "tr"] or relevant_members

    primary = sorted(primary_candidates, key=lambda m: (m.source_weight, m.published_at), reverse=True)[0]
    tags = _apply_source_topic_overrides(
        classify_topic_tags(primary.title, primary.summary),
        relevant_members,
    )
    rank_score, trust_score, reason = compute_cluster_scores(
        published_at=max(m.published_at for m in relevant_members),
        topic_tags=tags,
        members=relevant_members,
    )

    # Boost AI/ML-priority items (turkey_priority == 2) in Turkey edition ranking
    has_ai_priority = any(
        (m.payload or {}).get("turkey_priority", 0) >= 2
        for m in relevant_members
    )
    if has_ai_priority:
        rank_score = min(1.0, rank_score + 0.10)

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
You are a relevance classifier for a Turkish tech startup intelligence feed.

**CRITICAL: Turkish LANGUAGE does not mean Turkish COMPANY.**
Many Turkish news sites translate and republish global startup news in Turkish.
These articles are NOT relevant — they must be scored 0.

For each article, respond with a relevance score (0, 1, or 2):

2 = HIGH PRIORITY: A specific Turkish startup/company building or deploying AI/ML
    (must name the company, fund, or deal AND the company must be from Turkey)
  - Turkish startups building or using AI/ML (funding, launch, M&A, product, hiring)
  - AI technology applied by a named Turkish company
  - Turkish VC/fund investing in AI/tech startups (must name the fund or startup)

1 = RELEVANT: A specific Turkish startup, fund, or deal (not necessarily AI)
    (must name a Turkish company, fund, or deal)
  - Turkish startups: funding rounds, launches, M&A, expansion, hiring
  - Turkish VC and investment activity in tech
  - Fintech, SaaS, e-commerce, deep-tech, biotech startups from Turkey
  - Turkish tech policy or regulation with named companies affected
  - Accelerator/incubator programs in Turkey (must name programs or cohort companies)

0 = IRRELEVANT: Score 0 if ANY of these apply:
  - The article is about a NON-Turkish startup, even if written in Turkish
  - General AI articles, tutorials, trends — even if in Turkish
  - Big-tech global product news without a Turkish company angle
  - Consumer tech (phone reviews, app updates, streaming services)
  - General business/economy not involving a specific Turkish tech startup
  - Listicles, opinion pieces, or commentary without a named Turkish entity

EXAMPLES — Score 0 (foreign startups reported in Turkish):
  - "Lightspeed, Naboo'nun etkinlik odaklı yapay zekasına 70 milyon dolar yatırdı" → 0 (Naboo is French)
  - "İlaç şirketi Eli Lilly, Orna Therapeutics'i 2,4 milyar dolara satın alıyor" → 0 (US pharma deal)
  - "Vega Security, 120 Milyon Dolarlık Seri B Yatırımı Aldı" → 0 (not a Turkish company)
  - "Stripe, yapay zeka destekli ödeme altyapısını güncelledi" → 0 (US fintech)
  - "Mistral AI, 600 milyon dolar yatırım aldı" → 0 (French AI company)

EXAMPLES — Score 1 or 2 (actual Turkish startups):
  - "Getir, 500 milyon dolar topladı" → 1 (Turkish delivery startup)
  - "Insider, yapay zeka pazarlama platformu için Seri D turunu kapattı" → 2 (Turkish AI startup)
  - "Papara, 100 milyon euro yatırım aldı" → 1 (Turkish fintech)
  - "Jotform, yeni AI form oluşturucuyu tanıttı" → 2 (Turkish SaaS + AI)
  - "İstanbul merkezli Peak Games, 1.8 milyar dolara satıldı" → 1 (Turkish gaming)

KEY RULE: Score 1 or 2 ONLY if the article is about a Turkish company, fund, or deal.
A Turkish-language article about a foreign company = 0.

Articles:
{articles}

Respond ONLY with a JSON array of integers (0, 1, or 2), one per article. Example: [2, 0, 1]"""


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


def determine_frame_override(
    *,
    story_type: str,
    topic_tags: Sequence[str],
    confidence_score: Optional[float] = None,
    has_conflicting_reports: bool = False,
) -> Optional[str]:
    """Deterministic frame override — first match wins.

    Returns an IMPACT_FRAMES key or None (let LLM decide).
    """
    # Low confidence or conflicting reports → EARLY_SIGNAL
    if has_conflicting_reports or (confidence_score is not None and confidence_score < 0.45):
        return "EARLY_SIGNAL"
    # ML-eval benchmarks → BENCHMARK_TRAP
    tags_lower = {t.lower() for t in topic_tags}
    if "ml-eval" in tags_lower:
        return "BENCHMARK_TRAP"
    # Funding → UNDERWRITING_TAKE
    if story_type == "funding":
        return "UNDERWRITING_TAKE"
    # Regulation → REGULATORY_CONSTRAINT
    if story_type == "regulation":
        return "REGULATORY_CONSTRAINT"
    return None


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
            os.getenv("AZURE_OPENAI_FALLBACK_DEPLOYMENT_NAME") or "gpt-5-nano"
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
            "intel_attempted": 0,
            "intel_accepted": 0,
            "intel_rejected_validation": 0,
            "intel_missing_source_proof": 0,
            "intel_rejection_reasons": {},
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
        self._evidence_objects_supported = False

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

    async def _supports_evidence_objects(self, conn: asyncpg.Connection) -> bool:
        """Whether canonical evidence_objects and pointer columns are available."""
        try:
            from .evidence_objects import supports_evidence_objects

            return await supports_evidence_objects(conn)
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
                    is_active = $8,
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
                bool(src.enabled),
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
            active_by_region: Dict[str, List[str]] = {}
            for src in sources:
                region = (src.region or "global").strip().lower() or "global"
                by_region.setdefault(region, [])
                active_by_region.setdefault(region, [])
                if src.source_key not in by_region[region]:
                    by_region[region].append(src.source_key)
                if src.enabled:
                    active_by_region[region].append(src.source_key)

            for region, keys in by_region.items():
                if not keys and not active_by_region.get(region):
                    continue
                await conn.execute(
                    """
                    UPDATE news_sources
                    SET is_active = (source_key = ANY($2::text[]))
                    WHERE region = $1
                    """,
                    region,
                    active_by_region.get(region, []),
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

        source_limit = _effective_source_limit(source, self.max_per_source)
        resp = await client.get(source.base_url)
        resp.raise_for_status()
        parsed = feedparser.parse(resp.text)

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        items: List[NormalizedNewsItem] = []

        for entry in parsed.entries[: source_limit * 2]:
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
            if len(items) >= source_limit:
                break

        return items

    # Digest parser configs keyed by source_key
    _DIGEST_CONFIGS: Dict[str, "DigestParserConfig"] = {}

    @staticmethod
    def _get_digest_config(source_key: str) -> "DigestParserConfig":
        """Return parser config for a digest source."""
        if not DailyNewsIngestor._DIGEST_CONFIGS:
            from .ainews_parser import DigestParserConfig
            DailyNewsIngestor._DIGEST_CONFIGS = {
                "ainews_digest": DigestParserConfig(
                    source_key="ainews_digest",
                    source_name="AINews by swyx",
                    source_type="rss",
                    source_weight=0.88,
                ),
                "latentspace_digest": DigestParserConfig(
                    source_key="latentspace_digest",
                    source_name="Latent Space by swyx",
                    source_type="rss",
                    source_weight=0.85,
                ),
            }
        return DailyNewsIngestor._DIGEST_CONFIGS.get(
            source_key,
            DailyNewsIngestor._DIGEST_CONFIGS["ainews_digest"],
        )

    async def _fetch_digest_rss(self, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        """Fetch a digest newsletter via RSS and parse each entry into individual items."""
        if feedparser is None:
            return []

        from .ainews_parser import AINewsDigestParser

        resp = await client.get(source.base_url)
        resp.raise_for_status()
        parsed = feedparser.parse(resp.text)

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        config = self._get_digest_config(source.source_key)
        parser = AINewsDigestParser(config)
        all_items: List[NormalizedNewsItem] = []

        for entry in parsed.entries[:5]:
            published = parse_entry_datetime(entry) or datetime.now(timezone.utc)
            if published < cutoff:
                continue

            # Latent Space: skip non-AINews posts (podcasts, interviews, etc.)
            title = entry.get("title", "")
            if source.source_key == "latentspace_digest" and not title.startswith("[AINews]"):
                continue

            # Get full HTML content from content:encoded
            html = ""
            content_list = entry.get("content", [])
            if content_list and isinstance(content_list, list):
                html = content_list[0].get("value", "")
            if not html:
                html = entry.get("summary", entry.get("description", ""))
            if not html:
                continue

            link = entry.get("link", source.base_url)
            try:
                items = parser.parse_digest(html, published, link)
                all_items.extend(items)
            except Exception as exc:
                print(f"[news-ingest] {source.source_key}: failed to parse entry {link}: {exc}")
                continue

        print(f"[news-ingest] {source.source_key}: extracted {len(all_items)} items from {len(parsed.entries)} RSS entries")
        return all_items

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

    async def _fetch_huggingface_papers(
        self,
        client: httpx.AsyncClient,
        source: SourceDefinition,
        lookback_hours: int,
    ) -> List[NormalizedNewsItem]:
        """Fetch trending AI/ML papers from Hugging Face Daily Papers API."""
        try:
            resp = await client.get(source.base_url, params={"limit": "100"})
            if resp.status_code >= 400:
                return []
            papers = resp.json() or []
        except Exception:
            return []

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        items: List[NormalizedNewsItem] = []

        for paper in papers:
            paper_data = paper.get("paper") or paper
            arxiv_id = str(paper_data.get("id") or "").strip()
            title = normalize_text(str(paper_data.get("title") or ""))
            if not arxiv_id or not title:
                continue

            # Prefer the Daily Papers submission date (outer) over arXiv date (paper_data)
            pub_raw = paper.get("publishedAt") or paper_data.get("publishedAt") or ""
            try:
                published = datetime.fromisoformat(str(pub_raw).replace("Z", "+00:00"))
                if published.tzinfo is None:
                    published = published.replace(tzinfo=timezone.utc)
                else:
                    published = published.astimezone(timezone.utc)
            except Exception:
                published = datetime.now(timezone.utc)

            if published < cutoff:
                continue

            url = f"https://arxiv.org/abs/{arxiv_id}"

            summary_text = normalize_text(
                str(paper_data.get("summary") or "")
            )[:300]

            authors = []
            for a in paper_data.get("authors") or []:
                name = ""
                if isinstance(a, dict):
                    name = a.get("name") or a.get("user", {}).get("fullname", "")
                elif isinstance(a, str):
                    name = a
                if name:
                    authors.append(name.strip())

            upvotes = int(paper.get("upvotes") or paper_data.get("upvotes") or 0)
            num_comments = int(paper.get("numComments") or 0)

            item = NormalizedNewsItem(
                source_key=source.source_key,
                source_name=source.display_name,
                source_type=source.source_type,
                title=title[:300],
                url=url,
                canonical_url=canonicalize_url(url),
                summary=summary_text,
                published_at=published,
                language="en",
                author=", ".join(authors[:5]) if authors else None,
                engagement={"upvotes": upvotes, "comments": num_comments},
                payload={
                    "provider": "huggingface",
                    "kind": "research_paper",
                    "arxiv_id": arxiv_id,
                    "authors": authors[:10],
                    "upvotes": upvotes,
                    "num_comments": num_comments,
                    "ai_keywords": paper_data.get("ai_keywords") or [],
                    "github_repo": paper.get("githubRepo") or None,
                    "github_stars": int(paper.get("githubStars") or 0) or None,
                    "hf_url": f"https://huggingface.co/papers/{arxiv_id}",
                },
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

    async def _search_newsapi_query(
        self,
        client: httpx.AsyncClient,
        *,
        query: str,
        lookback_hours: int,
        max_items: int,
        seed_meta: Dict[str, Any],
    ) -> List[NormalizedNewsItem]:
        if not self.newsapi_key:
            return []
        q = normalize_text(query or "")
        if not q:
            return []

        now = datetime.now(timezone.utc)
        since = (now - timedelta(hours=max(1, lookback_hours))).isoformat()
        params = {
            "q": q,
            "language": "en",
            "sortBy": "publishedAt",
            "from": since,
            "pageSize": str(min(100, max(1, max_items))),
            "apiKey": self.newsapi_key,
        }
        try:
            resp = await client.get("https://newsapi.org/v2/everything", params=params)
        except Exception:
            return []
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

            payload = {
                "provider": "newsapi",
                "origin": "paid_headline_expand",
                "seed": seed_meta,
                "source": art.get("source"),
                "image_url": normalize_image_url(str(art.get("urlToImage") or "")) if art.get("urlToImage") else None,
            }
            item = NormalizedNewsItem(
                source_key="newsapi",
                source_name="NewsAPI",
                source_type="api",
                title=title[:300],
                url=url,
                canonical_url=canonicalize_url(url),
                summary=normalize_text(str(art.get("description") or ""))[:300],
                published_at=published,
                language="en",
                author=normalize_text(str(art.get("author") or "")) or None,
                payload=payload,
                source_weight=0.67,
            ).with_external_id()
            items.append(item)
            if len(items) >= max_items:
                break

        return items[:max_items]

    async def _search_gnews_query(
        self,
        client: httpx.AsyncClient,
        *,
        query: str,
        lookback_hours: int,
        max_items: int,
        seed_meta: Dict[str, Any],
    ) -> List[NormalizedNewsItem]:
        if not self.gnews_key:
            return []
        q = normalize_text(query or "")
        if not q:
            return []

        now = datetime.now(timezone.utc)
        since = (now - timedelta(hours=max(1, lookback_hours))).isoformat()
        params = {
            "q": q,
            "lang": "en",
            "max": str(min(50, max(1, max_items))),
            "from": since,
            "token": self.gnews_key,
        }
        try:
            resp = await client.get("https://gnews.io/api/v4/search", params=params)
        except Exception:
            return []
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

            payload = {
                "provider": "gnews",
                "origin": "paid_headline_expand",
                "seed": seed_meta,
                "image_url": normalize_image_url(str(art.get("image") or "")) if art.get("image") else None,
            }
            item = NormalizedNewsItem(
                source_key="gnews",
                source_name="GNews",
                source_type="api",
                title=title[:300],
                url=url,
                canonical_url=canonicalize_url(url),
                summary=normalize_text(str(art.get("description") or ""))[:300],
                published_at=published,
                language="en",
                author=normalize_text(str(art.get("source", {}).get("name") or "")) or None,
                payload=payload,
                source_weight=0.66,
            ).with_external_id()
            items.append(item)
            if len(items) >= max_items:
                break

        return items[:max_items]

    async def _fetch_paid_headline_seeds(
        self,
        conn: asyncpg.Connection,
        client: httpx.AsyncClient,
        source: SourceDefinition,
        lookback_hours: int,
    ) -> List[NormalizedNewsItem]:
        """Fetch paid headline leads and expand them into open-web corroboration candidates."""
        if not _env_bool("PAID_HEADLINE_SEEDS_ENABLED", False):
            return []

        publisher_key = source.source_key
        max_seeds = max(1, min(50, _env_int("PAID_HEADLINE_MAX_SEEDS_PER_RUN", 10)))
        metadata_fetch = _env_bool("PAID_HEADLINE_METADATA_FETCH", True)
        expand_lookback_hours = max(24, _env_int("PAID_HEADLINE_EXPAND_LOOKBACK_HOURS", 168))
        expand_max_per_seed = max(1, min(25, _env_int("PAID_HEADLINE_EXPAND_MAX_PER_SEED", 8)))
        max_attempts = max(1, _env_int("PAID_HEADLINE_MAX_ATTEMPTS", 3))

        expand_sources_raw = (os.getenv("PAID_HEADLINE_EXPAND_SOURCES", "gnews,newsapi") or "").strip()
        expand_sources: List[str] = []
        for raw in expand_sources_raw.split(","):
            key = raw.strip().lower()
            if key and key not in expand_sources:
                expand_sources.append(key)

        try:
            rows = await conn.fetch(
                """
                SELECT
                  id::text AS id,
                  url,
                  canonical_url,
                  title,
                  summary,
                  published_at,
                  attempt_count
                FROM paid_headline_seeds
                WHERE publisher_key = $1
                  AND status = 'new'
                ORDER BY created_at ASC
                LIMIT $2
                """,
                publisher_key,
                max_seeds,
            )
        except Exception as exc:
            print(f"[news-ingest] {publisher_key}: paid headline seeds skipped (migration missing?): {exc}")
            return []

        if not rows:
            return []

        out: List[NormalizedNewsItem] = []
        now = datetime.now(timezone.utc)

        for row in rows:
            seed_id = str(row.get("id") or "").strip()
            seed_url = str(row.get("url") or "").strip()
            seed_canonical_url = str(row.get("canonical_url") or "").strip() or canonicalize_url(seed_url)
            seed_title_db = normalize_text(str(row.get("title") or ""))
            seed_summary_db = normalize_text(str(row.get("summary") or ""))
            seed_published_at_db = row.get("published_at")
            try:
                attempt_count = int(row.get("attempt_count") or 0) + 1
            except Exception:
                attempt_count = 1

            # Update attempt telemetry (best-effort, don't fail ingestion on errors).
            try:
                await conn.execute(
                    """
                    UPDATE paid_headline_seeds
                    SET attempt_count = $2,
                        last_attempt_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    """,
                    seed_id,
                    attempt_count,
                )
            except Exception:
                pass

            extracted_title = ""
            extracted_summary = ""
            extracted_published_at: Optional[datetime] = None
            extracted_image_url = ""
            last_error = ""

            # Metadata-only fetch (title/description/published time/og:image)
            if metadata_fetch and seed_url:
                try:
                    resp = await client.get(
                        seed_url,
                        headers={
                            "User-Agent": "Mozilla/5.0 (compatible; BuildAtlasHeadlineLead/1.0; +https://buildatlas.net)",
                        },
                    )
                    if resp.status_code < 400:
                        t, s, p, img = extract_html_title_summary(resp.text or "", source_url=seed_url)
                        extracted_title = normalize_text(t)
                        extracted_summary = normalize_text(s)
                        extracted_published_at = p
                        if img:
                            extracted_image_url = normalize_image_url(str(img), base_url=seed_url)

                        try:
                            await conn.execute(
                                """
                                UPDATE paid_headline_seeds
                                SET title = COALESCE(title, $2),
                                    summary = COALESCE(summary, $3),
                                    published_at = COALESCE(published_at, $4),
                                    last_error = NULL,
                                    updated_at = NOW()
                                WHERE id = $1::uuid
                                """,
                                seed_id,
                                extracted_title or None,
                                extracted_summary or None,
                                extracted_published_at,
                            )
                        except Exception:
                            pass
                    else:
                        last_error = f"http_{resp.status_code}"
                except Exception as exc:
                    last_error = str(exc)[:300]

            seed_title = seed_title_db or extracted_title
            seed_summary = seed_summary_db or extracted_summary

            # Ensure lead items don't collapse into one cluster when titles are missing:
            # make a URL-derived fallback title that stays unique per seed.
            if not seed_title:
                path = (urlparse(seed_canonical_url).path or "").strip("/") or seed_canonical_url
                seed_title = f"{source.display_name}: {path}"[:300]

            lead_payload: Dict[str, Any] = {
                "origin": "paid_headline_seed",
                "paywalled": True,
                "lead_only": True,
                "seed_id": seed_id,
                "publisher_key": publisher_key,
            }
            if extracted_image_url:
                lead_payload["image_url"] = extracted_image_url

            # Use a stable external_id (seed UUID) so re-runs update instead of duplicating.
            lead_item = NormalizedNewsItem(
                source_key=source.source_key,
                source_name=source.display_name,
                source_type=source.source_type,
                title=seed_title[:300],
                url=seed_url or seed_canonical_url,
                canonical_url=seed_canonical_url,
                summary=(seed_summary or "")[:300],
                published_at=seed_published_at_db or extracted_published_at or now,
                language=source.language or "en",
                author=None,
                external_id=seed_id,
                payload=lead_payload,
                source_weight=source.credibility_weight,
            )
            out.append(lead_item)

            expanded: List[NormalizedNewsItem] = []
            query_title = seed_title_db or extracted_title
            query = build_paid_headline_search_query(query_title) if query_title else ""
            if query:
                seed_meta = {
                    "publisher_key": publisher_key,
                    "seed_id": seed_id,
                    "seed_url": seed_url,
                    "seed_canonical_url": seed_canonical_url,
                    "seed_title": query_title,
                }
                if "gnews" in expand_sources:
                    expanded.extend(
                        await self._search_gnews_query(
                            client,
                            query=query,
                            lookback_hours=expand_lookback_hours,
                            max_items=expand_max_per_seed,
                            seed_meta=seed_meta,
                        )
                    )
                if "newsapi" in expand_sources:
                    expanded.extend(
                        await self._search_newsapi_query(
                            client,
                            query=query,
                            lookback_hours=expand_lookback_hours,
                            max_items=expand_max_per_seed,
                            seed_meta=seed_meta,
                        )
                    )

            expanded = expanded[: expand_max_per_seed * 2]

            # Update seed status based on corroboration results (best-effort).
            try:
                if expanded:
                    await conn.execute(
                        """
                        UPDATE paid_headline_seeds
                        SET status = 'processed',
                            last_error = NULL,
                            updated_at = NOW()
                        WHERE id = $1::uuid
                        """,
                        seed_id,
                    )
                else:
                    err = last_error or ""
                    if not err:
                        if not query:
                            err = "missing_title"
                        elif not (self.gnews_key or self.newsapi_key):
                            err = "missing_expand_api_keys"
                        else:
                            err = "no_corroborating_results"
                    if attempt_count >= max_attempts:
                        await conn.execute(
                            """
                            UPDATE paid_headline_seeds
                            SET status = 'failed',
                                last_error = $2,
                                updated_at = NOW()
                            WHERE id = $1::uuid
                            """,
                            seed_id,
                            err,
                        )
                    else:
                        await conn.execute(
                            """
                            UPDATE paid_headline_seeds
                            SET last_error = $2,
                                updated_at = NOW()
                            WHERE id = $1::uuid
                            """,
                            seed_id,
                            err,
                        )
            except Exception:
                pass

            out.extend(expanded)
            if len(out) >= self.max_per_source:
                return out[: self.max_per_source]

        return out[: self.max_per_source]

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

    async def _fetch_x_recent_search(
        self,
        client: httpx.AsyncClient,
        source: SourceDefinition,
        lookback_hours: int,
    ) -> List[NormalizedNewsItem]:
        from .x_trends import fetch_recent_search_items

        items, stats = await fetch_recent_search_items(
            client=client,
            source=source,
            lookback_hours=lookback_hours,
            max_items=self.max_per_source,
        )
        if stats.queries_attempted > 0:
            print(
                f"[x-trends] {source.source_key}: "
                f"queries={stats.queries_attempted} "
                f"pages={stats.pages_fetched} "
                f"fetched={stats.tweets_fetched} "
                f"kept={stats.tweets_kept} "
                f"errors={stats.errors}"
            )
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

    async def _fetch_latest_posts(self, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        if BeautifulSoup is None:
            return []

        source_limit = _effective_source_limit(source, self.max_per_source)
        if source_limit <= 0:
            return []

        seeds = tuple(source.crawl_seed_urls) if source.crawl_seed_urls else (source.base_url,)
        if not seeds:
            return []

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        list_delay = max(0.0, float(source.crawl_delay_ms)) / 1000.0
        candidate_urls: List[str] = []

        for seed_url in seeds:
            try:
                resp = await client.get(seed_url)
                if resp.status_code >= 400:
                    continue
                seed_html = resp.text or ""
                soup = BeautifulSoup(seed_html, "html.parser")
                seed_host = urlparse(seed_url).netloc.lower()
                for anchor in soup.find_all("a", href=True):
                    href = str(anchor.get("href") or "").strip()
                    if not href:
                        continue
                    abs_url = canonicalize_url(urljoin(seed_url, href))
                    if not abs_url.startswith("http"):
                        continue
                    parsed = urlparse(abs_url)
                    if parsed.scheme not in {"http", "https"}:
                        continue
                    if parsed.netloc and parsed.netloc.lower() != seed_host:
                        continue
                    if not is_likely_content_url(abs_url):
                        continue
                    candidate_urls.append(abs_url)
                if list_delay > 0:
                    await asyncio.sleep(list_delay)
            except Exception:
                continue

        deduped_candidates = [url for i, url in enumerate(dict.fromkeys(candidate_urls)) if i < max(source_limit * 3, 40)]
        out: List[NormalizedNewsItem] = []
        sem = asyncio.Semaphore(6)

        async def fetch_article(url: str) -> Optional[NormalizedNewsItem]:
            try:
                if list_delay > 0:
                    await asyncio.sleep(list_delay)
                async with sem:
                    resp = await client.get(url)
                if resp.status_code >= 400:
                    return None
                title, summary, page_published, image_url = extract_html_title_summary(resp.text or "", source_url=url)
                if not title:
                    return None
                published_at = page_published or datetime.now(timezone.utc)
                if published_at < cutoff:
                    return None
                return NormalizedNewsItem(
                    source_key=source.source_key,
                    source_name=source.display_name,
                    source_type=source.source_type,
                    title=title[:300],
                    url=url,
                    canonical_url=canonicalize_url(url),
                    summary=(summary or "")[:300],
                    published_at=published_at,
                    language=source.language or "en",
                    payload={
                        "origin": "latest_posts",
                        "seed_urls": list(seeds)[:5],
                        "image_url": normalize_image_url(image_url, base_url=url) if image_url else None,
                    },
                    source_weight=source.credibility_weight,
                ).with_external_id()
            except Exception:
                return None

        for idx in range(0, len(deduped_candidates), 12):
            chunk = deduped_candidates[idx: idx + 12]
            for item in await asyncio.gather(*[fetch_article(u) for u in chunk]):
                if item is not None:
                    out.append(item)
                if len(out) >= source_limit:
                    break
            if len(out) >= source_limit:
                break

        out.sort(key=lambda item: item.published_at, reverse=True)
        return out[:source_limit]

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

    _VC_HOMEPAGE_TITLE_RE = re.compile(
        r"\b(anasayfa|ana sayfa|homepage|home page|hoş geldiniz|welcome)\b",
        re.IGNORECASE,
    )

    @staticmethod
    def _is_vc_homepage_junk(title: str, url: str, root_netloc: str) -> bool:
        """Detect homepage/landing-page entries from VC blog crawls."""
        if DailyNewsIngestor._VC_HOMEPAGE_TITLE_RE.search(title):
            return True
        parsed_url = urlparse(url)
        path = parsed_url.path.strip("/")
        if not path and parsed_url.netloc == root_netloc:
            return True
        return False

    async def _fetch_vc_turkey_blogs(self, client: httpx.AsyncClient, source: SourceDefinition, lookback_hours: int) -> List[NormalizedNewsItem]:
        """Fetch recent posts from Turkish VC/ecosystem blogs.

        For each VC URL, tries RSS discovery (/feed, /blog/feed, /news/feed),
        then falls back to HTML title+summary extraction.  Limits to 2 entries
        per VC and ``max_per_source`` total.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, lookback_hours))
        sem = asyncio.Semaphore(12)
        items: List[NormalizedNewsItem] = []

        async def _try_vc(vc_name: str, base_url: str) -> List[NormalizedNewsItem]:
            parsed = urlparse(base_url)
            root = f"https://{parsed.netloc}".rstrip("/")
            out: List[NormalizedNewsItem] = []

            # 1. Try common RSS feed paths first.
            for suffix in ("/feed", "/blog/feed", "/news/feed"):
                feed_url = f"{root}{suffix}"
                try:
                    async with sem:
                        resp = await client.get(feed_url)
                    if resp.status_code >= 400:
                        continue
                    ct = str(resp.headers.get("content-type") or "").lower()
                    if not ("xml" in ct or "rss" in ct or "atom" in ct):
                        # Could be an HTML error page; skip.
                        if "<rss" not in (resp.text or "")[:500].lower() and "<feed" not in (resp.text or "")[:500].lower():
                            continue
                    if feedparser is None:
                        continue
                    parsed_feed = feedparser.parse(resp.text or "")
                    for entry in parsed_feed.entries[:2]:
                        title = normalize_text(entry.get("title", ""))
                        link = str(entry.get("link") or "")
                        if not title or not link:
                            continue
                        if not is_likely_content_url(link):
                            continue
                        if self._is_vc_homepage_junk(title, link, parsed.netloc):
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
                                language=self._detect_rss_language(source, parsed_feed) or "tr",
                                payload={
                                    "origin": "vc_blog",
                                    "vc_name": vc_name,
                                    "image_url": feed_image or None,
                                },
                                source_weight=source.credibility_weight,
                            ).with_external_id()
                        )
                    if out:
                        return out
                except Exception:
                    continue

            # 2. Fallback: scrape the homepage/blog page for a recent post.
            #    Skip root-domain homepages — they produce "Anasayfa | Company" noise.
            fallback_path = urlparse(base_url).path.strip("/")
            if not fallback_path or fallback_path in ("index.html", "index.php"):
                return []
            try:
                async with sem:
                    resp = await client.get(base_url)
                if resp.status_code >= 400:
                    return []
                title, summary, page_published, image_url = extract_html_title_summary(resp.text or "", source_url=base_url)
                if not title:
                    return []
                if self._is_vc_homepage_junk(title, base_url, parsed.netloc):
                    return []
                out.append(
                    NormalizedNewsItem(
                        source_key=source.source_key,
                        source_name=source.display_name,
                        source_type=source.source_type,
                        title=title[:300],
                        url=base_url,
                        canonical_url=canonicalize_url(base_url),
                        summary=(summary or "")[:280],
                        published_at=page_published or datetime.now(timezone.utc),
                        language="tr",
                        payload={
                            "origin": "vc_blog",
                            "vc_name": vc_name,
                            "image_url": normalize_image_url(image_url, base_url=base_url) if image_url else None,
                        },
                        source_weight=source.credibility_weight,
                    ).with_external_id()
                )
            except Exception:
                pass
            return out

        for idx in range(0, len(_TURKEY_VC_BLOG_URLS), 12):
            chunk = _TURKEY_VC_BLOG_URLS[idx: idx + 12]
            tasks = [_try_vc(name, url) for name, url in chunk]
            for produced in await asyncio.gather(*tasks):
                if produced:
                    items.extend(produced)
                if len(items) >= self.max_per_source:
                    return items[: self.max_per_source]

        return items[: self.max_per_source]

    async def _collect_items(self, conn: asyncpg.Connection, lookback_hours: int) -> Tuple[List[NormalizedNewsItem], List[str], int, List[SourceFetchResult]]:
        errors: List[str] = []
        attempted = 0
        collected: List[NormalizedNewsItem] = []
        fetch_results: List[SourceFetchResult] = []

        timeout = httpx.Timeout(self.http_timeout)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers={"User-Agent": "BuildAtlasNewsBot/2026 (+https://buildatlas.net)"}) as client:
            for source in DEFAULT_SOURCES:
                if not source.enabled:
                    continue
                attempted += 1
                t0 = time.monotonic()
                source_lookback = source.lookback_hours_override or lookback_hours
                try:
                    if source.fetch_mode == "rss":
                        items = await self._fetch_rss_source(client, source, source_lookback)
                    elif source.source_key == "hackernews_api":
                        items = await self._fetch_hackernews_api(client, source, source_lookback)
                    elif source.source_key == "producthunt_api":
                        items = await self._fetch_producthunt_api(client, source)
                    elif source.source_key == "newsapi":
                        items = await self._fetch_newsapi(client, source, source_lookback)
                    elif source.source_key == "gnews":
                        items = await self._fetch_gnews(client, source, source_lookback)
                    elif source.source_key == "github_trending_ai":
                        items = await self._fetch_github_trending_ai(conn, client, source, source_lookback)
                    elif source.source_key == "amazon_new_releases_ai":
                        items = await self._fetch_amazon_new_releases_ai(conn, source, source_lookback)
                    elif source.source_key == "newsapi_turkey":
                        items = await self._fetch_newsapi_turkey(client, source, source_lookback)
                    elif source.source_key == "gnews_turkey":
                        items = await self._fetch_gnews_turkey(client, source, source_lookback)
                    elif source.fetch_mode == "x_recent_search":
                        items = await self._fetch_x_recent_search(client, source, source_lookback)
                    elif source.source_key == "startup_owned_feeds":
                        items = await self._fetch_startup_owned_sources(conn, client, source, source_lookback)
                    elif source.source_key == "vc_turkey_blogs":
                        items = await self._fetch_vc_turkey_blogs(client, source, source_lookback)
                    elif source.source_key == "huggingface_papers":
                        items = await self._fetch_huggingface_papers(client, source, source_lookback)
                    elif source.fetch_mode == "digest_rss":
                        items = await self._fetch_digest_rss(client, source, source_lookback)
                    elif source.fetch_mode == "paid_headlines":
                        items = await self._fetch_paid_headline_seeds(conn, client, source, source_lookback)
                    elif source.fetch_mode == "latest_posts":
                        items = await self._fetch_latest_posts(client, source, source_lookback)
                    elif source.fetch_mode == "crawler":
                        items = await self._fetch_frontier_candidates(conn, client, source, source_lookback)
                    else:
                        items = []

                    # Turkey pipeline: three-stage filter (heuristic → LLM → nexus check).
                    if (source.region or "global") == "turkey":
                        pre_filter = len(items)
                        items = [i for i in items if _turkey_prefilter(i)]
                        pre_llm = len(items)
                        items = await self._llm_classify_turkey_relevance(items, source.source_key)
                        # Nexus check: for non-endemic sources, require a Turkey-connection signal
                        # to reject foreign startup news translated into Turkish.
                        if source.source_key not in TR_ENDEMIC_SOURCES:
                            pre_nexus = len(items)
                            dropped = [i.title for i in items if not _has_turkey_nexus(i)]
                            items = [i for i in items if _has_turkey_nexus(i)]
                            if dropped:
                                print(f"[turkey-nexus] {source.source_key}: dropped {len(dropped)} items without Turkey nexus: {dropped[:5]}")
                        if pre_filter > 0 or (source.region or "global") == "turkey":
                            hi = sum(1 for i in items if (i.payload or {}).get("turkey_priority", 0) >= 2)
                            lo = len(items) - hi
                            print(f"[news-ingest] {source.source_key}: {pre_filter} fetched → {pre_llm} prefilter → {len(items)} LLM+nexus-passed (ai={hi} other={lo})")

                    elapsed_ms = int((time.monotonic() - t0) * 1000)
                    fetch_results.append(SourceFetchResult(
                        source_key=source.source_key, success=True,
                        items_count=len(items), duration_ms=elapsed_ms,
                    ))
                    collected.extend(items)
                except Exception as exc:
                    elapsed_ms = int((time.monotonic() - t0) * 1000)
                    fetch_results.append(SourceFetchResult(
                        source_key=source.source_key, success=False,
                        duration_ms=elapsed_ms, error=str(exc)[:500],
                    ))
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

        return deduped, errors, attempted, fetch_results

    async def _insert_raw_items(self, conn: asyncpg.Connection, items: Sequence[NormalizedNewsItem]) -> int:
        source_ids = await self._get_source_id_map(conn)
        inserted = 0

        if not self._evidence_objects_supported:
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

        # Canonical Evidence Object contract: create evidence_objects and set
        # news_items_raw.evidence_object_id pointers (idempotent).
        from .evidence_objects import stable_hash, upsert_evidence_object

        for item in items:
            source_id = source_ids.get(item.source_key)
            if not source_id:
                continue

            payload_json = json.dumps(item.payload or {})
            engagement_json = json.dumps(item.engagement or {})

            row = await conn.fetchrow(
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
                RETURNING id::text, evidence_object_id::text, (xmax = 0) AS inserted
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
            if row and row.get("inserted"):
                inserted += 1

            try:
                raw_id = str(row["id"]) if row and row.get("id") else ""
                existing_evidence_id = str(row["evidence_object_id"]) if row and row.get("evidence_object_id") else ""
                if raw_id and not existing_evidence_id:
                    h = stable_hash(["news_item", item.source_key, item.external_id, item.canonical_url])
                    evidence_id = await upsert_evidence_object(
                        conn,
                        evidence_type="news_item",
                        uri=item.canonical_url or item.url,
                        captured_at=item.published_at,
                        source_weight=float(item.source_weight or 0.5),
                        language=item.language or "en",
                        content_ref=f"db://news_items_raw/{raw_id}",
                        hash_value=h,
                        provenance={
                            "source_key": item.source_key,
                            "external_id": item.external_id,
                            "url": item.url,
                            "canonical_url": item.canonical_url,
                        },
                    )
                    await conn.execute(
                        """
                        UPDATE news_items_raw
                        SET evidence_object_id = $2::uuid
                        WHERE id = $1::uuid AND evidence_object_id IS NULL
                        """,
                        raw_id,
                        evidence_id,
                    )
            except Exception as exc:
                # Best-effort: don't block ingestion if evidence_objects are misconfigured.
                print(f"[evidence] raw item evidence persist failed for {item.source_key}:{item.external_id}: {exc}")

        return inserted

    # ------------------------------------------------------------------
    # Source health tracking
    # ------------------------------------------------------------------

    async def _update_source_health(
        self, conn: asyncpg.Connection, results: List[SourceFetchResult]
    ) -> None:
        """Persist per-source fetch outcomes to news_sources for monitoring."""
        if not results:
            return
        try:
            for r in results:
                if r.success:
                    await conn.execute(
                        """
                        UPDATE news_sources SET
                            last_fetch_at = NOW(),
                            last_success_at = NOW(),
                            consecutive_failures = 0,
                            total_fetches = total_fetches + 1,
                            total_successes = total_successes + 1,
                            last_items_fetched = $2,
                            last_fetch_duration_ms = $3
                        WHERE source_key = $1
                        """,
                        r.source_key, r.items_count, r.duration_ms,
                    )
                else:
                    await conn.execute(
                        """
                        UPDATE news_sources SET
                            last_fetch_at = NOW(),
                            last_error_at = NOW(),
                            last_error = $2,
                            consecutive_failures = consecutive_failures + 1,
                            total_fetches = total_fetches + 1,
                            last_fetch_duration_ms = $3
                        WHERE source_key = $1
                        """,
                        r.source_key, r.error, r.duration_ms,
                    )
        except Exception as exc:
            # Backward compat: migration may not be applied yet
            print(f"[news-ingest] source health update skipped (migration pending?): {exc}")

    async def _check_source_alerts(self, conn: asyncpg.Connection) -> None:
        """Send Slack alert when sources hit 5+ consecutive failures (24h dedup)."""
        webhook = os.getenv("SLACK_WEBHOOK_URL", "")
        if not webhook:
            return
        try:
            rows = await conn.fetch(
                """
                SELECT source_key, display_name, consecutive_failures, last_error,
                       last_success_at, last_error_at
                FROM news_sources
                WHERE is_active = true
                  AND consecutive_failures >= 5
                  AND (last_alerted_at IS NULL
                       OR last_alerted_at < NOW() - INTERVAL '24 hours')
                ORDER BY consecutive_failures DESC
                """
            )
            if not rows:
                return

            blocks = [
                {"type": "header", "text": {"type": "plain_text", "text": "🚨 News Source Alert"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": (
                    f"*{len(rows)} source(s)* with 5+ consecutive failures:"
                )}},
            ]
            for row in rows[:10]:  # cap at 10 to avoid Slack block limits
                last_ok = row["last_success_at"]
                ok_str = last_ok.strftime("%Y-%m-%d %H:%M UTC") if last_ok else "never"
                err_preview = (row["last_error"] or "")[:120]
                blocks.append({
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": (
                        f"*{row['display_name']}* (`{row['source_key']}`)\n"
                        f"Failures: {row['consecutive_failures']} | Last OK: {ok_str}\n"
                        f"Error: _{err_preview}_"
                    )},
                })

            payload = json.dumps({"blocks": blocks})
            req = urllib.request.Request(
                webhook,
                data=payload.encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=10)
            print(f"[news-ingest] Slack alert sent for {len(rows)} down source(s)")

            # Dedup: mark alerted
            keys = [row["source_key"] for row in rows]
            await conn.execute(
                """
                UPDATE news_sources SET last_alerted_at = NOW()
                WHERE source_key = ANY($1::text[])
                """,
                keys,
            )
        except Exception as exc:
            print(f"[news-ingest] source alert check failed: {exc}")

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

        # Entity-heavy match: strong named-entity overlap compensates for low
        # Jaccard when titles differ editorially (rewrites, added subtitles).
        if len(item_entities & cluster_entities) >= 2 and time_delta <= 48:
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
                    tags = _apply_source_topic_overrides(
                        classify_topic_tags(primary.title, primary.summary),
                        members,
                    )
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

            tags = _apply_source_topic_overrides(
                classify_topic_tags(item.title, item.summary),
                [item],
            )
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
                    if region == "turkey":
                        region_clause = "AND region IN ('global', 'turkey')"
                    else:
                        region_clause = "AND region = 'global'"
                    rows = await conn.fetch(
                        f"""
                        SELECT entity_name, fact_key, fact_value,
                               confirmation_count,
                               first_seen_at::date AS first_seen,
                               last_confirmed_at::date AS last_confirmed
                        FROM news_entity_facts
                        WHERE LOWER(entity_name) = ANY($1)
                          AND is_current = TRUE
                          AND confirmation_count >= 2
                          {region_clause}
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
            "headline (<=120 chars, thematic — no company names), "
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

        def _research_enrichment(c: StoryCluster) -> Dict[str, Any]:
            """Include web research findings when available."""
            rc = getattr(c, "research_context", None)
            if not rc or not isinstance(rc, dict):
                return {}
            findings = rc.get("key_findings")
            if findings:
                return {"web_research": findings[:3]}
            return {}

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
                    "source_count": int(_count_non_lead_members(c.members)),
                    **_memory_enrichment(c),
                    **_research_enrichment(c),
                }
                for c in top_clusters
            ],
        }
        if editorial_memory:
            user_payload["editorial_memory"] = editorial_memory

        def parse_daily_brief(parsed: Dict[str, Any], model_label: Optional[str]) -> Optional[Dict[str, Any]]:
            headline = _shorten_text(str(parsed.get("headline") or ""), 120)
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

            brief_result: Dict[str, Any] = {
                "headline": headline,
                "summary": summary,
                "bullets": bullets,
                "themes": themes,
                "cluster_count": top_n,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

            # Add deep dives from researched clusters (max 2)
            deep_dives: List[Dict[str, Any]] = []
            for c in top_clusters:
                rc = getattr(c, "research_context", None)
                if rc and isinstance(rc, dict) and rc.get("deep_dive_markdown"):
                    deep_dives.append({
                        "title": c.title,
                        "body": rc["deep_dive_markdown"],
                        "sources": rc.get("sources_used", []),
                    })
                    if len(deep_dives) >= 2:
                        break
            if deep_dives:
                brief_result["deep_dives"] = deep_dives

            return brief_result

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
        """Classify Turkey news items for tech/startup relevance using LLM.

        Returns items with score >= 1 (broader tech/startup ecosystem).
        Score 2 (AI/ML) items get a turkey_priority payload flag for ranking boost.
        Sends items in batches of 20. On failure, falls back to keyword heuristic.
        """
        if not items:
            return []

        # No LLM provider → fall back to keyword heuristic
        if not self.azure_client and not self.openai_api_key:
            print(f"[news-ingest] {source_key}: LLM unavailable, falling back to keyword filter")
            result = []
            for i in items:
                if _is_relevant_turkey_news_item(i):
                    if i.payload is None:
                        i.payload = {}
                    i.payload["turkey_priority"] = 1
                    i.payload["turkey_classified_by"] = "heuristic"
                    result.append(i)
            return result

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

            classifications: Optional[List[int]] = None
            try:
                classifications = await self._call_turkey_classifier_llm(prompt_text, len(batch))
            except Exception as exc:
                print(f"[news-ingest] {source_key}: LLM turkey classification failed: {exc}")

            if classifications is not None and len(classifications) == len(batch):
                for item, score in zip(batch, classifications):
                    if score >= 1:
                        if item.payload is None:
                            item.payload = {}
                        item.payload["turkey_priority"] = score
                        item.payload["turkey_classified_by"] = "llm"
                        kept.append(item)
            else:
                # Fallback: use keyword heuristic for this batch
                for item in batch:
                    if _is_relevant_turkey_news_item(item):
                        if item.payload is None:
                            item.payload = {}
                        item.payload["turkey_priority"] = 1
                        item.payload["turkey_classified_by"] = "heuristic"
                        kept.append(item)

        return kept

    async def _call_turkey_classifier_llm(self, prompt: str, expected_count: int) -> Optional[List[int]]:
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
    def _parse_classification_response(content: str, expected_count: int) -> Optional[List[int]]:
        """Parse LLM JSON response into a list of relevance scores (0/1/2).

        Backwards-compatible: boolean true→1, false→0.
        """
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
            result: List[int] = []
            for v in arr:
                if isinstance(v, bool):
                    result.append(1 if v else 0)
                else:
                    result.append(max(0, min(2, int(v))))
            if len(result) != expected_count:
                return None
            return result
        except (json.JSONDecodeError, TypeError, ValueError):
            return None

    async def _llm_enrich_cluster(self, cluster: StoryCluster, region: str = "global") -> LLMEnrichmentResult:
        if not self.openai_api_key and not self.azure_client:
            return LLMEnrichmentResult(None, None, None, None, None, None, None, error_code="no_provider")

        lang_instruction = (
            "\n\nIMPORTANT: Write ALL output values (builder_takeaway, summary, "
            "impact.kicker, impact.builder_move, impact.investor_angle, impact.watchout, "
            "impact.validation, ba_title, ba_bullets, why_it_matters) in Turkish (Türkçe). "
            "Use native Turkish phrasing, not machine-translated English. "
            "JSON keys stay in English."
        ) if region == "turkey" else ""

        ranked_members = sorted(
            _non_lead_members(cluster.members),
            key=lambda m: (m.source_weight, m.published_at),
            reverse=True,
        )
        cluster_member_titles = [m.title for m in ranked_members if m.title]
        source_rows: List[Dict[str, Any]] = []
        expected_review_url_set: Set[str] = set()
        for i, member in enumerate(ranked_members, start=1):
            raw_url = (member.canonical_url or member.url or "").strip()
            canonical_url = canonicalize_url(raw_url) if raw_url else ""
            if canonical_url:
                expected_review_url_set.add(canonical_url)
            source_rows.append(
                {
                    "source_rank": i,
                    "publisher": member.source_key,
                    "source_weight": round(float(member.source_weight), 3),
                    "published_at": member.published_at.isoformat() if member.published_at else None,
                    "canonical_url": canonical_url or raw_url,
                    "headline": _shorten_text(member.title or "", 140),
                    "summary": _shorten_text(member.summary or "", 180),
                }
            )
        expected_source_count = len(source_rows)

        if INTEL_FIRST_PROMPT_ENABLED:
            prompt = (
                "You are BuildAtlas, a startup intelligence platform. "
                "Produce structured intelligence from news clusters. Output JSON only. "
                "Never copy source sentences — paraphrase aggressively. "
                "Never reconstruct article structure. No multi-paragraph content."
            )
            user_prompt_prefix = (
                "Analyze this cluster of related news sources about the same event/topic. "
                "Create BuildAtlas intelligence with strict paraphrasing and citation-first behavior.\n\n"
                "CONSTRAINTS:\n"
                "- ba_title is a SHORT punchy intel headline (max 80 chars). State the core signal in one clause. "
                "Do NOT pack implications, qualifiers, or secondary analysis into the title — those belong in why_it_matters and ba_bullets. "
                "Good: \"Anthropic's $30B raise intensifies the AI capital race\" "
                "Bad: \"Anthropic's $30B Series G underscores a high-velocity AI capital race, signaling intensified competition and a higher-ceiling valuation trajectory\"\n"
                "- You MUST review every item in sources[] before producing any intel fields.\n"
                "- ba_bullets must be abstract claims about implications, not story narration.\n"
                "- Quotes are DISALLOWED by default. If exactly one short quote (<=20 words) adds unique value, "
                "set quote_allowed=true and provide quote_text + quote_source_url. Otherwise quote_allowed=false.\n"
                "- Prefer verification-oriented framing: implications + what to check next.\n"
                "- All text must be original paraphrase. Do not copy phrases >8 consecutive words from any source.\n"
                "- Set reviewed_source_count to the exact number of sources you actually reviewed.\n"
                "- Set reviewed_source_urls to the canonical_url values for ALL reviewed sources.\n"
                + lang_instruction + "\n\n"
            )
        else:
            prompt = (
                "You are a startup intelligence analyst writing 1-sentence briefs that explain "
                "why a news story matters — for both builders (technical founders, engineers) "
                "and investors (VCs, angels). "
                "The brief must reference the specific company or technology by name. "
                "BAD: 'This funding round shows strong market interest.' (too generic) "
                "GOOD: 'Cursor\\'s $100M raise at $2.5B validates AI-native IDEs as a category — "
                "builders should watch lock-in risk; investors should note the 10x ARR multiple "
                "setting valuation benchmarks.' "
                "Return strict JSON with ALL of these keys (every key is REQUIRED): "
                "builder_takeaway (2-3 sentences, specific), "
                "summary (<=160 chars), "
                "story_type (funding|launch|mna|regulation|hiring|news), "
                "topic_tags (array of up to 6 lowercase tags), "
                "signal_score (0-1), confidence_score (0-1), "
                "impact (object with: "
                "frame — pick ONE from: UNDERWRITING_TAKE, ADOPTION_PLAY, COST_CURVE, LATENCY_LEVER, "
                "BENCHMARK_TRAP, DATA_MOAT, PROCUREMENT_WEDGE, REGULATORY_CONSTRAINT, ATTACK_SURFACE, "
                "CONSOLIDATION_SIGNAL, HIRING_SIGNAL, PLATFORM_SHIFT, GO_TO_MARKET_EDGE, EARLY_SIGNAL; "
                "kicker — <=48 char punchy headline for the impact box; "
                "builder_move — <=120 char concrete next step for a technical founder; "
                "investor_angle — <=120 char thesis-level insight for VCs; "
                "watchout — OPTIONAL <=120 char risk or gotcha; "
                "validation — OPTIONAL <=120 char how to verify the claim). "
                "No prose outside JSON."
                + lang_instruction
            )
            user_prompt_prefix = ""
        user_payload = {
            "title": cluster.title,
            "summary": cluster.summary,
            "story_type": cluster.story_type,
            "topic_tags": cluster.topic_tags[:6],
            "entities": cluster.entities[:6],
            "source_count": _count_non_lead_members(cluster.members),
            "source_count_expected": expected_source_count,
            "source_count_payload": expected_source_count,
            "source_urls_expected": [row.get("canonical_url") for row in source_rows if row.get("canonical_url")],
            "sources": source_rows,
            "rank_reason": cluster.rank_reason,
            "current_rank_score": cluster.rank_score,
            "current_trust_score": cluster.trust_score,
        }
        # Inject web research context when available (from prior research run)
        if cluster.research_context:
            rc = cluster.research_context
            user_payload["web_research_findings"] = {
                "key_findings": rc.get("key_findings", []),
                "builder_implications": rc.get("builder_implications", ""),
            }
        debug_llm = os.getenv("NEWS_LLM_DEBUG", "false").lower() in {"1", "true", "yes", "on"}

        def _norm_key(value: Any) -> str:
            try:
                s = str(value or "")
            except Exception:
                return ""
            return re.sub(r"[^a-z0-9]+", "", s.lower())

        def _pick(obj: Dict[str, Any], candidates: Sequence[str]) -> Any:
            if not isinstance(obj, dict) or not obj:
                return None
            # Case-insensitive, punctuation-insensitive key lookup.
            norm_to_actual: Dict[str, str] = {}
            for k in obj.keys():
                if not isinstance(k, str):
                    continue
                nk = _norm_key(k)
                if nk and nk not in norm_to_actual:
                    norm_to_actual[nk] = k
            for cand in candidates:
                ak = norm_to_actual.get(_norm_key(cand))
                if ak is not None:
                    return obj.get(ak)
            return None

        def _unwrap_obj(value: Any) -> Dict[str, Any]:
            if not isinstance(value, dict):
                return {}
            # If the object already looks like the expected shape, keep it.
            if _pick(value, ["builder_takeaway", "builderTakeaway", "builder_takeaways", "summary", "topic_tags", "story_type"]) is not None:
                return value
            # Common wrapper keys (some models nest the payload).
            for wrapper in ("result", "output", "data", "response", "payload"):
                nested = value.get(wrapper)
                if isinstance(nested, dict):
                    return nested
            # If there's exactly one dict value, assume that's the payload.
            dict_values = [v for v in value.values() if isinstance(v, dict)]
            if len(dict_values) == 1:
                return dict_values[0]
            return value

        def _coerce_text(value: Any) -> str:
            if value is None:
                return ""
            if isinstance(value, str):
                return value
            if isinstance(value, (int, float, bool)):
                return str(value)
            # Some SDKs return content parts (list of dicts/objects).
            if isinstance(value, list):
                parts: List[str] = []
                for part in value:
                    if part is None:
                        continue
                    if isinstance(part, str):
                        parts.append(part)
                        continue
                    if isinstance(part, dict):
                        for k in ("text", "content", "value"):
                            if isinstance(part.get(k), str) and part.get(k).strip():
                                parts.append(str(part.get(k)))
                                break
                        else:
                            # Shallow stringify fallback
                            try:
                                parts.append(json.dumps(part))
                            except Exception:
                                parts.append(str(part))
                        continue
                    # object with `.text`
                    if hasattr(part, "text"):
                        try:
                            t = getattr(part, "text")
                            if isinstance(t, str):
                                parts.append(t)
                                continue
                        except Exception:
                            pass
                    parts.append(str(part))
                return "\n".join([p for p in (normalize_text(p) for p in parts) if p])
            if isinstance(value, dict):
                for k in ("text", "content", "value"):
                    if isinstance(value.get(k), str) and value.get(k).strip():
                        return str(value.get(k))
                try:
                    return json.dumps(value)
                except Exception:
                    return str(value)
            if hasattr(value, "text"):
                try:
                    t = getattr(value, "text")
                    if isinstance(t, str):
                        return t
                except Exception:
                    pass
            return str(value)

        def _parse_json_payload(content: Any) -> Dict[str, Any]:
            if content is None:
                return {}
            if isinstance(content, dict):
                return content
            if isinstance(content, str):
                text = content.strip() or "{}"
                try:
                    parsed = json.loads(text)
                    return parsed if isinstance(parsed, dict) else {}
                except Exception:
                    return {}
            if isinstance(content, list):
                joined = _coerce_text(content)
                if not joined:
                    return {}
                try:
                    parsed = json.loads(joined)
                    return parsed if isinstance(parsed, dict) else {}
                except Exception:
                    return {}
            return {}

        def parse_llm_payload(parsed: Dict[str, Any], model_label: Optional[str]) -> LLMEnrichmentResult:
            root = _unwrap_obj(parsed)
            # Support a few common key variants to avoid silent empty outputs.
            summary_raw = _pick(root, ["summary", "short_summary", "brief", "tldr", "tl;dr"])
            takeaway_raw = _pick(root, ["builder_takeaway", "builderTakeaway", "builder_takeaways", "why_it_matters", "whyItMatters", "builder_view", "takeaway"])
            topic_raw = _pick(root, ["topic_tags", "topicTags"])
            story_raw = _pick(root, ["story_type", "storyType"])
            signal_raw = _pick(root, ["signal_score", "signalScore"])
            confidence_raw = _pick(root, ["confidence_score", "confidenceScore"])

            llm_summary = _shorten_text(_coerce_text(summary_raw), 180) or None
            builder_takeaway = _shorten_text(_coerce_text(takeaway_raw), 500) or None
            signal_score = clamp01(signal_raw, default=None)
            confidence_score = clamp01(confidence_raw, default=None)

            # Accept comma-separated topic tags (models sometimes return a single string).
            if isinstance(topic_raw, str):
                topic_raw = [t.strip() for t in re.split(r"[,;|]+", topic_raw) if t.strip()]
            llm_topic_tags = normalize_llm_topic_tags(topic_raw, cluster.topic_tags)
            llm_story_type = normalize_llm_story_type(story_raw, cluster.story_type)

            # --- Impact object extraction ---
            impact_raw = _pick(root, ["impact", "impact_object", "structured_impact"])
            impact_obj: Optional[Dict[str, Any]] = None
            if isinstance(impact_raw, dict):
                frame = str(impact_raw.get("frame") or "").upper().replace("-", "_").replace(" ", "_")
                if frame not in IMPACT_FRAMES:
                    frame = "EARLY_SIGNAL"
                kicker = _shorten_text(str(impact_raw.get("kicker") or ""), 48)
                if frame and kicker:
                    impact_obj = {
                        "frame": frame,
                        "kicker": kicker,
                        "builder_move": _shorten_text(str(impact_raw.get("builder_move") or ""), 120),
                        "investor_angle": _shorten_text(str(impact_raw.get("investor_angle") or ""), 120),
                    }
                    watchout = _shorten_text(str(impact_raw.get("watchout") or ""), 120)
                    validation = _shorten_text(str(impact_raw.get("validation") or ""), 120)
                    if watchout:
                        impact_obj["watchout"] = watchout
                    if validation:
                        impact_obj["validation"] = validation

                    # Apply deterministic frame override when applicable
                    override = determine_frame_override(
                        story_type=llm_story_type or cluster.story_type,
                        topic_tags=llm_topic_tags or cluster.topic_tags,
                        confidence_score=confidence_score,
                        has_conflicting_reports=False,
                    )
                    if override:
                        impact_obj["frame"] = override

            # --- Intel-first fields (only populated when INTEL_FIRST_PROMPT is enabled) ---
            ba_title_raw = _pick(root, ["ba_title", "baTitle", "intel_headline"])
            ba_bullets_raw = _pick(root, ["ba_bullets", "baBullets", "intel_bullets"])
            why_it_matters_raw = _pick(root, ["why_it_matters", "whyItMatters", "implication"])
            quote_allowed_raw = _pick(root, ["quote_allowed", "quoteAllowed"])
            reviewed_source_count_raw = _pick(root, ["reviewed_source_count", "reviewedSourceCount"])
            reviewed_source_urls_raw = _pick(root, ["reviewed_source_urls", "reviewedSourceUrls"])

            ba_title = _shorten_text(_coerce_text(ba_title_raw), 120) or None if ba_title_raw else None
            ba_bullets: Optional[List[str]] = None
            if isinstance(ba_bullets_raw, list):
                ba_bullets = [_coerce_text(b) for b in ba_bullets_raw if _coerce_text(b)]
            why_it_matters = _shorten_text(_coerce_text(why_it_matters_raw), 160) or None if why_it_matters_raw else None

            reviewed_source_count: Optional[int] = None
            if reviewed_source_count_raw is not None and not isinstance(reviewed_source_count_raw, bool):
                try:
                    reviewed_source_count = max(0, int(reviewed_source_count_raw))
                except (TypeError, ValueError):
                    reviewed_source_count = None

            reviewed_source_urls: List[str] = []
            if isinstance(reviewed_source_urls_raw, list):
                for value in reviewed_source_urls_raw:
                    text = _coerce_text(value).strip()
                    if text:
                        reviewed_source_urls.append(text)

            # Quote validation: if quote_allowed but quote >20 words, disable it
            if quote_allowed_raw is True:
                quote_text = _pick(root, ["quote_text", "quoteText"])
                if isinstance(quote_text, str) and len(quote_text.split()) > 20:
                    # Too long — suppress quote
                    pass  # Don't store quote fields

            result = LLMEnrichmentResult(
                llm_summary,
                builder_takeaway,
                model_label,
                signal_score,
                confidence_score,
                llm_topic_tags,
                llm_story_type,
                impact=impact_obj,
                ba_title=ba_title,
                ba_bullets=ba_bullets,
                why_it_matters=why_it_matters,
            )

            def _validate_source_review_proof() -> Optional[str]:
                if not INTEL_FIRST_PROMPT_ENABLED:
                    return None
                if expected_source_count <= 0:
                    return None
                if reviewed_source_count is None:
                    return "intel_source_review_count_missing"
                if reviewed_source_count != expected_source_count:
                    return "intel_source_review_count_mismatch"
                if not reviewed_source_urls:
                    return "intel_source_review_urls_missing"

                normalized_reviewed_urls: Set[str] = set()
                for u in reviewed_source_urls:
                    normalized = canonicalize_url(u)
                    if normalized:
                        normalized_reviewed_urls.add(normalized)

                if expected_review_url_set and not expected_review_url_set.issubset(normalized_reviewed_urls):
                    return "intel_source_review_urls_mismatch"
                return None

            # Apply validation guardrails (strictly block intel fields on proof/quality failures).
            intel_error = _validate_source_review_proof()
            if not intel_error:
                intel_error = _validate_intel_fields(
                    result,
                    cluster.title or "",
                    cluster.summary or "",
                    member_titles=cluster_member_titles,
                )
            if intel_error:
                result.ba_title = None
                result.ba_bullets = None
                result.why_it_matters = None
                result.error_code = intel_error
                if debug_llm:
                    print(
                        f"[news-ingest] intel validation rejected cluster "
                        f"(region={region} cluster={cluster.cluster_key[:10]} reason={intel_error})"
                    )
            return result

        last_error_code: Optional[str] = None
        if self.azure_client is not None:
            candidate_models: List[str] = []
            for m in [self.azure_openai_deployment, self.azure_openai_fallback_deployment]:
                if m and m not in candidate_models:
                    candidate_models.append(m)

            # Prefer Responses API when available (more reliable for GPT-5 family and enables strict JSON schema).
            if hasattr(self.azure_client, "responses"):
                json_schema_props: Dict[str, Any] = {
                    "builder_takeaway": {"type": "string", "minLength": 1, "maxLength": 800},
                    "summary": {"type": "string", "maxLength": 200},
                    "story_type": {"type": "string", "enum": list(ALLOWED_STORY_TYPES)},
                    "topic_tags": {"type": "array", "maxItems": 6, "items": {"type": "string", "maxLength": 32}},
                    "signal_score": {"type": "number", "minimum": 0, "maximum": 1},
                    "confidence_score": {"type": "number", "minimum": 0, "maximum": 1},
                    "impact": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "frame": {"type": "string", "enum": sorted(IMPACT_FRAMES)},
                            "kicker": {"type": "string", "maxLength": 60},
                            "builder_move": {"type": "string", "maxLength": 150},
                            "investor_angle": {"type": "string", "maxLength": 150},
                            "watchout": {"type": "string", "maxLength": 150},
                            "validation": {"type": "string", "maxLength": 150},
                        },
                        "required": ["frame", "kicker", "builder_move", "investor_angle", "watchout", "validation"],
                    },
                }
                json_schema_required = ["builder_takeaway", "summary", "story_type", "topic_tags", "signal_score", "confidence_score", "impact"]
                if INTEL_FIRST_PROMPT_ENABLED:
                    json_schema_props["ba_title"] = {"type": "string", "maxLength": 90}
                    json_schema_props["ba_bullets"] = {"type": "array", "minItems": 2, "maxItems": 4, "items": {"type": "string", "maxLength": 180}}
                    json_schema_props["why_it_matters"] = {"type": "string", "maxLength": 160}
                    json_schema_props["reviewed_source_count"] = {"type": "integer", "minimum": 0}
                    json_schema_props["reviewed_source_urls"] = {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 256,
                        "items": {"type": "string", "minLength": 1, "maxLength": 600},
                    }
                    json_schema_props["key_claims"] = {"type": "array", "maxItems": 4, "items": {"type": "string"}}
                    json_schema_props["entities"] = {"type": "array", "maxItems": 6, "items": {"type": "object", "properties": {"name": {"type": "string"}, "type": {"type": "string"}}, "required": ["name", "type"], "additionalProperties": False}}
                    json_schema_props["quote_allowed"] = {"type": "boolean"}
                    json_schema_props["quote_text"] = {"type": ["string", "null"]}
                    json_schema_props["quote_source_url"] = {"type": ["string", "null"]}
                    json_schema_required.extend([
                        "ba_title",
                        "ba_bullets",
                        "why_it_matters",
                        "reviewed_source_count",
                        "reviewed_source_urls",
                        "key_claims",
                        "entities",
                        "quote_allowed",
                        "quote_text",
                        "quote_source_url",
                    ])
                json_schema = {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": json_schema_props,
                    "required": json_schema_required,
                }
                for model_name in candidate_models:
                    try:
                        payload: Dict[str, Any] = {
                            "model": model_name,
                            "input": [
                                {"role": "system", "content": prompt},
                                {"role": "user", "content": user_prompt_prefix + json.dumps(user_payload)},
                            ],
                            # Keep ample budget for GPT-5 reasoning tokens while capping runaway costs.
                            "max_output_tokens": min(2048, _azure_token_budget(model_name, 500)),
                            "text": {
                                "format": {
                                    "type": "json_schema",
                                    "name": "cluster_enrichment",
                                    "schema": json_schema,
                                    "strict": True,
                                }
                            },
                        }
                        if _azure_supports_reasoning_effort(model_name):
                            payload["reasoning"] = {"effort": self.azure_openai_daily_brief_effort}
                        if _azure_supports_temperature(model_name):
                            payload["temperature"] = 0.2

                        try:
                            response = await self.azure_client.responses.create(**payload)
                        except Exception as exc:
                            if _is_unsupported_temperature_exception(exc):
                                payload.pop("temperature", None)
                                response = await self.azure_client.responses.create(**payload)
                            else:
                                raise

                        content = getattr(response, "output_text", None)
                        if callable(content):
                            content = content()
                        if not content:
                            content = getattr(response, "text", None) or "{}"
                        parsed = _parse_json_payload(content)
                        result = parse_llm_payload(parsed, f"azure:{model_name}")
                        if not result.builder_takeaway:
                            last_error_code = "azure_empty_builder_takeaway"
                            if debug_llm:
                                print(f"[news-ingest] Azure responses enrichment missing builder_takeaway (model={model_name}) content: {str(content)[:200]}")
                            continue
                        return result
                    except Exception as exc:
                        if debug_llm:
                            print(f"[news-ingest] Azure responses enrichment failed (model={model_name}): {exc}")
                        last_error_code = "azure_timeout" if _is_timeout_exception(exc) else "azure_error"

            for model_name in candidate_models:
                for with_response_format in (True, False):
                    token_param = _azure_token_param_name(model_name)
                    azure_payload: Dict[str, Any] = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": prompt},
                            {"role": "user", "content": user_prompt_prefix + json.dumps(user_payload)},
                        ],
                    }
                    if _azure_supports_temperature(model_name):
                        azure_payload["temperature"] = 0.2
                    azure_payload[token_param] = _azure_token_budget(model_name, 500)
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

                        choice = (response.choices or [None])[0] if response.choices else None
                        raw_content = (choice.message.content if choice else "{}") or "{}"
                        parsed = _parse_json_payload(raw_content)
                        result = parse_llm_payload(parsed, f"azure:{model_name}")
                        # Detect reasoning-token exhaustion: model set but no useful output
                        finish = choice.finish_reason if choice else None
                        if result.llm_model and not result.builder_takeaway and finish == "length":
                            if debug_llm:
                                print(f"[news-ingest] Azure LLM empty output (finish_reason=length, model={model_name}) — token budget exhausted")
                            last_error_code = "azure_token_exhausted"
                            continue  # try next model/format
                        if not result.builder_takeaway:
                            last_error_code = "azure_empty_builder_takeaway"
                            if debug_llm:
                                mode = "json_object" if with_response_format else "no_response_format"
                                print(f"[news-ingest] Azure LLM missing builder_takeaway ({mode} model={model_name}) content: {str(raw_content)[:200]}")
                            continue
                        return result
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
                            "max_tokens": 500,
                            "response_format": {"type": "json_object"},
                            "messages": [
                                {"role": "system", "content": prompt},
                                {"role": "user", "content": user_prompt_prefix + json.dumps(user_payload)},
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
                    parsed = _parse_json_payload(content)
                    result = parse_llm_payload(parsed, self.llm_model)
                    if not result.builder_takeaway:
                        return LLMEnrichmentResult(
                            None,
                            None,
                            None,
                            None,
                            None,
                            None,
                            None,
                            timed_out=False,
                            error_code="openai_empty_builder_takeaway",
                        )
                    return result
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

    async def _enrich_clusters_with_llm(self, clusters: Sequence[StoryCluster], region: str = "global") -> None:
        self._llm_metrics = {
            "enabled": bool(self.llm_enrichment_enabled),
            "model": self.llm_model,
            "max_clusters": int(self.llm_max_clusters),
            "concurrency": int(self.llm_concurrency),
            "attempted": 0,
            "succeeded": 0,
            "failed": 0,
            "timeouts": 0,
            "intel_attempted": 0,
            "intel_accepted": 0,
            "intel_rejected_validation": 0,
            "intel_missing_source_proof": 0,
            "intel_rejection_reasons": {},
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

        # All clusters are enrichment candidates — gating is advisory, not a
        # hard filter. LLM enrichment should run on the top-N by rank regardless
        # of gating decision so that edition items always have builder_takeaway.
        enrichment_candidates = list(clusters)

        # Hard exclude: never spend LLM budget on lead-only clusters.
        before_leads = len(enrichment_candidates)
        enrichment_candidates = [
            c for c in enrichment_candidates
            if _count_non_lead_members(getattr(c, "members", [])) > 0
        ]
        skipped_by_lead_only = before_leads - len(enrichment_candidates)

        # Further filter: skip if strong negative signal history
        sig_agg = getattr(self, "_signal_aggregator", None)
        skipped_by_gating = 0
        skipped_by_signal = 0
        if sig_agg and sig_agg.loaded:
            before = len(enrichment_candidates)
            enrichment_candidates = [
                c for c in enrichment_candidates
                if not sig_agg.has_negative_signal_pattern(
                    primary_source_key=c.primary_source_key,
                    topic_tags=c.topic_tags,
                )
            ]
            skipped_by_signal = before - len(enrichment_candidates)

        top_n = min(len(enrichment_candidates), self.llm_max_clusters)
        top_clusters = enrichment_candidates[:top_n]
        semaphore = asyncio.Semaphore(self.llm_concurrency)
        self._llm_metrics["attempted"] = int(top_n)
        self._llm_metrics["intel_attempted"] = int(top_n) if INTEL_FIRST_PROMPT_ENABLED else 0
        self._llm_metrics["skipped_by_gating"] = int(skipped_by_gating)
        self._llm_metrics["skipped_by_lead_only"] = int(skipped_by_lead_only)
        self._llm_metrics["skipped_by_signal"] = int(skipped_by_signal)

        async def enrich_one(
            cluster: StoryCluster,
        ) -> Tuple[StoryCluster, LLMEnrichmentResult, float]:
            async with semaphore:
                started = time.perf_counter()
                llm_result = await self._llm_enrich_cluster(cluster, region=region)
                latency_ms = (time.perf_counter() - started) * 1000.0
                return (cluster, llm_result, latency_ms)

        results = await asyncio.gather(*(enrich_one(cluster) for cluster in top_clusters))
        latencies_ms = [latency for _, _, latency in results]
        succeeded = 0
        timeout_count = 0
        intel_accepted = 0
        intel_rejected_validation = 0
        intel_missing_source_proof = 0
        intel_rejection_reasons: Dict[str, int] = {}

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
            if llm_result.impact:
                cluster.impact = llm_result.impact
            if llm_topic_tags:
                merged_tags = _apply_source_topic_overrides(llm_topic_tags, cluster.members)
                cluster.llm_topic_tags = list(merged_tags)
                cluster.topic_tags = list(merged_tags)
            else:
                cluster.topic_tags = _apply_source_topic_overrides(cluster.topic_tags, cluster.members)
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

            # Intel-first fields
            if llm_result.ba_title:
                cluster.ba_title = llm_result.ba_title
                if INTEL_FIRST_PROMPT_ENABLED:
                    intel_accepted += 1
            if llm_result.ba_bullets:
                cluster.ba_bullets = llm_result.ba_bullets
            if llm_result.why_it_matters:
                cluster.why_it_matters = llm_result.why_it_matters

            if INTEL_FIRST_PROMPT_ENABLED and llm_result.error_code and llm_result.error_code.startswith("intel_"):
                intel_rejected_validation += 1
                intel_rejection_reasons[llm_result.error_code] = intel_rejection_reasons.get(llm_result.error_code, 0) + 1
                if llm_result.error_code in INTEL_SOURCE_REVIEW_ERROR_CODES:
                    intel_missing_source_proof += 1

        # Build evidence and enrichment hash for ALL clusters (deterministic, zero LLM cost)
        for cluster in clusters:
            cluster.evidence_json = _build_evidence_json(cluster)
            cluster.enrichment_hash = _compute_enrichment_hash(cluster)
            cluster.prompt_version = ENRICHMENT_PROMPT_VERSION

        attempted = int(self._llm_metrics.get("attempted") or 0)
        failed = max(0, attempted - succeeded)
        self._llm_metrics["succeeded"] = int(succeeded)
        self._llm_metrics["failed"] = int(failed)
        self._llm_metrics["timeouts"] = int(timeout_count)
        self._llm_metrics["intel_accepted"] = int(intel_accepted)
        self._llm_metrics["intel_rejected_validation"] = int(intel_rejected_validation)
        self._llm_metrics["intel_missing_source_proof"] = int(intel_missing_source_proof)
        self._llm_metrics["intel_rejection_reasons"] = dict(
            sorted(intel_rejection_reasons.items(), key=lambda kv: (-kv[1], kv[0]))
        )
        if latencies_ms:
            self._llm_metrics["latency_ms_p50"] = round(_percentile(latencies_ms, 50), 2)
            self._llm_metrics["latency_ms_p95"] = round(_percentile(latencies_ms, 95), 2)
            self._llm_metrics["latency_ms_avg"] = round(sum(latencies_ms) / len(latencies_ms), 2)

        if INTEL_FIRST_PROMPT_ENABLED and int(self._llm_metrics.get("intel_attempted") or 0) > 0:
            reasons = self._llm_metrics.get("intel_rejection_reasons") or {}
            reasons_text = ", ".join(f"{k}={v}" for k, v in reasons.items()) if reasons else "none"
            print(
                f"[news-ingest] intel validation ({region}): "
                f"attempted={self._llm_metrics.get('intel_attempted')} "
                f"accepted={self._llm_metrics.get('intel_accepted')} "
                f"rejected={self._llm_metrics.get('intel_rejected_validation')} "
                f"missing_source_proof={self._llm_metrics.get('intel_missing_source_proof')} "
                f"reasons={reasons_text}"
            )

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
            if _count_non_lead_members(cluster.members) == 0:
                continue
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
        cluster_ids: Optional[Dict[str, str]] = None,
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
            # Hard guardrail: never allow a cluster composed only of paid/headline
            # leads to proceed through the normal pipeline. These are triggers for
            # open-web corroboration, not publishable items on their own.
            if _count_non_lead_members(cluster.members) == 0:
                cluster.gating_decision = "drop"
                cluster.gating_reason = "Paid headline lead without corroboration"
                cluster.gating_scores = {
                    "builder_insight": 0,
                    "pattern_novelty": 0,
                    "gtm_uniqueness": 0,
                    "evidence_quality": 0,
                    "composite": 0.0,
                }
                decision_counts["drop"] = decision_counts.get("drop", 0) + 1
                continue
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
                non_lead_members = _non_lead_members(cluster.members)
                source_count = len(non_lead_members)
                source_credibility = max(
                    (m.source_weight for m in non_lead_members), default=0.65
                )
                sig_agg = getattr(self, "_signal_aggregator", None)
                cid = (cluster_ids or {}).get(cluster.cluster_key)
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
                    signal_aggregator=sig_agg,
                    cluster_id=cid,
                    source_key=cluster.primary_source_key,
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
                # Default: let it through to LLM (publish) with zero scores
                # so _persist_gating_decisions creates a row for post-gate editorial updates
                cluster.gating_decision = "publish"
                cluster.gating_reason = f"Gating error: {exc}"
                cluster.gating_scores = {
                    "builder_insight": 0, "pattern_novelty": 0,
                    "gtm_uniqueness": 0, "evidence_quality": 0,
                    "composite": 0.0,
                }
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

    async def _extract_events(
        self,
        conn: "asyncpg.Connection",
        clusters: Sequence[StoryCluster],
        cluster_ids: Dict[str, str],
        region: str = "global",
    ) -> Dict[str, Any]:
        """Extract structured events from clusters and persist to startup_events.

        Uses the EventExtractor to convert memory gate outputs (claims, patterns,
        GTM tags) into typed events with event_registry linkage. Zero LLM cost.
        Also enqueues refresh jobs for startups with qualifying events.
        """
        stats: Dict[str, Any] = {
            "extracted": 0,
            "persisted": 0,
            "persist_errors": 0,
            "first_error": None,
            "funding_rounds_upserted": 0,
            "onboarded_startups": 0,
            "graph": {
                "events_considered": 0,
                "investors_created": 0,
                "edges_upserted": 0,
                "skipped": 0,
            },
        }
        try:
            from .event_extractor import (
                EventExtractor,
                enqueue_refresh_for_events,
                persist_events,
                upsert_capital_graph_from_events,
                upsert_funding_from_events,
                onboard_unknown_startups,
            )
        except ImportError:
            print("[news-ingest] event_extractor module not available, skipping event extraction")
            return stats

        try:
            extractor = EventExtractor()
            await extractor.load(conn)
        except Exception as exc:
            print(f"[news-ingest] Failed to load EventExtractor (event_registry table may not exist): {exc}")
            return stats

        all_events = []
        for cluster in clusters:
            cid = cluster_ids.get(cluster.cluster_key)
            events = extractor.extract_from_cluster(cluster, cid, region=region)
            all_events.extend(events)

        if not all_events:
            return stats

        stats["extracted"] = len(all_events)

        # Onboard unknown startups from unlinked entity mentions before we persist events.
        # This reduces NULL startup_id rows (which are not actionable downstream) and makes
        # the (cluster_id, startup_id, event_type, event_key) dedupe index effective.
        try:
            onboarded = await onboard_unknown_startups(conn, all_events, clusters)
            stats["onboarded_startups"] = onboarded
            if onboarded:
                print(f"[onboard:{region}] Created {onboarded} stub startups from unlinked events")
        except Exception as exc:
            print(f"[news-ingest] Failed to onboard unknown startups: {exc}")

        # Persist only actionable events (those that resolved to a startup_id).
        # Events without startup_id cannot be processed/enqueued for research and will
        # otherwise generate noisy missing_startup_id trace events.
        actionable_events = [e for e in all_events if getattr(e, "startup_id", None)]

        inserted, inserted_events, persist_diag = await persist_events(conn, actionable_events, extractor._registry)
        stats["persisted"] = inserted
        if isinstance(persist_diag, dict):
            stats["persist_errors"] = int(persist_diag.get("persist_errors") or 0)
            stats["first_error"] = persist_diag.get("first_error")
        print(
            f"[events:{region}] Extracted {len(all_events)} events from {len(clusters)} clusters, "
            f"actionable {len(actionable_events)}, persisted {inserted}"
        )

        # Upsert funding rounds from high-confidence funding events.
        # Runs after onboarding so newly discovered startups can receive rounds immediately.
        try:
            funding_inserted = await upsert_funding_from_events(conn, actionable_events)
            stats["funding_rounds_upserted"] = funding_inserted
            if funding_inserted:
                print(f"[funding:{region}] Upserted {funding_inserted} funding rounds from events")
        except Exception as exc:
            print(f"[news-ingest] Failed to upsert funding rounds from events: {exc}")

        # Sync investor/startup graph edges from funding events (can be disabled).
        # Runs after onboarding for the same reason as funding upsert.
        graph_sync_enabled = os.getenv("NEWS_GRAPH_SYNC_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
        if graph_sync_enabled:
            try:
                graph_stats = await upsert_capital_graph_from_events(conn, actionable_events)
                stats["graph"] = graph_stats
                if int(graph_stats.get("edges_upserted") or 0) > 0:
                    print(
                        f"[graph:{region}] Upserted {graph_stats.get('edges_upserted')} investor->startup edges "
                        f"(investors_created={graph_stats.get('investors_created')})"
                    )
            except Exception as exc:
                print(f"[news-ingest] Failed to sync capital graph from events: {exc}")

        # Enqueue refresh jobs for startups with qualifying events
        try:
            if inserted_events:
                await enqueue_refresh_for_events(conn, inserted_events)
        except Exception as exc:
            print(f"[news-ingest] Failed to enqueue refresh jobs (table may not exist yet): {exc}")

        return stats

    async def _refresh_capital_graph_views(self, conn: "asyncpg.Connection") -> bool:
        """Refresh graph materialized views when graph sync writes new edges."""
        try:
            fn_exists = await conn.fetchval(
                "SELECT to_regprocedure('refresh_capital_graph_views()') IS NOT NULL"
            )
            if not fn_exists:
                return False
            await conn.execute("SELECT refresh_capital_graph_views()")
            return True
        except Exception as exc:
            print(f"[graph] Failed to refresh graph materialized views: {exc}")
            return False

    async def _enqueue_hot_topic_research(
        self,
        conn: "asyncpg.Connection",
        clusters: Sequence[StoryCluster],
        cluster_ids: Dict[str, str],
        region: str = "global",
    ) -> int:
        """Detect hot topics and enqueue them for async web research."""
        try:
            from .topic_researcher import TopicResearcher, detect_hot_topics
        except ImportError:
            return 0

        try:
            topics = detect_hot_topics(clusters, cluster_ids, max_topics=5)
            if not topics:
                return 0

            researcher = TopicResearcher.__new__(TopicResearcher)
            enqueued = await researcher.enqueue(conn, topics, region=region)
            if enqueued:
                print(f"[topic-research:{region}] enqueued {enqueued} hot topics for research")
            return enqueued
        except Exception as exc:
            print(f"[topic-research:{region}] enqueue failed (table may not exist yet): {exc}")
            return 0

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
                        llm_topic_tags, llm_story_type, impact,
                        ba_title, ba_bullets, why_it_matters, evidence_json, enrichment_hash, prompt_version
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7::text[], $8::text[], $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::text[], $20, $21::jsonb,
                            $22, $23::jsonb, $24, $25::jsonb, $26, $27)
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
                        impact = CASE
                            WHEN EXCLUDED.llm_model IS NOT NULL AND EXCLUDED.impact IS NOT NULL
                                THEN EXCLUDED.impact
                            WHEN news_clusters.llm_model IS NOT NULL
                                THEN news_clusters.impact
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
                        llm_story_type = COALESCE(EXCLUDED.llm_story_type, news_clusters.llm_story_type),
                        ba_title = COALESCE(EXCLUDED.ba_title, news_clusters.ba_title),
                        ba_bullets = COALESCE(EXCLUDED.ba_bullets, news_clusters.ba_bullets),
                        why_it_matters = COALESCE(EXCLUDED.why_it_matters, news_clusters.why_it_matters),
                        evidence_json = COALESCE(EXCLUDED.evidence_json, news_clusters.evidence_json),
                        enrichment_hash = COALESCE(EXCLUDED.enrichment_hash, news_clusters.enrichment_hash),
                        prompt_version = COALESCE(EXCLUDED.prompt_version, news_clusters.prompt_version)
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
                    _count_non_lead_members(cluster.members),
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
                    json.dumps(cluster.impact) if cluster.impact else None,
                    cluster.ba_title,
                    json.dumps(cluster.ba_bullets) if cluster.ba_bullets else None,
                    cluster.why_it_matters,
                    json.dumps(cluster.evidence_json) if cluster.evidence_json else None,
                    cluster.enrichment_hash,
                    cluster.prompt_version,
                )
            else:
                cluster_id = await conn.fetchval(
                    """
                    INSERT INTO news_clusters (
                        cluster_key, canonical_url, title, summary, published_at, updated_at,
                        topic_tags, entities, story_type, source_count, rank_score, rank_reason, trust_score,
                        builder_takeaway, llm_summary, llm_model, llm_signal_score, llm_confidence_score,
                        llm_topic_tags, llm_story_type, impact,
                        ba_title, ba_bullets, why_it_matters, evidence_json, enrichment_hash, prompt_version
                    )
                    VALUES ($1, $2, $3, $4, $5, NOW(), $6::text[], $7::text[], $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::text[], $19, $20::jsonb,
                            $21, $22::jsonb, $23, $24::jsonb, $25, $26)
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
                        impact = CASE
                            WHEN EXCLUDED.llm_model IS NOT NULL AND EXCLUDED.impact IS NOT NULL
                                THEN EXCLUDED.impact
                            WHEN news_clusters.llm_model IS NOT NULL
                                THEN news_clusters.impact
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
                        llm_story_type = COALESCE(EXCLUDED.llm_story_type, news_clusters.llm_story_type),
                        ba_title = COALESCE(EXCLUDED.ba_title, news_clusters.ba_title),
                        ba_bullets = COALESCE(EXCLUDED.ba_bullets, news_clusters.ba_bullets),
                        why_it_matters = COALESCE(EXCLUDED.why_it_matters, news_clusters.why_it_matters),
                        evidence_json = COALESCE(EXCLUDED.evidence_json, news_clusters.evidence_json),
                        enrichment_hash = COALESCE(EXCLUDED.enrichment_hash, news_clusters.enrichment_hash),
                        prompt_version = COALESCE(EXCLUDED.prompt_version, news_clusters.prompt_version)
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
                    _count_non_lead_members(cluster.members),
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
                    json.dumps(cluster.impact) if cluster.impact else None,
                    cluster.ba_title,
                    json.dumps(cluster.ba_bullets) if cluster.ba_bullets else None,
                    cluster.why_it_matters,
                    json.dumps(cluster.evidence_json) if cluster.evidence_json else None,
                    cluster.enrichment_hash,
                    cluster.prompt_version,
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

            # Canonical Evidence Object contract for the cluster itself + member mapping.
            if self._evidence_objects_supported:
                try:
                    from .evidence_objects import replace_members, stable_hash, upsert_evidence_object

                    primary_lang = "en"
                    try:
                        primary_lang = str(ranked_members[primary_idx].language or "en")
                    except Exception:
                        primary_lang = "en"

                    h = stable_hash(["news_cluster", cluster.cluster_key, region])
                    cluster_evidence_id = await upsert_evidence_object(
                        conn,
                        evidence_type="news_cluster",
                        uri=cluster.canonical_url or f"news_cluster:{cluster.cluster_key}",
                        captured_at=cluster.published_at,
                        source_weight=float(cluster.trust_score or 0.5),
                        language=primary_lang,
                        content_ref=f"db://news_clusters/{str(cluster_id)}",
                        hash_value=h,
                        provenance={
                            "cluster_key": cluster.cluster_key,
                            "region": region,
                            "cluster_id": str(cluster_id),
                        },
                    )

                    await conn.execute(
                        """
                        UPDATE news_clusters
                        SET evidence_object_id = $2::uuid
                        WHERE id = $1::uuid AND evidence_object_id IS NULL
                        """,
                        str(cluster_id),
                        cluster_evidence_id,
                    )

                    raw_ids = []
                    for member in ranked_members:
                        rid = raw_lookup.get((member.source_key, member.external_id))
                        if rid:
                            raw_ids.append(str(rid))

                    member_rows = []
                    if raw_ids:
                        member_rows = await conn.fetch(
                            """
                            SELECT id::text, evidence_object_id::text AS evidence_id
                            FROM news_items_raw
                            WHERE id = ANY($1::uuid[])
                              AND evidence_object_id IS NOT NULL
                            """,
                            raw_ids,
                        )
                    raw_to_evidence = {r["id"]: r["evidence_id"] for r in member_rows if r.get("evidence_id")}

                    members = []
                    for i, member in enumerate(ranked_members):
                        rid = raw_lookup.get((member.source_key, member.external_id))
                        if not rid:
                            continue
                        ev_id = raw_to_evidence.get(str(rid), "")
                        if ev_id:
                            members.append((str(ev_id), i == primary_idx))

                    await replace_members(conn, evidence_id=cluster_evidence_id, members=members)
                except Exception as exc:
                    print(f"[evidence:{region}] cluster evidence persist failed for {cluster.cluster_key}: {exc}")

        return cluster_ids

    async def _load_research_context(
        self,
        conn: "asyncpg.Connection",
        clusters: Sequence[StoryCluster],
        region: str = "global",
    ) -> int:
        """Load research_context from DB and attach to cluster objects.

        Queries by cluster_key so it can run before cluster persistence.
        This picks up research output written by the research worker between
        pipeline runs, so LLM enrichment and daily briefs can use it.
        """
        key_to_cluster: Dict[str, StoryCluster] = {}
        keys: List[str] = []
        for c in clusters:
            if c.cluster_key:
                key_to_cluster[c.cluster_key] = c
                keys.append(c.cluster_key)
        if not keys:
            return 0

        loaded = 0
        try:
            rows = await conn.fetch(
                """
                SELECT cluster_key, research_context
                FROM news_clusters
                WHERE cluster_key = ANY($1::text[])
                  AND region = $2
                  AND research_context IS NOT NULL
                """,
                keys,
                region,
            )
            for row in rows:
                ck = row["cluster_key"]
                rc = row["research_context"]
                cluster = key_to_cluster.get(ck)
                if cluster and rc:
                    if isinstance(rc, str):
                        try:
                            cluster.research_context = json.loads(rc)
                        except (json.JSONDecodeError, TypeError):
                            pass
                    elif isinstance(rc, dict):
                        cluster.research_context = rc
                    if cluster.research_context:
                        loaded = loaded + 1
        except Exception as exc:
            print(f"[topic-research] load research_context failed: {exc}")

        return loaded

    async def _load_investigation_clusters(
        self,
        conn: "asyncpg.Connection",
        region: str = "global",
    ) -> List[StoryCluster]:
        """Load promoted investigation clusters (Signal Watch) from the last 48h.

        Returns up to 5 StoryCluster objects ready to be mixed into the edition.
        """
        max_age_hours = _env_int("INVESTIGATION_MAX_AGE_HOURS", 48)
        max_per_edition = 5

        try:
            rows = await conn.fetch(
                """
                SELECT
                    c.id::text AS cluster_id,
                    c.title, c.summary, c.story_type, c.topic_tags, c.entities,
                    c.rank_score, c.rank_reason, c.trust_score,
                    c.canonical_url, c.published_at,
                    c.builder_takeaway, c.llm_summary,
                    c.research_context
                FROM news_clusters c
                WHERE c.story_type = 'investigation'
                  AND c.published_at > NOW() - make_interval(hours => $1)
                ORDER BY c.rank_score DESC, c.published_at DESC
                LIMIT $2
                """,
                max_age_hours,
                max_per_edition,
            )
        except Exception as exc:
            print(f"[investigation] load investigation clusters failed: {exc}")
            return []

        result: List[StoryCluster] = []
        for row in rows:
            sc = StoryCluster(
                cluster_key=f"investigation:{row['cluster_id']}",
                primary_source_key="investigation_pipeline",
                primary_external_id=row["cluster_id"],
                canonical_url=str(row["canonical_url"] or ""),
                title=str(row["title"] or ""),
                summary=str(row["summary"] or ""),
                published_at=row["published_at"] or datetime.now(timezone.utc),
                topic_tags=list(row["topic_tags"] or []),
                entities=list(row["entities"] or []),
                story_type="investigation",
                rank_score=float(row["rank_score"] or 0.3),
                rank_reason=str(row["rank_reason"] or "investigation_pipeline"),
                trust_score=float(row["trust_score"] or 0.5),
                builder_takeaway=row["builder_takeaway"],
                llm_summary=row["llm_summary"],
                llm_model=None,
                llm_signal_score=None,
                llm_confidence_score=None,
                llm_topic_tags=[],
                llm_story_type="investigation",
                members=[],
            )
            # Attach research_context if available
            rc = row.get("research_context")
            if rc:
                if isinstance(rc, str):
                    try:
                        sc.research_context = json.loads(rc)
                    except (json.JSONDecodeError, TypeError):
                        pass
                elif isinstance(rc, dict):
                    sc.research_context = rc
            result.append(sc)

        return result

    @staticmethod
    def _merge_entity_duplicates(ranked: List[StoryCluster]) -> List[StoryCluster]:
        """Merge clusters that share a primary entity + similar title.

        Instead of silently dropping the lower-ranked duplicate, absorb its
        members/entities/tags into the higher-ranked surviving cluster so no
        source context is lost.

        Checks all entities (not just the first) so that e.g. "Alphabet's
        Waymo launches..." still merges with "Waymo expands...".
        """
        seen_entity_clusters: Dict[str, List[StoryCluster]] = {}
        merged: List[StoryCluster] = []
        absorbed: set = set()

        for c in ranked:
            if id(c) in absorbed:
                continue
            c_ents = [e.lower() for e in c.entities] if c.entities else []
            # Check all entities for a merge candidate
            target = None
            for ent in c_ents:
                if ent in seen_entity_clusters:
                    for prev in seen_entity_clusters[ent]:
                        if title_similarity(c.title, prev.title) >= 0.30:
                            target = prev
                            break
                if target is not None:
                    break

            if target is not None:
                # Merge c into target — target is higher-ranked (appeared first)
                existing_keys = {(m.source_key, m.external_id) for m in target.members}
                new_members = [m for m in c.members if (m.source_key, m.external_id) not in existing_keys]
                target.members = target.members + new_members

                # Union entities (target-first ordering)
                seen_ents = {e.lower() for e in target.entities}
                for e in c.entities:
                    if e.lower() not in seen_ents:
                        target.entities.append(e)
                        seen_ents.add(e.lower())

                # Union topic_tags (target-first ordering)
                seen_tags = set(target.topic_tags)
                for t in c.topic_tags:
                    if t not in seen_tags:
                        target.topic_tags.append(t)
                        seen_tags.add(t)

                # Fill-if-missing LLM fields (target wins)
                if not target.builder_takeaway and c.builder_takeaway:
                    target.builder_takeaway = c.builder_takeaway
                if not target.llm_summary and c.llm_summary:
                    target.llm_summary = c.llm_summary
                if not target.impact and c.impact:
                    target.impact = c.impact
                if target.llm_signal_score is None and c.llm_signal_score is not None:
                    target.llm_signal_score = c.llm_signal_score
                if target.llm_confidence_score is None and c.llm_confidence_score is not None:
                    target.llm_confidence_score = c.llm_confidence_score
                if not target.llm_topic_tags and c.llm_topic_tags:
                    target.llm_topic_tags = c.llm_topic_tags
                if not target.llm_story_type and c.llm_story_type:
                    target.llm_story_type = c.llm_story_type

                # Rank boost for broader source coverage
                target.rank_score = min(1.0, target.rank_score + 0.02)

                absorbed.add(id(c))
                print(
                    f"[edition-merge] merged '{c.title[:60]}' into "
                    f"'{target.title[:60]}' (+{len(new_members)} members)"
                )
                continue

            # Not merged — keep this cluster and register under all its entities
            for ent in c_ents:
                seen_entity_clusters.setdefault(ent, []).append(c)
            merged.append(c)

        return merged

    async def _persist_edition(
        self,
        conn: asyncpg.Connection,
        *,
        edition_date: date,
        region: str,
        clusters: Sequence[StoryCluster],
        cluster_ids: Dict[str, str],
        excluded_cluster_ids: set = frozenset(),
        raw_lookup: Optional[Dict[Tuple[str, str], str]] = None,
    ) -> Dict[str, Any]:
        # Merge community signal boost into rank_score before sorting
        sig_agg = getattr(self, "_signal_aggregator", None)
        if sig_agg and sig_agg.loaded:
            for c in clusters:
                cid = cluster_ids.get(c.cluster_key)
                if cid:
                    sig = sig_agg.cluster_signal_score(cid)
                    if sig > 0:
                        c.rank_score = min(1.0, c.rank_score + sig * 0.08)
        ranked = sorted(clusters, key=lambda c: (c.rank_score, c.trust_score, c.published_at), reverse=True)

        # Merge clusters that share a primary entity + similar title, then take top 50
        merged = self._merge_entity_duplicates(ranked)
        eligible = [
            c for c in merged
            if c.cluster_key in cluster_ids
            and cluster_ids[c.cluster_key] not in excluded_cluster_ids
        ]

        # Enforce per-entity diversity: max 2 stories per primary entity
        MAX_PER_ENTITY = 2
        entity_counts: Dict[str, int] = {}
        diverse: List[StoryCluster] = []
        for c in eligible:
            ent = c.entities[0].lower() if c.entities else None
            if ent:
                count = entity_counts.get(ent, 0)
                if count >= MAX_PER_ENTITY:
                    continue
                entity_counts[ent] = count + 1
            diverse.append(c)

        top = diverse[:50]
        top_ids = [cluster_ids[c.cluster_key] for c in top]

        # Persist merged members back to DB (new members absorbed from duplicates)
        if raw_lookup:
            for c in top:
                cid = cluster_ids.get(c.cluster_key)
                if not cid:
                    continue
                await conn.execute(
                    "UPDATE news_clusters SET source_count = $1 WHERE id = $2::uuid",
                    _count_non_lead_members(c.members),
                    cid,
                )
                for member in c.members:
                    raw_id = raw_lookup.get((member.source_key, member.external_id))
                    if not raw_id:
                        continue
                    await conn.execute(
                        """
                        INSERT INTO news_cluster_items (cluster_id, raw_item_id, is_primary, source_rank)
                        VALUES ($1::uuid, $2::uuid, false, $3)
                        ON CONFLICT DO NOTHING
                        """,
                        cid,
                        str(raw_id),
                        member.source_weight,
                    )

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

        daily_brief = await self._llm_generate_daily_brief(conn=conn, edition_date=edition_date, region=region, clusters=top)
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
            json.dumps(_sanitize_for_pg(stats)),
        )

        await conn.execute(
            "DELETE FROM news_topic_index WHERE edition_date = $1 AND region = $2",
            edition_date,
            region,
        )
        for c in top:
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

                # Resolve schema capabilities early (used by persistence paths).
                self._regional_clusters_supported = await self._supports_regional_clusters(conn)
                self._evidence_objects_supported = await self._supports_evidence_objects(conn)

                if not rebuild_only:
                    collected, collect_errors, sources_attempted, fetch_results = await self._collect_items(conn, lookback_hours)
                    errors.extend(collect_errors)
                    items_fetched = len(collected)
                    items_kept = await self._insert_raw_items(conn, collected)
                    await self._update_source_health(conn, fetch_results)
                    await self._check_source_alerts(conn)

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

                # Funnel diagnostics: turkey cluster composition
                _tr_llm_members = sum(
                    1 for tc in turkey_clusters for m in tc.members
                    if (m.payload or {}).get("turkey_classified_by") == "llm"
                )
                _tr_heur_members = sum(
                    1 for tc in turkey_clusters for m in tc.members
                    if (m.payload or {}).get("turkey_classified_by") == "heuristic"
                )
                _tr_uncl_members = sum(
                    1 for tc in turkey_clusters for m in tc.members
                    if not (m.payload or {}).get("turkey_classified_by")
                )
                print(
                    f"[turkey-funnel] {len(turkey_clusters)} turkey clusters, "
                    f"members: llm={_tr_llm_members} heuristic={_tr_heur_members} unclassified={_tr_uncl_members}"
                )

                # --- Editorial rules: load admin-curated & auto-generated filters ---
                from .editorial_rules import EditorialRuleEngine, generate_rule_suggestions, load_rejected_cluster_ids
                _ed_engine_global = EditorialRuleEngine()
                await _ed_engine_global.load(conn, region="global")
                _ed_engine_turkey = EditorialRuleEngine()
                await _ed_engine_turkey.load(conn, region="turkey")

                # Pre-clustering filter: exclude items matching editorial rules
                editorial_stats: Dict[str, Any] = {}
                if _ed_engine_global.loaded:
                    pre_filter_count = len(items_for_clustering)
                    items_for_clustering = [
                        item for item in items_for_clustering
                        if not _ed_engine_global.should_exclude_item(item)
                    ]
                    excluded = pre_filter_count - len(items_for_clustering)
                    if excluded:
                        editorial_stats["items_excluded_pre_clustering"] = excluded
                        print(f"[editorial] excluded {excluded} items pre-clustering (global rules)")
                    # Re-cluster after filtering
                    if excluded:
                        clusters = self._cluster_items(items_for_clustering)
                        # Rebuild turkey clusters
                        turkey_clusters = []
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

                # --- Signal feedback: load community signals for ranking/gating ---
                from .signal_feedback import SignalAggregator
                _sig_agg_global = SignalAggregator()
                await _sig_agg_global.load(conn, lookback_days=14, region="global")
                await _sig_agg_global.load_editorial_signals(conn, lookback_days=14, region="global")
                self._signal_aggregator = _sig_agg_global
                _sig_agg_turkey = SignalAggregator()
                await _sig_agg_turkey.load(conn, lookback_days=14, region="turkey")
                await _sig_agg_turkey.load_editorial_signals(conn, lookback_days=14, region="turkey")

                # Apply source credibility adjustments from signals
                signal_stats: Dict[str, Any] = {}
                if self._signal_aggregator.loaded:
                    adjustments = self._signal_aggregator.get_source_adjustments()
                    source_adj_applied: List[Dict[str, Any]] = []
                    for c in clusters:
                        for m in c.members:
                            adj_info = adjustments.get(m.source_key)
                            if adj_info:
                                delta = adj_info["adjustment"]
                                new_weight = max(0.3, min(0.98, m.source_weight + delta))
                                m.source_weight = new_weight
                    for sk, info in adjustments.items():
                        if abs(info["adjustment"]) > 0.001:
                            source_adj_applied.append({"source": sk, **info})
                    if source_adj_applied:
                        signal_stats["source_signal_adjustments"] = source_adj_applied
                        print(f"[signals] applied source adjustments: {len(source_adj_applied)} sources")

                # Apply editorial source downweight rules
                if _ed_engine_global.loaded:
                    ed_src_adjusted = 0
                    for c in clusters:
                        for m in c.members:
                            mult = _ed_engine_global.adjust_source_weight(m.source_key)
                            if mult < 1.0:
                                m.source_weight = max(0.1, m.source_weight * mult)
                                ed_src_adjusted += 1
                    if ed_src_adjusted:
                        editorial_stats["source_weights_adjusted"] = ed_src_adjusted
                        print(f"[editorial] adjusted {ed_src_adjusted} source weights via rules")

                # Pre-load existing cluster_key → cluster_id mappings for signal scoring
                existing_cids_global: Dict[str, str] = {}
                existing_cids_turkey: Dict[str, str] = {}
                try:
                    if self._regional_clusters_supported:
                        _cid_rows = await conn.fetch(
                            "SELECT cluster_key, id::text FROM news_clusters WHERE region = 'global' AND published_at > now() - interval '14 days'"
                        )
                        existing_cids_global = {r["cluster_key"]: r["id"] for r in _cid_rows}
                        _cid_rows_tr = await conn.fetch(
                            "SELECT cluster_key, id::text FROM news_clusters WHERE region = 'turkey' AND published_at > now() - interval '14 days'"
                        )
                        existing_cids_turkey = {r["cluster_key"]: r["id"] for r in _cid_rows_tr}
                    else:
                        _cid_rows = await conn.fetch(
                            "SELECT cluster_key, id::text FROM news_clusters WHERE published_at > now() - interval '14 days'"
                        )
                        existing_cids_global = {r["cluster_key"]: r["id"] for r in _cid_rows}
                        existing_cids_turkey = existing_cids_global
                except Exception as exc:
                    print(f"[signals] failed to pre-load cluster IDs: {exc}")

                # --- Scoring + gating: heuristic filter (no LLM) ---
                gating_stats_global = await self._run_scoring_and_gating(
                    conn, clusters, region="global", cluster_ids=existing_cids_global,
                )
                # Swap signal aggregator for turkey scoring, then restore
                self._signal_aggregator = _sig_agg_turkey
                gating_stats_turkey = await self._run_scoring_and_gating(
                    conn, turkey_clusters, region="turkey", cluster_ids=existing_cids_turkey,
                )
                self._signal_aggregator = _sig_agg_global
                gating_stats = {
                    "global": gating_stats_global,
                    "turkey": gating_stats_turkey,
                }

                # --- Load research context from prior research runs ---
                research_loaded_global = await self._load_research_context(conn, clusters, region="global")
                research_loaded_turkey = await self._load_research_context(conn, turkey_clusters, region="turkey")
                if research_loaded_global or research_loaded_turkey:
                    print(f"[topic-research] loaded research context: global={research_loaded_global} turkey={research_loaded_turkey}")

                # Enrich all clusters with LLM (gated by NEWS_LLM_MAX_CLUSTERS)
                await self._enrich_clusters_with_llm(clusters, region="global")
                images_enriched = await self._enrich_missing_images(conn, clusters)

                # Enrich turkey clusters with LLM too
                if turkey_clusters:
                    llm_metrics_global = dict(self._llm_metrics)
                    self._signal_aggregator = _sig_agg_turkey
                    await self._enrich_clusters_with_llm(turkey_clusters, region="turkey")
                    images_enriched_tr = await self._enrich_missing_images(conn, turkey_clusters)
                    images_enriched += images_enriched_tr
                    self._signal_aggregator = _sig_agg_global
                    # Merge LLM metrics from both regions
                    llm_metrics_turkey = dict(self._llm_metrics)
                    merged_intel_reasons: Dict[str, int] = {}
                    for source_map in [
                        llm_metrics_global.get("intel_rejection_reasons") or {},
                        llm_metrics_turkey.get("intel_rejection_reasons") or {},
                    ]:
                        if not isinstance(source_map, dict):
                            continue
                        for reason, count in source_map.items():
                            key = str(reason)
                            merged_intel_reasons[key] = merged_intel_reasons.get(key, 0) + int(count or 0)
                    self._llm_metrics = {
                        "enabled": llm_metrics_global.get("enabled", False),
                        "model": llm_metrics_global.get("model", ""),
                        "max_clusters": int(llm_metrics_global.get("max_clusters", 0)),
                        "concurrency": int(llm_metrics_global.get("concurrency", 0)),
                        "attempted": int(llm_metrics_global.get("attempted", 0)) + int(llm_metrics_turkey.get("attempted", 0)),
                        "succeeded": int(llm_metrics_global.get("succeeded", 0)) + int(llm_metrics_turkey.get("succeeded", 0)),
                        "failed": int(llm_metrics_global.get("failed", 0)) + int(llm_metrics_turkey.get("failed", 0)),
                        "timeouts": int(llm_metrics_global.get("timeouts", 0)) + int(llm_metrics_turkey.get("timeouts", 0)),
                        "intel_attempted": int(llm_metrics_global.get("intel_attempted", 0)) + int(llm_metrics_turkey.get("intel_attempted", 0)),
                        "intel_accepted": int(llm_metrics_global.get("intel_accepted", 0)) + int(llm_metrics_turkey.get("intel_accepted", 0)),
                        "intel_rejected_validation": int(llm_metrics_global.get("intel_rejected_validation", 0)) + int(llm_metrics_turkey.get("intel_rejected_validation", 0)),
                        "intel_missing_source_proof": int(llm_metrics_global.get("intel_missing_source_proof", 0)) + int(llm_metrics_turkey.get("intel_missing_source_proof", 0)),
                        "intel_rejection_reasons": dict(
                            sorted(merged_intel_reasons.items(), key=lambda kv: (-kv[1], kv[0]))
                        ),
                        "skipped_by_gating": int(llm_metrics_global.get("skipped_by_gating", 0)) + int(llm_metrics_turkey.get("skipped_by_gating", 0)),
                        "skipped_by_signal": int(llm_metrics_global.get("skipped_by_signal", 0)) + int(llm_metrics_turkey.get("skipped_by_signal", 0)),
                        "latency_ms_p50": llm_metrics_global.get("latency_ms_p50", 0.0),
                        "latency_ms_p95": max(llm_metrics_global.get("latency_ms_p95", 0.0), llm_metrics_turkey.get("latency_ms_p95", 0.0)),
                        "latency_ms_avg": llm_metrics_global.get("latency_ms_avg", 0.0),
                    }

                raw_lookup = await self._build_raw_item_lookup(conn)

                # Persist clusters per-region when supported. Otherwise fall back
                # to legacy shared clusters (global-only persistence).
                cluster_ids_global = await self._persist_clusters(conn, clusters, region="global", raw_lookup=raw_lookup)
                if self._regional_clusters_supported:
                    cluster_ids_turkey = await self._persist_clusters(conn, turkey_clusters, region="turkey", raw_lookup=raw_lookup)
                else:
                    cluster_ids_turkey = {}
                    turkey_clusters = []
                    msg = "Turkey pipeline disabled: news_clusters.region column missing (migration 030)"
                    print(f"[CRITICAL] {msg}")
                    errors.append(msg)

                # Persist memory gate results per-region
                mem_facts_global = await self._persist_memory_results(conn, clusters, cluster_ids_global, region="global")
                mem_facts_turkey = await self._persist_memory_results(conn, turkey_clusters, cluster_ids_turkey, region="turkey")
                memory_stats["facts_written"] = mem_facts_global + mem_facts_turkey

                # Persist gating decisions per-region
                gating_persisted_global = await self._persist_gating_decisions(conn, clusters, cluster_ids_global, region="global")
                gating_persisted_turkey = await self._persist_gating_decisions(conn, turkey_clusters, cluster_ids_turkey, region="turkey")
                gating_stats["decisions_persisted"] = gating_persisted_global + gating_persisted_turkey

                # --- Editorial post-gating: force-drop clusters matching editorial rules ---
                # Runs BEFORE events/research/embedding so dropped clusters don't
                # get persisted events, research queue items, or embeddings.
                if _ed_engine_global.loaded:
                    ed_post_excluded = 0
                    for c in clusters:
                        reason = _ed_engine_global.should_exclude_cluster(c)
                        if reason:
                            c.gating_decision = "drop"
                            c.gating_reason = f"editorial: {reason}"
                            ed_post_excluded += 1
                    if ed_post_excluded:
                        editorial_stats["clusters_excluded_post_gating"] = ed_post_excluded
                        print(f"[editorial] force-dropped {ed_post_excluded} clusters via post-gating rules")

                if _ed_engine_turkey.loaded:
                    for c in turkey_clusters:
                        reason = _ed_engine_turkey.should_exclude_cluster(c)
                        if reason:
                            c.gating_decision = "drop"
                            c.gating_reason = f"editorial: {reason}"

                # Persist editorial drops back to news_item_decisions so admin review is accurate
                ed_drops_global = [c for c in clusters if c.gating_decision == "drop" and (c.gating_reason or "").startswith("editorial:")]
                ed_drops_turkey = [c for c in turkey_clusters if c.gating_decision == "drop" and (c.gating_reason or "").startswith("editorial:")]
                for drop_list, cid_map in [(ed_drops_global, cluster_ids_global), (ed_drops_turkey, cluster_ids_turkey)]:
                    for c in drop_list:
                        cid = cid_map.get(c.cluster_key)
                        if cid:
                            await conn.execute(
                                """
                                UPDATE news_item_decisions
                                SET decision = 'drop', decision_reason = $2
                                WHERE cluster_id = $1::uuid
                                """,
                                cid, c.gating_reason or "editorial: rule match",
                            )

                # Build filtered lists excluding editorially-dropped clusters
                non_dropped_global = [
                    c for c in clusters
                    if not (c.gating_decision == "drop" and (c.gating_reason or "").startswith("editorial:"))
                    and _count_non_lead_members(c.members) > 0
                ]
                non_dropped_turkey = [
                    c for c in turkey_clusters
                    if not (c.gating_decision == "drop" and (c.gating_reason or "").startswith("editorial:"))
                    and _count_non_lead_members(c.members) > 0
                ]

                # --- Extract structured events from clusters ---
                events_global = await self._extract_events(conn, non_dropped_global, cluster_ids_global, region="global")
                events_turkey = await self._extract_events(conn, non_dropped_turkey, cluster_ids_turkey, region="turkey")

                # Guardrail: extracted>0 but persisted==0 with DB errors means downstream onboarding/research stalls.
                for rkey, rstats in (("global", events_global), ("turkey", events_turkey)):
                    try:
                        extracted = int((rstats or {}).get("extracted") or 0)
                        persisted = int((rstats or {}).get("persisted") or 0)
                        persist_errors = int((rstats or {}).get("persist_errors") or 0)
                        first_error = str((rstats or {}).get("first_error") or "").strip()
                        if extracted > 0 and persisted == 0 and persist_errors > 0:
                            msg = (
                                f"[events:{rkey}] extracted={extracted} persisted=0 "
                                f"persist_errors={persist_errors} first_error={first_error[:220]}"
                            )
                            errors.append(msg)
                            _send_slack_notification(
                                title="News ingest: event persistence failure",
                                status="failure",
                                body="\n".join(
                                    [
                                        f"*Edition:* `{e_date.isoformat()}`",
                                        f"*Run ID:* `{run_id}`",
                                        f"*Region:* `{rkey}`",
                                        f"*Extracted:* `{extracted}`",
                                        f"*Persisted:* `0`",
                                        f"*Persist errors:* `{persist_errors}`",
                                        f"*First error:* `{first_error[:500]}`",
                                    ]
                                ),
                                context={
                                    "edition_date": e_date.isoformat(),
                                    "run_id": str(run_id),
                                    "region": rkey,
                                    "extracted": extracted,
                                    "persisted": persisted,
                                    "persist_errors": persist_errors,
                                },
                            )
                    except Exception:
                        # Best-effort: don't block the ingest if Slack or stats parsing fails.
                        pass

                event_extraction_total = int(events_global.get("persisted") or 0) + int(events_turkey.get("persisted") or 0)
                if event_extraction_total > 0:
                    print(
                        f"[events] extracted {int(events_global.get('persisted') or 0)} global + "
                        f"{int(events_turkey.get('persisted') or 0)} turkey structured events"
                    )

                graph_edges_upserted = int(events_global.get("graph", {}).get("edges_upserted") or 0) + int(
                    events_turkey.get("graph", {}).get("edges_upserted") or 0
                )
                graph_views_refreshed = False
                if graph_edges_upserted > 0:
                    graph_views_refreshed = await self._refresh_capital_graph_views(conn)

                # --- Enqueue hot topics for async research ---
                research_enqueued = await self._enqueue_hot_topic_research(
                    conn, non_dropped_global, cluster_ids_global, region="global"
                )
                research_enqueued_tr = await self._enqueue_hot_topic_research(
                    conn, non_dropped_turkey, cluster_ids_turkey, region="turkey"
                )

                # --- Embed clusters (non-blocking) ---
                embed_stats = await self._embed_clusters(conn, non_dropped_global, cluster_ids_global)
                related_count = await self._populate_related_clusters(conn, cluster_ids_global)

                # Load admin-rejected cluster IDs to exclude from editions
                rejected_global = await load_rejected_cluster_ids(conn, "global")
                rejected_turkey = await load_rejected_cluster_ids(conn, "turkey")
                if rejected_global or rejected_turkey:
                    editorial_stats["rejected_cluster_ids"] = len(rejected_global | rejected_turkey)
                    print(f"[editorial] excluding {len(rejected_global)} global + {len(rejected_turkey)} turkey rejected clusters from editions")

                # Turkey edition: only exclude admin-rejected clusters (via editorial rules),
                # not heuristic gating drops. The gating scorer is uncalibrated and drops
                # ~80% of TR clusters, starving the edition. Global already passes all
                # clusters through — match that behaviour for Turkey.
                turkey_clusters_for_edition = [
                    c for c in turkey_clusters
                    if not (c.gating_decision == "drop" and (c.gating_reason or "").startswith("editorial:"))
                    and _count_non_lead_members(c.members) > 0
                ]
                if len(turkey_clusters_for_edition) < 5:
                    print(
                        f"[turkey-funnel] WARNING: only {len(turkey_clusters_for_edition)} turkey clusters "
                        f"for edition (from {len(turkey_clusters)} total) — thin edition"
                    )

                global_clusters_for_edition = [
                    c for c in clusters
                    if not (c.gating_decision == "drop" and (c.gating_reason or "").startswith("editorial:"))
                    and _count_non_lead_members(c.members) > 0
                ]

                # --- Load promoted investigation clusters (Signal Watch) ---
                investigation_count = 0
                if _env_bool("INVESTIGATION_PIPELINE_ENABLED", False):
                    try:
                        inv_clusters = await self._load_investigation_clusters(conn, "global")
                        for ic in inv_clusters:
                            ic.rank_score = max(0.01, ic.rank_score * 0.6)
                        global_clusters_for_edition.extend(inv_clusters)
                        investigation_count = len(inv_clusters)
                        if inv_clusters:
                            print(f"[investigation] added {len(inv_clusters)} Signal Watch clusters to global edition")
                    except Exception as exc:
                        print(f"[investigation] load investigation clusters failed (non-fatal): {exc}")

                global_stats = await self._persist_edition(
                    conn,
                    edition_date=e_date,
                    region="global",
                    clusters=global_clusters_for_edition,
                    cluster_ids=cluster_ids_global,
                    excluded_cluster_ids=rejected_global,
                    raw_lookup=raw_lookup,
                )
                self._signal_aggregator = _sig_agg_turkey
                if turkey_clusters_for_edition:
                    turkey_stats = await self._persist_edition(
                        conn,
                        edition_date=e_date,
                        region="turkey",
                        clusters=turkey_clusters_for_edition,
                        cluster_ids=cluster_ids_turkey,
                        excluded_cluster_ids=rejected_turkey,
                        raw_lookup=raw_lookup,
                    )
                else:
                    turkey_stats = {"total_clusters": 0, "skipped": True}
                    print("[turkey-funnel] 0 clusters for edition — preserving previous edition")
                self._signal_aggregator = _sig_agg_global

                # --- Generate editorial rule suggestions from accumulated rejections ---
                try:
                    await generate_rule_suggestions(conn, region="global")
                    await generate_rule_suggestions(conn, region="turkey")
                except Exception as exc:
                    print(f"[editorial] rule generation failed (non-fatal): {exc}")

                stats = {
                    **global_stats,
                    "regions": {
                        "global_total_clusters": int(global_stats.get("total_clusters") or 0),
                        "turkey_total_clusters": int(turkey_stats.get("total_clusters") or 0),
                    },
                    "llm": dict(self._llm_metrics),
                    "memory": memory_stats,
                    "gating": gating_stats,
                    "signals": signal_stats,
                    "editorial": editorial_stats,
                    "embedding": embed_stats,
                    "related_clusters_populated": related_count,
                    "events": {
                        "global": events_global,
                        "turkey": events_turkey,
                        "persisted_total": event_extraction_total,
                        "graph_edges_upserted_total": graph_edges_upserted,
                        "graph_views_refreshed": graph_views_refreshed,
                    },
                    "research_enqueued": research_enqueued + research_enqueued_tr,
                    "investigation_clusters": investigation_count,
                }

                # --- Turkey pipeline diagnostic summary ---
                _tr_src_keys = {s.source_key for s in DEFAULT_SOURCES if (s.region or "global") == "turkey"}
                _tr_fetched = [fr for fr in fetch_results if fr.source_key in _tr_src_keys] if not rebuild_only else []
                _tr_src_ok = sum(1 for fr in _tr_fetched if fr.success)
                _tr_src_fail = sum(1 for fr in _tr_fetched if not fr.success)
                _tr_items_collected = sum(fr.items_count for fr in _tr_fetched)
                _tr_ed_clusters = len(turkey_clusters_for_edition)
                _tr_ed_top = int(turkey_stats.get("top_story_count") or 0) if isinstance(turkey_stats, dict) else 0
                _tr_has_brief = bool(turkey_stats.get("daily_brief")) if isinstance(turkey_stats, dict) else False
                _tr_failed_details = ", ".join(
                    f"{fr.source_key}({fr.error[:60]})" for fr in _tr_fetched if not fr.success
                ) or "none"
                print(
                    f"\n[turkey-summary] sources: {_tr_src_ok} ok / {_tr_src_fail} failed (of {len(_tr_src_keys)} defined)"
                    f"\n[turkey-summary] failed sources: {_tr_failed_details}"
                    f"\n[turkey-summary] items collected: {_tr_items_collected}"
                    f"\n[turkey-summary] clusters: {len(turkey_clusters)} built → "
                    f"{len(non_dropped_turkey)} after editorial → {_tr_ed_clusters} for edition"
                    f"\n[turkey-summary] edition: {_tr_ed_top} top clusters, brief={_tr_has_brief}, "
                    f"regional_supported={self._regional_clusters_supported}"
                )

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
                    json.dumps(_sanitize_for_pg(errors)),
                    json.dumps(_sanitize_for_pg(stats)),
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
                    json.dumps(_sanitize_for_pg(errors)),
                    json.dumps(_sanitize_for_pg({"edition_date": e_date.isoformat(), "llm": dict(self._llm_metrics)})),
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


async def run_seed_theinformation_headlines(
    *,
    section_url: str = "https://www.theinformation.com/technology",
    max_items: int = 40,
    dry_run: bool = False,
    publisher_key: str = "theinformation",
) -> Dict[str, Any]:
    """Scrape The Information technology section and store headline-only seed URLs."""
    if asyncpg is None:
        raise RuntimeError("asyncpg is required for paid headline seeding. Install dependencies.")

    section = normalize_text(section_url)
    if not section:
        raise ValueError("section_url is required")

    limit = max(1, min(200, int(max_items)))
    ua = "Mozilla/5.0 (compatible; BuildAtlasHeadlineSeed/1.0; +https://buildatlas.net)"
    timeout = httpx.Timeout(30.0)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers={"User-Agent": ua}) as client:
        resp = await client.get(section)
    if resp.status_code >= 400:
        raise RuntimeError(f"failed to fetch section page (status={resp.status_code})")

    items = parse_theinformation_technology_headlines(resp.text or "", section, max_items=limit)
    if not items:
        return {
            "status": "ok",
            "section_url": section,
            "fetched": 0,
            "inserted": 0,
            "skipped": 0,
            "dry_run": bool(dry_run),
        }

    if dry_run:
        return {
            "status": "ok",
            "section_url": section,
            "fetched": len(items),
            "inserted": 0,
            "skipped": len(items),
            "dry_run": True,
        }

    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set for seeding paid headlines")

    inserted = 0
    skipped = 0
    errors: List[str] = []

    conn = await asyncpg.connect(database_url)
    try:
        for item in items:
            canonical = normalize_text(item.get("canonical_url") or "")
            raw_url = normalize_text(item.get("url") or "")
            if not canonical or not raw_url:
                skipped += 1
                continue

            title = normalize_text(item.get("title") or "")
            summary = ""
            published_at = item.get("published_at")

            try:
                row = await conn.fetchrow(
                    """
                    INSERT INTO paid_headline_seeds (
                        publisher_key,
                        url,
                        canonical_url,
                        title,
                        summary,
                        published_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (publisher_key, canonical_url) DO NOTHING
                    RETURNING id
                    """,
                    publisher_key,
                    raw_url,
                    canonical,
                    title or None,
                    summary or None,
                    published_at,
                )
                if row:
                    inserted += 1
                else:
                    skipped += 1
            except Exception as exc:  # pragma: no cover - best-effort best-effort insertion.
                errors.append(str(exc)[:240])
                skipped += 1
    finally:
        await conn.close()

    return {
        "status": "ok",
        "section_url": section,
        "fetched": len(items),
        "inserted": inserted,
        "skipped": skipped,
        "errors": errors,
        "dry_run": False,
    }


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
