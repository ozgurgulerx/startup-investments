"""Hybrid Fetch Strategy for Crawler.

Implements HTTP-first fetch strategy with browser fallback:
1. Try simple HTTP fetch first (fast, cheap)
2. Detect if page requires JavaScript rendering
3. Fall back to browser rendering only when needed
4. Cache domain capabilities to avoid repeated checks
"""

import asyncio
import hashlib
import logging
import random
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, List

import httpx
from bs4 import BeautifulSoup
from src.config import settings
from src.crawl_runtime.extraction import extract_main_content

logger = logging.getLogger(__name__)


# Markers indicating a page is a JavaScript shell needing browser rendering
JS_SHELL_MARKERS = [
    'enable javascript',
    'javascript is required',
    'please enable javascript',
    'this site requires javascript',
    'you need to enable javascript',
    'browser does not support javascript',
    'noscript',
]

# Markers for JS frameworks that might work without full rendering
JS_FRAMEWORK_MARKERS = [
    '__NEXT_DATA__',           # Next.js (often works without JS)
    '__NUXT__',                # Nuxt.js
    'window.__INITIAL_STATE__',  # Redux/SSR state
    'window.__APP_STATE__',
    '__APOLLO_STATE__',        # Apollo GraphQL
]

# Minimum content thresholds
MIN_CONTENT_LENGTH = 500       # Characters of text content
MIN_MEANINGFUL_ELEMENTS = 3    # Minimum meaningful HTML elements
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
]


@dataclass
class FetchResult:
    """Result of a fetch operation."""
    success: bool
    url: str
    html: str = ""
    text: str = ""
    title: Optional[str] = None
    content_hash: Optional[str] = None
    method: str = "http"           # 'http' or 'browser'
    status_code: int = 0
    response_time_ms: int = 0
    error: Optional[str] = None
    content_length: int = 0
    is_js_heavy: bool = False


def detect_js_shell(html: str) -> bool:
    """Detect if HTML is a JavaScript shell requiring browser rendering.

    A JS shell is a minimal HTML page that loads JavaScript to render content.
    Common patterns:
    - Very little text content
    - Heavy script content
    - Explicit "enable JavaScript" messages

    Args:
        html: Raw HTML content

    Returns:
        True if page appears to be a JS shell
    """
    if not html:
        return True  # Empty response likely needs JS

    html_lower = html.lower()

    # Check for explicit JS requirement messages
    for marker in JS_SHELL_MARKERS:
        if marker in html_lower:
            return True

    try:
        soup = BeautifulSoup(html, 'html.parser')

        # Get body or full document
        body = soup.find('body') or soup

        # Remove script and style elements for text extraction
        for element in body.find_all(['script', 'style', 'noscript']):
            element.decompose()

        # Get text content
        text = body.get_text(separator=' ', strip=True)
        text_length = len(text)

        # If we have substantial text, probably not a JS shell
        if text_length >= MIN_CONTENT_LENGTH:
            # Check for framework markers that indicate SSR
            for marker in JS_FRAMEWORK_MARKERS:
                if marker in html:
                    # Has SSR data, content likely works
                    return False
            return False

        # Check script vs content ratio
        scripts = soup.find_all('script')
        script_content = sum(len(s.get_text()) for s in scripts)

        # If scripts dominate, likely JS app
        if script_content > 0 and text_length < 200:
            if script_content > text_length * 2:
                return True

        # Check for meaningful content elements
        meaningful_tags = ['p', 'article', 'section', 'main', 'h1', 'h2', 'h3']
        meaningful_count = sum(len(body.find_all(tag)) for tag in meaningful_tags)

        if meaningful_count < MIN_MEANINGFUL_ELEMENTS:
            return True

        # Check for main content container
        main_content = (
            soup.find('main') or
            soup.find('article') or
            soup.find(id=re.compile(r'content|main|app|root', re.I)) or
            soup.find(class_=re.compile(r'content|main', re.I))
        )

        if main_content:
            main_text = main_content.get_text(strip=True)
            if len(main_text) >= 200:
                return False

        return text_length < MIN_CONTENT_LENGTH

    except Exception as e:
        logger.warning(f"Error detecting JS shell: {e}")
        return False


def extract_text_content(html: str) -> str:
    """Extract normalized text content from HTML.

    Removes scripts, styles, and normalizes whitespace.

    Args:
        html: Raw HTML content

    Returns:
        Cleaned text content
    """
    if not html:
        return ""

    try:
        text, _ = extract_main_content(html)
        return text
    except Exception:
        return ""


def compute_content_hash(text: str) -> str:
    """Compute a stable hash of text content.

    Used for change detection. Removes dynamic elements before hashing.

    Args:
        text: Text content to hash

    Returns:
        32-character hex hash
    """
    if not text:
        return ""

    # Normalize for stable hashing
    normalized = text.lower()

    # Remove common dynamic patterns
    # Timestamps
    normalized = re.sub(r'\d{4}-\d{2}-\d{2}', '', normalized)
    normalized = re.sub(r'\d{2}:\d{2}(:\d{2})?', '', normalized)
    # UUIDs
    normalized = re.sub(
        r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
        '',
        normalized
    )
    # Large numbers (often counters)
    normalized = re.sub(r'\b\d{6,}\b', '', normalized)

    # Normalize whitespace
    normalized = ' '.join(normalized.split())

    return hashlib.sha256(normalized.encode()).hexdigest()[:32]


def extract_title(html: str) -> Optional[str]:
    """Extract page title from HTML.

    Args:
        html: Raw HTML content

    Returns:
        Page title or None
    """
    if not html:
        return None

    try:
        soup = BeautifulSoup(html, 'html.parser')

        # Try <title> tag
        title_tag = soup.find('title')
        if title_tag and title_tag.string:
            return title_tag.string.strip()

        # Try og:title
        og_title = soup.find('meta', property='og:title')
        if og_title and og_title.get('content'):
            return og_title['content'].strip()

        # Try <h1>
        h1 = soup.find('h1')
        if h1:
            return h1.get_text(strip=True)[:200]

        return None

    except Exception:
        return None


async def fetch_with_http(
    url: str,
    timeout: float = 15.0,
    user_agent: str = "Mozilla/5.0 (compatible; BuildAtlasCrawler/1.0)",
    proxy_url: str = "",
) -> FetchResult:
    """Fetch a URL using simple HTTP.

    Args:
        url: URL to fetch
        timeout: Request timeout in seconds
        user_agent: User-Agent header

    Returns:
        FetchResult with content or error
    """
    start_time = datetime.now(timezone.utc)

    try:
        client_kwargs = {"timeout": timeout}
        if proxy_url:
            client_kwargs["proxy"] = proxy_url

        async with httpx.AsyncClient(**client_kwargs) as client:
            response = await client.get(
                url,
                headers={
                    "User-Agent": user_agent,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                },
                follow_redirects=True
            )

            elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)

            html = response.text
            text = extract_text_content(html)
            is_js_shell = detect_js_shell(html)

            return FetchResult(
                success=response.status_code == 200,
                url=str(response.url),  # May differ due to redirects
                html=html,
                text=text,
                title=extract_title(html),
                content_hash=compute_content_hash(text),
                method='http',
                status_code=response.status_code,
                response_time_ms=elapsed_ms,
                content_length=len(html),
                is_js_heavy=is_js_shell
            )

    except httpx.TimeoutException:
        elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        return FetchResult(
            success=False,
            url=url,
            method='http',
            status_code=0,
            response_time_ms=elapsed_ms,
            error="Timeout"
        )

    except Exception as e:
        elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        return FetchResult(
            success=False,
            url=url,
            method='http',
            response_time_ms=elapsed_ms,
            error=str(e)
        )


class HybridFetcher:
    """HTTP-first fetcher with browser fallback.

    Strategy:
    1. Check if domain is known to require JS (from cache)
    2. If not known, try HTTP first
    3. If HTTP returns JS shell, mark domain and use browser
    4. Cache domain capability for future requests

    Usage:
        fetcher = HybridFetcher(throttler)
        result = await fetcher.fetch(url)
    """

    def __init__(
        self,
        domain_throttler=None,
        browser_pool=None,
        http_timeout: float = 15.0,
        browser_timeout: float = 30.0,
        user_agent: str = "Mozilla/5.0 (compatible; BuildAtlasCrawler/1.0)",
        datacenter_proxy_url: str = "",
        residential_proxy_url: str = "",
    ):
        """Initialize the hybrid fetcher.

        Args:
            domain_throttler: Optional DomainThrottler for rate limiting and JS cache
            browser_pool: Optional browser pool for JS rendering
            http_timeout: HTTP request timeout
            browser_timeout: Browser render timeout
            user_agent: User-Agent header
        """
        self.throttler = domain_throttler
        self.browser_pool = browser_pool
        self.http_timeout = http_timeout
        self.browser_timeout = browser_timeout
        self.user_agent = user_agent
        self.datacenter_proxy_url = datacenter_proxy_url or settings.crawler.datacenter_proxy_url
        self.residential_proxy_url = residential_proxy_url or settings.crawler.residential_proxy_url

        # Local cache for domains without DB throttler
        self._js_domains: set = set()

    async def fetch(
        self,
        url: str,
        force_browser: bool = False,
        force_http: bool = False
    ) -> FetchResult:
        """Fetch a URL with appropriate method.

        Args:
            url: URL to fetch
            force_browser: Always use browser rendering
            force_http: Always use HTTP (skip JS detection)

        Returns:
            FetchResult with content
        """
        from .url_normalizer import extract_domain
        domain = extract_domain(url)
        acquired_slot = False

        try:
            if self.throttler:
                # Enforce per-domain politeness even when using HTTP-first strategy.
                total_wait_ms = 0
                while total_wait_ms <= 15000:
                    can_crawl, wait_ms = await self.throttler.can_crawl(url)
                    if can_crawl:
                        acquired_slot = True
                        break
                    sleep_ms = max(wait_ms, 250)
                    await asyncio.sleep(sleep_ms / 1000)
                    total_wait_ms += sleep_ms

                if not acquired_slot:
                    return FetchResult(
                        success=False,
                        url=url,
                        method="http",
                        error="Throttled: max wait exceeded",
                    )

            # Check if domain requires JS
            requires_js = force_browser
            if not force_browser and not force_http:
                requires_js = await self._domain_requires_js(domain)

            if requires_js:
                result = await self._fetch_with_browser(url)
            else:
                # Try HTTP first
                result = await fetch_with_http(
                    url,
                    timeout=self.http_timeout,
                    user_agent=random.choice(USER_AGENTS),
                    proxy_url=self.datacenter_proxy_url,
                )

                # If HTTP succeeded but content is JS shell, retry with browser
                if result.success and result.is_js_heavy and not force_http:
                    logger.info(f"JS shell detected for {domain}, using browser")
                    await self._mark_domain_requires_js(domain)
                    browser_result = await self._fetch_with_browser(url)
                    if browser_result.success:
                        result = browser_result

            return result
        finally:
            if self.throttler and acquired_slot:
                try:
                    await self.throttler.release(
                        url,
                        success=(result.success if "result" in locals() else False),
                        status_code=(result.status_code if "result" in locals() else 0),
                        response_time_ms=(result.response_time_ms if "result" in locals() else None),
                    )
                except Exception:
                    pass

    async def _domain_requires_js(self, domain: str) -> bool:
        """Check if domain is known to require JS."""
        # Check local cache first
        if domain in self._js_domains:
            return True

        # Check DB cache via throttler
        if self.throttler:
            return await self.throttler.get_domain_requires_js(domain)

        return False

    async def _mark_domain_requires_js(self, domain: str):
        """Mark domain as requiring JS rendering."""
        self._js_domains.add(domain)

        if self.throttler:
            await self.throttler.mark_domain_requires_js(domain, True)

    async def _fetch_with_browser(self, url: str) -> FetchResult:
        """Fetch URL using browser rendering.

        Uses a dedicated browser session when pool is unavailable.
        """
        start_time = datetime.now(timezone.utc)

        try:
            # Use crawl4ai browser pool
            from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

            browser_config = BrowserConfig(headless=True, verbose=False)
            run_config = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                page_timeout=int(self.browser_timeout * 1000)
            )

            async with AsyncWebCrawler(config=browser_config) as crawler:
                result = await crawler.arun(url=url, config=run_config)

                elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)

                html = result.html if hasattr(result, 'html') else ""
                markdown = result.markdown if hasattr(result, 'markdown') else ""
                text = extract_text_content(html) if html else markdown

                return FetchResult(
                    success=bool(markdown or html),
                    url=url,
                    html=html,
                    text=text,
                    title=extract_title(html) or getattr(result, 'title', None),
                    content_hash=compute_content_hash(text),
                    method='browser',
                    status_code=200 if (markdown or html) else 0,
                    response_time_ms=elapsed_ms,
                    content_length=len(html or markdown or ""),
                    is_js_heavy=True
                )

        except Exception as e:
            elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
            logger.error(f"Browser fetch failed for {url}: {e}")

            return FetchResult(
                success=False,
                url=url,
                method='browser',
                response_time_ms=elapsed_ms,
                error=str(e)
            )


async def fetch_url(
    url: str,
    throttler=None,
    force_browser: bool = False,
    timeout: float = 15.0
) -> FetchResult:
    """Convenience function for single URL fetch.

    Args:
        url: URL to fetch
        throttler: Optional DomainThrottler
        force_browser: Always use browser
        timeout: Request timeout

    Returns:
        FetchResult with content
    """
    fetcher = HybridFetcher(
        domain_throttler=throttler,
        http_timeout=timeout,
    )
    return await fetcher.fetch(url, force_browser=force_browser)
