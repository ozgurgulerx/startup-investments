"""Hybrid Fetch Strategy for Crawler.

Implements HTTP-first fetch strategy with a staged fallback ladder:
1. Try simple HTTP fetch first (fast, cheap)
2. Retry via residential proxy on block/challenge or transient failures
3. Escalate to managed unblock provider when configured
4. Fall back to browser rendering only when needed
5. Cache domain capabilities to avoid repeated checks
"""

import asyncio
import hashlib
import logging
import random
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, List, Optional, Sequence, Tuple

import httpx
from bs4 import BeautifulSoup

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
except Exception:
    AsyncWebCrawler = None
    BrowserConfig = None
    CacheMode = None
    CrawlerRunConfig = None

from src.config import settings
from src.crawl_runtime.extraction import extract_main_content
from src.crawl_runtime.unblock_provider import (
    UnblockRequest,
    build_unblock_provider,
    is_probably_blocked,
)

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
    blocked_detected: bool = False
    proxy_tier: str = "none"
    provider: str = "none"


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
    proxy_tier: str = "none",
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
            blocked_detected = is_probably_blocked(int(response.status_code), html)

            return FetchResult(
                success=response.status_code == 200 and not blocked_detected,
                url=str(response.url),  # May differ due to redirects
                html=html,
                text=text,
                title=extract_title(html),
                content_hash=compute_content_hash(text),
                method='http',
                status_code=response.status_code,
                response_time_ms=elapsed_ms,
                content_length=len(html),
                is_js_heavy=is_js_shell,
                blocked_detected=blocked_detected,
                proxy_tier=proxy_tier,
            )

    except httpx.TimeoutException:
        elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        return FetchResult(
            success=False,
            url=url,
            method='http',
            status_code=0,
            response_time_ms=elapsed_ms,
            error="Timeout",
            proxy_tier=proxy_tier,
        )

    except Exception as e:
        elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
        return FetchResult(
            success=False,
            url=url,
            method='http',
            response_time_ms=elapsed_ms,
            error=str(e),
            proxy_tier=proxy_tier,
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
        self.unblock_provider = build_unblock_provider(
            provider_name=settings.crawler.unblock_provider,
            endpoint=settings.crawler.browserless_endpoint,
            token=settings.crawler.browserless_token,
        )

        # Local cache for domains without DB throttler
        self._js_domains: set = set()
        self._browser_crawler = None
        self._browser_init_lock = asyncio.Lock()
        self._browser_run_lock = asyncio.Lock()

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
                result = await self._fetch_with_render_stack(url, prefer_provider=False)
            else:
                result = await self._fetch_with_http_ladder(url)

                if result.success and result.is_js_heavy and not force_http:
                    logger.info("JS shell detected for %s, escalating to render stack", domain)
                    await self._mark_domain_requires_js(domain)
                    rendered = await self._fetch_with_render_stack(url, prefer_provider=False)
                    if rendered.success:
                        result = rendered
                elif (
                    (result.blocked_detected or not result.success)
                    and not force_http
                    and self._provider_mode_enabled()
                ):
                    rendered = await self._fetch_with_render_stack(url, prefer_provider=True)
                    if rendered.success:
                        result = rendered

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

    def _provider_mode_enabled(self) -> bool:
        return settings.crawler.unblock_mode.strip().lower() in {"auto", "provider_only"}

    def _http_proxy_sequence(self) -> Sequence[Tuple[str, str]]:
        attempts: List[Tuple[str, str]] = []
        datacenter_url = (self.datacenter_proxy_url or "").strip()
        residential_url = (self.residential_proxy_url or "").strip()

        if datacenter_url:
            attempts.append(("datacenter", datacenter_url))
        else:
            attempts.append(("direct", ""))

        if residential_url and residential_url != datacenter_url:
            attempts.append(("residential", residential_url))

        return attempts

    @staticmethod
    def _prefer_result(current: Optional[FetchResult], candidate: FetchResult) -> FetchResult:
        if current is None:
            return candidate
        if candidate.success and not current.success:
            return candidate
        if candidate.success == current.success and candidate.content_length > current.content_length:
            return candidate
        if candidate.blocked_detected and not current.blocked_detected:
            return current
        if current.error and not candidate.error:
            return candidate
        return current

    @staticmethod
    def _should_try_next_http_tier(result: FetchResult) -> bool:
        if result.blocked_detected:
            return True
        if result.status_code in {0, 408, 425, 429, 500, 502, 503, 504}:
            return True
        if result.error and not result.success:
            return True
        return False

    async def _fetch_with_http_ladder(self, url: str) -> FetchResult:
        best_result: Optional[FetchResult] = None
        attempts = list(self._http_proxy_sequence())

        for index, (proxy_tier, proxy_url) in enumerate(attempts):
            result = await fetch_with_http(
                url,
                timeout=self.http_timeout,
                user_agent=random.choice(USER_AGENTS),
                proxy_url=proxy_url,
                proxy_tier=proxy_tier,
            )
            best_result = self._prefer_result(best_result, result)

            if result.success and not result.is_js_heavy and not result.blocked_detected:
                return result

            if index == len(attempts) - 1:
                break
            if not self._should_try_next_http_tier(result):
                break

        return best_result or FetchResult(success=False, url=url, error="HTTP fetch failed")

    async def _fetch_with_provider(self, url: str) -> FetchResult:
        if not self.unblock_provider:
            return FetchResult(success=False, url=url, method="provider", error="Unblock provider not configured")

        start_time = datetime.now(timezone.utc)
        try:
            request = UnblockRequest(
                url=url,
                headers={
                    "User-Agent": random.choice(USER_AGENTS),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                },
                timeout_ms=int(self.browser_timeout * 1000),
            )
            provider_result = await self.unblock_provider.fetch(request)
            elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
            html = provider_result.html or ""
            text = extract_text_content(html)
            blocked_detected = bool(provider_result.blocked_detected)
            return FetchResult(
                success=bool(html.strip()) and not blocked_detected and int(provider_result.status_code or 0) < 400,
                url=provider_result.final_url or url,
                html=html,
                text=text,
                title=extract_title(html),
                content_hash=compute_content_hash(text),
                method=f"provider_{provider_result.provider}",
                status_code=int(provider_result.status_code or 0),
                response_time_ms=elapsed_ms,
                content_length=len(html),
                is_js_heavy=detect_js_shell(html) if html else False,
                blocked_detected=blocked_detected,
                proxy_tier="provider",
                provider=provider_result.provider,
            )
        except Exception as exc:
            elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
            logger.warning("Provider fetch failed for %s: %s", url, exc)
            return FetchResult(
                success=False,
                url=url,
                method="provider",
                response_time_ms=elapsed_ms,
                error=str(exc),
                proxy_tier="provider",
            )

    async def _fetch_with_render_stack(self, url: str, *, prefer_provider: bool) -> FetchResult:
        provider_enabled = self._provider_mode_enabled() and self.unblock_provider is not None
        provider_only = settings.crawler.unblock_mode.strip().lower() == "provider_only"

        if (prefer_provider or provider_only) and provider_enabled:
            provider_result = await self._fetch_with_provider(url)
            if provider_result.success:
                return provider_result
            if provider_only:
                return provider_result

        browser_result = await self._fetch_with_browser(url)
        if browser_result.success:
            return browser_result

        if provider_enabled and not prefer_provider:
            fallback_provider = await self._fetch_with_provider(url)
            if fallback_provider.success:
                return fallback_provider

        return browser_result

    async def _get_browser_crawler(self):
        if self.browser_pool is not None:
            return self.browser_pool
        if AsyncWebCrawler is None or BrowserConfig is None:
            raise RuntimeError("crawl4ai is not installed")

        async with self._browser_init_lock:
            if self._browser_crawler is None:
                browser_config = BrowserConfig(headless=True, verbose=False)
                crawler = AsyncWebCrawler(config=browser_config)
                self._browser_crawler = await crawler.__aenter__()
            return self._browser_crawler

    async def _fetch_with_browser(self, url: str) -> FetchResult:
        """Fetch URL using browser rendering.

        Uses a dedicated browser session when pool is unavailable.
        """
        start_time = datetime.now(timezone.utc)

        try:
            if CrawlerRunConfig is None or CacheMode is None:
                raise RuntimeError("crawl4ai is not installed")

            run_config = CrawlerRunConfig(
                cache_mode=CacheMode.BYPASS,
                page_timeout=int(self.browser_timeout * 1000)
            )

            crawler = await self._get_browser_crawler()
            async with self._browser_run_lock:
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
                is_js_heavy=True,
                proxy_tier="browser",
            )

        except Exception as e:
            elapsed_ms = int((datetime.now(timezone.utc) - start_time).total_seconds() * 1000)
            logger.error(f"Browser fetch failed for {url}: {e}")

            return FetchResult(
                success=False,
                url=url,
                method='browser',
                response_time_ms=elapsed_ms,
                error=str(e),
                proxy_tier="browser",
            )

    async def close(self):
        if self.browser_pool is not None:
            return
        async with self._browser_init_lock:
            if self._browser_crawler is None:
                return
            crawler = self._browser_crawler
            self._browser_crawler = None
            await crawler.__aexit__(None, None, None)


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
    try:
        return await fetcher.fetch(url, force_browser=force_browser)
    finally:
        await fetcher.close()
