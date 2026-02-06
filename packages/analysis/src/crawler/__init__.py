"""Web crawling helpers.

Import heavy crawl engine modules lazily so utility-only imports (for tests and
non-crawl tooling) do not require the full browser crawling dependency chain.
"""

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

try:
    from .engine import StartupCrawler, crawl_startup_batch
except Exception:  # pragma: no cover - optional dependency path
    StartupCrawler = None
    crawl_startup_batch = None

__all__ = [
    "StartupCrawler",
    "crawl_startup_batch",
    "LogoExtractor",
    "canonicalize_url",
    "extract_domain",
    "get_base_domain",
    "is_same_site",
    "normalize_url_for_crawl",
    "DomainThrottler",
    "ThrottledCrawlContext",
    "HybridFetcher",
    "FetchResult",
    "fetch_url",
    "fetch_with_http",
    "detect_js_shell",
    "extract_text_content",
    "compute_content_hash",
]
