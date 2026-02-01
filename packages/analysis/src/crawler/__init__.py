"""Web crawling engine with hybrid fetch strategy.

This module provides:
- StartupCrawler: Main class for crawling startup websites
- HybridFetcher: HTTP-first fetch with browser fallback
- DomainThrottler: Per-domain rate limiting
- URL canonicalization: Deduplication and normalization
"""

from .engine import StartupCrawler, crawl_startup_batch
from .logo_extractor import LogoExtractor
from .url_normalizer import (
    canonicalize_url,
    extract_domain,
    get_base_domain,
    is_same_site,
    normalize_url_for_crawl,
)
from .domain_throttler import DomainThrottler, ThrottledCrawlContext
from .fetch_strategy import (
    HybridFetcher,
    FetchResult,
    fetch_url,
    fetch_with_http,
    detect_js_shell,
    extract_text_content,
    compute_content_hash,
)

__all__ = [
    # Main crawler
    "StartupCrawler",
    "crawl_startup_batch",
    "LogoExtractor",
    # URL normalization
    "canonicalize_url",
    "extract_domain",
    "get_base_domain",
    "is_same_site",
    "normalize_url_for_crawl",
    # Throttling
    "DomainThrottler",
    "ThrottledCrawlContext",
    # Fetch strategy
    "HybridFetcher",
    "FetchResult",
    "fetch_url",
    "fetch_with_http",
    "detect_js_shell",
    "extract_text_content",
    "compute_content_hash",
]
