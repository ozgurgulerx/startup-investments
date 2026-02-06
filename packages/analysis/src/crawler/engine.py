"""Web crawler engine using crawl4ai with multi-source data enrichment.

This module provides:
- StartupCrawler: Main class for crawling startup websites
- Multi-source enrichment: GitHub, web search, news, YouTube
- Hybrid fetch strategy: HTTP-first with browser fallback
- Per-domain throttling for polite crawling
- URL canonicalization for deduplication
"""

import asyncio
import hashlib
import json
import logging
import re
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from urllib.parse import urlparse, quote_plus

import httpx
try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
except Exception:
    AsyncWebCrawler = None
    BrowserConfig = None
    CrawlerRunConfig = None
    CacheMode = None

from src.config import settings
from src.data.models import CrawledSource, StartupInput
from src.crawler.logo_extractor import LogoExtractor
from src.crawler.url_normalizer import canonicalize_url, extract_domain
from src.crawler.fetch_strategy import HybridFetcher, FetchResult

logger = logging.getLogger(__name__)

try:
    from src.crawl_runtime.scrapy_runtime import ScrapyPlaywrightRuntime
except Exception:
    ScrapyPlaywrightRuntime = None


def get_company_slug(name: str) -> str:
    """Convert company name to filesystem-safe slug."""
    return name.lower().replace(" ", "-").replace(".", "").replace(",", "").replace("&", "and")


class WebSearchClient:
    """Fetches web search results for enrichment data."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)

    async def search(self, query: str, num_results: int = 5) -> List[Dict[str, Any]]:
        """Search using DuckDuckGo HTML (no API key needed)."""
        try:
            url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
            headers = {"User-Agent": "Mozilla/5.0 (compatible; StartupAnalyzer/1.0)"}
            response = await self.client.get(url, headers=headers, follow_redirects=True)

            if response.status_code != 200:
                return []

            results = []
            html = response.text

            # Parse search results from HTML
            result_pattern = r'<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([^<]+)</a>'
            snippet_pattern = r'<a class="result__snippet"[^>]*>([^<]+)</a>'

            links = re.findall(result_pattern, html)
            snippets = re.findall(snippet_pattern, html)

            for i, (link, title) in enumerate(links[:num_results]):
                snippet = snippets[i] if i < len(snippets) else ""
                results.append({
                    "url": link,
                    "title": title.strip(),
                    "snippet": snippet.strip(),
                })

            return results
        except Exception as e:
            print(f"Web search error: {e}")
            return []

    async def close(self):
        await self.client.aclose()


class GitHubClient:
    """Fetches GitHub organization and repository data."""

    def __init__(self, token: Optional[str] = None):
        self.token = token or settings.crawler.github_token
        headers = {"Accept": "application/vnd.github.v3+json"}
        if self.token:
            headers["Authorization"] = f"token {self.token}"
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers=headers,
            base_url="https://api.github.com"
        )

    async def find_org(self, company_name: str, website: Optional[str] = None) -> Optional[str]:
        """Try to find GitHub org from company name or website."""
        # Try extracting from website URL first
        if website:
            domain = urlparse(website).netloc.replace("www.", "")
            company_slug = domain.split(".")[0]

            # Check if org exists
            try:
                response = await self.client.get(f"/orgs/{company_slug}")
                if response.status_code == 200:
                    return company_slug
            except Exception:
                pass

        # Try variations of company name
        slugs_to_try = [
            company_name.lower().replace(" ", ""),
            company_name.lower().replace(" ", "-"),
            company_name.lower().replace(" ", "_"),
            get_company_slug(company_name),
        ]

        for slug in slugs_to_try:
            try:
                response = await self.client.get(f"/orgs/{slug}")
                if response.status_code == 200:
                    return slug

                # Also try as user
                response = await self.client.get(f"/users/{slug}")
                if response.status_code == 200:
                    data = response.json()
                    if data.get("type") == "Organization":
                        return slug
            except Exception:
                continue

        return None

    async def get_org_repos(self, org: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get public repositories for an organization."""
        try:
            response = await self.client.get(
                f"/orgs/{org}/repos",
                params={"sort": "updated", "per_page": limit, "type": "public"}
            )
            if response.status_code == 200:
                return response.json()
        except Exception:
            pass

        # Try as user if org fails
        try:
            response = await self.client.get(
                f"/users/{org}/repos",
                params={"sort": "updated", "per_page": limit, "type": "public"}
            )
            if response.status_code == 200:
                return response.json()
        except Exception:
            pass

        return []

    async def get_readme(self, owner: str, repo: str) -> Optional[str]:
        """Get README content for a repository."""
        try:
            response = await self.client.get(
                f"/repos/{owner}/{repo}/readme",
                headers={"Accept": "application/vnd.github.raw"}
            )
            if response.status_code == 200:
                return response.text[:15000]  # Limit size
        except Exception:
            pass
        return None

    async def get_org_info(self, org: str) -> Optional[Dict[str, Any]]:
        """Get organization profile information."""
        try:
            response = await self.client.get(f"/orgs/{org}")
            if response.status_code == 200:
                return response.json()
        except Exception:
            pass
        return None

    async def close(self):
        await self.client.aclose()


class YouTubeClient:
    """Fetches YouTube video transcripts for founder/engineering content."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)

    async def search_videos(self, company_name: str, limit: int = 3) -> List[Dict[str, Any]]:
        """Search for company videos on YouTube using web search."""
        try:
            # Search for founder talks, product demos, technical deep-dives
            queries = [
                f'"{company_name}" founder interview site:youtube.com',
                f'"{company_name}" demo product site:youtube.com',
                f'"{company_name}" engineering architecture site:youtube.com',
            ]

            video_urls = []
            for query in queries:
                url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
                headers = {"User-Agent": "Mozilla/5.0 (compatible; StartupAnalyzer/1.0)"}

                response = await self.client.get(url, headers=headers, follow_redirects=True)
                if response.status_code == 200:
                    # Extract YouTube URLs
                    youtube_pattern = r'(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_-]+)'
                    matches = re.findall(youtube_pattern, response.text)
                    video_urls.extend(matches[:2])

                await asyncio.sleep(1)

            # Deduplicate
            seen = set()
            unique_videos = []
            for url in video_urls:
                if url not in seen and len(unique_videos) < limit:
                    seen.add(url)
                    unique_videos.append({"url": url})

            return unique_videos
        except Exception as e:
            print(f"YouTube search error: {e}")
            return []

    async def get_transcript(self, video_url: str) -> Optional[str]:
        """Attempt to get video transcript using youtube-transcript-api pattern."""
        try:
            # Extract video ID
            video_id_match = re.search(r'v=([a-zA-Z0-9_-]+)', video_url)
            if not video_id_match:
                return None

            video_id = video_id_match.group(1)

            # Try to fetch transcript via a public transcript service
            # This uses an unofficial method - in production, use youtube-transcript-api library
            transcript_url = f"https://www.youtube.com/watch?v={video_id}"

            # For now, we'll just note the video URL - actual transcript extraction
            # requires the youtube-transcript-api library which needs to be installed
            return f"[Video found: {video_url} - Install youtube-transcript-api for full transcripts]"

        except Exception as e:
            print(f"Transcript fetch error: {e}")
            return None

    async def close(self):
        await self.client.aclose()


class NewsClient:
    """Fetches recent news about startups."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)

    async def search_news(self, company_name: str, days_back: int = 90) -> List[Dict[str, Any]]:
        """Search for recent news using DuckDuckGo News."""
        try:
            # Search for news articles
            query = f'"{company_name}" startup OR funding OR launch'
            url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}&iar=news"
            headers = {"User-Agent": "Mozilla/5.0 (compatible; StartupAnalyzer/1.0)"}

            response = await self.client.get(url, headers=headers, follow_redirects=True)

            if response.status_code != 200:
                return []

            results = []
            html = response.text

            # Parse news results
            result_pattern = r'<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([^<]+)</a>'
            links = re.findall(result_pattern, html)

            for link, title in links[:5]:
                if company_name.lower() in title.lower():
                    results.append({
                        "url": link,
                        "title": title.strip(),
                        "source": "news_search",
                    })

            return results
        except Exception as e:
            print(f"News search error: {e}")
            return []

    async def close(self):
        await self.client.aclose()


class StartupCrawler:
    """Crawls startup websites, blogs, and documentation with multi-source enrichment.

    Features:
    - Hybrid fetch strategy: HTTP-first with browser fallback for JS-heavy sites
    - URL canonicalization: Deduplicates URLs, removes tracking params
    - Per-domain throttling: Optional polite crawling with rate limits
    - Multi-source enrichment: GitHub, web search, news, YouTube

    Usage:
        crawler = StartupCrawler()
        sources = await crawler.crawl_startup(startup)
        await crawler.close()

    With throttling:
        from src.crawler.domain_throttler import DomainThrottler
        throttler = DomainThrottler(pool, default_delay_ms=2000)
        crawler = StartupCrawler(throttler=throttler)
    """

    def __init__(self, throttler=None, use_hybrid_fetch: bool = True):
        """Initialize the startup crawler.

        Args:
            throttler: Optional DomainThrottler for per-domain rate limiting
            use_hybrid_fetch: If True, use HTTP-first strategy with browser fallback.
                             If False, always use browser rendering.
        """
        self.throttler = throttler
        self.use_hybrid_fetch = use_hybrid_fetch
        self.runtime = (settings.crawler.runtime or "legacy").lower().strip()
        self.modern_runtime = None

        self.browser_config = None
        if BrowserConfig is not None:
            self.browser_config = BrowserConfig(
                headless=settings.crawler.headless,
                verbose=False,
            )
        self.cache_dir = Path(settings.crawler.cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.raw_content_dir = settings.data_output_dir / "raw_content"
        self.raw_content_dir.mkdir(parents=True, exist_ok=True)

        # Initialize hybrid fetcher
        self.hybrid_fetcher = HybridFetcher(
            domain_throttler=throttler,
            http_timeout=settings.crawler.timeout_ms / 1000,
            browser_timeout=settings.crawler.timeout_ms / 1000 * 2,
            datacenter_proxy_url=settings.crawler.datacenter_proxy_url,
            residential_proxy_url=settings.crawler.residential_proxy_url,
        ) if use_hybrid_fetch else None

        # Initialize enrichment clients
        self.web_search_client = WebSearchClient() if settings.crawler.enable_web_search else None
        self.github_client = GitHubClient() if settings.crawler.enable_github else None
        self.news_client = NewsClient() if settings.crawler.enable_news else None
        self.youtube_client = YouTubeClient() if settings.crawler.enable_web_search else None  # Use web_search setting
        self.logo_extractor = LogoExtractor()

        if self.runtime == "scrapy" and ScrapyPlaywrightRuntime is not None:
            self.modern_runtime = ScrapyPlaywrightRuntime()
        elif self.runtime == "scrapy":
            logger.warning("CRAWLER_RUNTIME=scrapy requested, but Scrapy runtime is unavailable. Falling back to legacy runtime.")
            self.runtime = "legacy"

    async def crawl_startup(self, startup: StartupInput) -> List[CrawledSource]:
        """Crawl all available URLs for a startup with multi-source enrichment."""
        crawled_sources = []

        # Phase 1: Crawl main website pages
        urls_to_crawl = self._discover_urls(startup)
        if self.runtime == "scrapy" and self.modern_runtime is not None and urls_to_crawl:
            modern_results = await self.modern_runtime.crawl_startup(
                startup=startup,
                seed_urls=[u["url"] for u in urls_to_crawl],
            )

            for result in modern_results:
                source = CrawledSource(
                    url=result.get("url", startup.website or ""),
                    source_type=result.get("source_type", "website"),
                    crawled_at=datetime.now(timezone.utc),
                    success=result.get("success", False),
                    content_length=len(result.get("content", "")),
                    title=result.get("title"),
                    error=result.get("error"),
                )
                crawled_sources.append(source)
                if result.get("success") and result.get("url"):
                    self._cache_result(startup.name, result["url"], result)

        elif urls_to_crawl:
            if AsyncWebCrawler is None or self.browser_config is None:
                raise RuntimeError("Legacy crawler runtime requires crawl4ai. Install crawl4ai or use CRAWLER_RUNTIME=scrapy.")
            async with AsyncWebCrawler(config=self.browser_config) as crawler:
                for url_info in urls_to_crawl:
                    url = url_info["url"]
                    source_type = url_info["type"]

                    # Check cache first
                    cached = self._get_cached(startup.name, url)
                    if cached:
                        crawled_sources.append(cached)
                        continue

                    try:
                        result = await self._crawl_single(crawler, url)

                        source = CrawledSource(
                            url=url,
                            source_type=source_type,
                            crawled_at=datetime.now(timezone.utc),
                            success=result.get("success", False),
                            content_length=len(result.get("content", "")),
                            title=result.get("title"),
                        )

                        if result.get("success"):
                            self._cache_result(startup.name, url, result)

                        crawled_sources.append(source)
                        await asyncio.sleep(settings.crawler.rate_limit_delay)

                    except Exception as e:
                        crawled_sources.append(CrawledSource(
                            url=url,
                            source_type=source_type,
                            success=False,
                            error=str(e),
                        ))

        # Phase 2: Enrich with web search results
        if self.web_search_client:
            search_sources = await self._crawl_web_search(startup)
            crawled_sources.extend(search_sources)

        # Phase 3: Enrich with GitHub data
        if self.github_client:
            github_sources = await self._crawl_github(startup)
            crawled_sources.extend(github_sources)

        # Phase 4: Enrich with news articles
        if self.news_client:
            news_sources = await self._crawl_news(startup)
            crawled_sources.extend(news_sources)

        # Phase 5: Enrich with YouTube videos (founder talks, demos)
        if self.youtube_client:
            youtube_sources = await self._crawl_youtube(startup)
            crawled_sources.extend(youtube_sources)

        # Phase 6: Extract and save company logo
        logo_source = await self._extract_logo(startup)
        if logo_source:
            crawled_sources.append(logo_source)

        return crawled_sources

    async def _crawl_web_search(self, startup: StartupInput) -> List[CrawledSource]:
        """Enrich data with web search results."""
        sources = []
        cache_key = f"{startup.name}_websearch"
        cached = self._get_cached(startup.name, cache_key)
        if cached:
            return [cached]

        try:
            # Search for technical/product information
            queries = [
                f'"{startup.name}" technology stack architecture',
                f'"{startup.name}" AI machine learning',
                f'"{startup.name}" product features',
            ]

            all_results = []
            for query in queries:
                results = await self.web_search_client.search(
                    query,
                    num_results=settings.crawler.web_search_results
                )
                all_results.extend(results)
                await asyncio.sleep(1)  # Rate limit

            if all_results:
                # Compile search results into content
                content_parts = ["# Web Search Results\n"]
                seen_urls = set()

                for result in all_results:
                    if result["url"] not in seen_urls:
                        seen_urls.add(result["url"])
                        content_parts.append(f"\n## {result['title']}")
                        content_parts.append(f"**URL:** {result['url']}")
                        if result.get("snippet"):
                            content_parts.append(f"\n{result['snippet']}")

                content = "\n".join(content_parts)

                source = CrawledSource(
                    url=f"websearch://{startup.name}",
                    source_type="web_search",
                    crawled_at=datetime.now(timezone.utc),
                    success=True,
                    content_length=len(content),
                    title=f"Web Search Results for {startup.name}",
                )

                self._cache_result(startup.name, cache_key, {
                    "success": True,
                    "content": content,
                    "title": source.title,
                    "url": source.url,
                })

                sources.append(source)

        except Exception as e:
            print(f"Web search error for {startup.name}: {e}")

        return sources

    async def _crawl_github(self, startup: StartupInput) -> List[CrawledSource]:
        """Enrich data with GitHub repository information."""
        sources = []
        cache_key = f"{startup.name}_github"
        cached = self._get_cached(startup.name, cache_key)
        if cached:
            return [cached]

        try:
            # Find GitHub organization
            org = await self.github_client.find_org(startup.name, startup.website)

            if not org:
                return sources

            # Get organization info
            org_info = await self.github_client.get_org_info(org)

            # Get repositories
            repos = await self.github_client.get_org_repos(org, limit=5)

            if not repos and not org_info:
                return sources

            content_parts = [f"# GitHub Profile: {org}\n"]

            if org_info:
                content_parts.append(f"**Description:** {org_info.get('description', 'N/A')}")
                content_parts.append(f"**Public Repos:** {org_info.get('public_repos', 0)}")
                content_parts.append(f"**Followers:** {org_info.get('followers', 0)}")
                if org_info.get("blog"):
                    content_parts.append(f"**Blog:** {org_info['blog']}")
                content_parts.append("")

            for repo in repos[:5]:
                content_parts.append(f"\n## Repository: {repo['name']}")
                content_parts.append(f"**Description:** {repo.get('description', 'N/A')}")
                content_parts.append(f"**Language:** {repo.get('language', 'N/A')}")
                content_parts.append(f"**Stars:** {repo.get('stargazers_count', 0)}")
                content_parts.append(f"**Forks:** {repo.get('forks_count', 0)}")

                # Get README
                readme = await self.github_client.get_readme(org, repo["name"])
                if readme:
                    content_parts.append(f"\n### README\n{readme[:5000]}")

            content = "\n".join(content_parts)

            source = CrawledSource(
                url=f"https://github.com/{org}",
                source_type="github",
                crawled_at=datetime.now(timezone.utc),
                success=True,
                content_length=len(content),
                title=f"GitHub Profile: {org}",
            )

            self._cache_result(startup.name, cache_key, {
                "success": True,
                "content": content,
                "title": source.title,
                "url": source.url,
            })

            sources.append(source)

        except Exception as e:
            print(f"GitHub crawl error for {startup.name}: {e}")

        return sources

    async def _crawl_news(self, startup: StartupInput) -> List[CrawledSource]:
        """Enrich data with recent news articles."""
        sources = []
        cache_key = f"{startup.name}_news"
        cached = self._get_cached(startup.name, cache_key)
        if cached:
            return [cached]

        try:
            news_results = await self.news_client.search_news(
                startup.name,
                days_back=settings.crawler.news_days_back
            )

            if not news_results:
                return sources

            content_parts = [f"# Recent News: {startup.name}\n"]

            for article in news_results:
                content_parts.append(f"\n## {article['title']}")
                content_parts.append(f"**URL:** {article['url']}")

            content = "\n".join(content_parts)

            source = CrawledSource(
                url=f"news://{startup.name}",
                source_type="news",
                crawled_at=datetime.now(timezone.utc),
                success=True,
                content_length=len(content),
                title=f"News Articles about {startup.name}",
            )

            self._cache_result(startup.name, cache_key, {
                "success": True,
                "content": content,
                "title": source.title,
                "url": source.url,
            })

            sources.append(source)

        except Exception as e:
            print(f"News crawl error for {startup.name}: {e}")

        return sources

    async def _crawl_youtube(self, startup: StartupInput) -> List[CrawledSource]:
        """Enrich data with YouTube video information (founder talks, demos)."""
        sources = []
        cache_key = f"{startup.name}_youtube"
        cached = self._get_cached(startup.name, cache_key)
        if cached:
            return [cached]

        try:
            videos = await self.youtube_client.search_videos(startup.name, limit=3)

            if not videos:
                return sources

            content_parts = [f"# YouTube Videos: {startup.name}\n"]
            content_parts.append("*Founder interviews, product demos, and technical talks*\n")

            for video in videos:
                content_parts.append(f"\n## Video")
                content_parts.append(f"**URL:** {video['url']}")

                # Try to get transcript
                transcript = await self.youtube_client.get_transcript(video['url'])
                if transcript:
                    content_parts.append(f"\n**Transcript/Note:** {transcript[:5000]}")

            content = "\n".join(content_parts)

            source = CrawledSource(
                url=f"youtube://{startup.name}",
                source_type="youtube",
                crawled_at=datetime.now(timezone.utc),
                success=True,
                content_length=len(content),
                title=f"YouTube Videos about {startup.name}",
            )

            self._cache_result(startup.name, cache_key, {
                "success": True,
                "content": content,
                "title": source.title,
                "url": source.url,
            })

            sources.append(source)

        except Exception as e:
            print(f"YouTube crawl error for {startup.name}: {e}")

        return sources

    async def _extract_logo(self, startup: StartupInput) -> Optional[CrawledSource]:
        """Extract and save company logo."""
        try:
            # Get cached HTML content from main website if available
            html_content = None
            if startup.website:
                html_content = self.get_cached_content(startup.name, startup.website)

            # Extract and save logo
            logo_path = await self.logo_extractor.extract_and_save(
                company_name=startup.name,
                website=startup.website,
                html_content=html_content
            )

            if logo_path:
                return CrawledSource(
                    url=f"logo://{startup.name}",
                    source_type="logo",
                    crawled_at=datetime.now(timezone.utc),
                    success=True,
                    content_length=0,
                    title=f"Logo: {logo_path}",
                )

        except Exception as e:
            print(f"Logo extraction error for {startup.name}: {e}")

        return None

    async def _crawl_single(self, crawler: AsyncWebCrawler, url: str) -> Dict[str, Any]:
        """Crawl a single URL using hybrid fetch strategy.

        Uses HTTP-first approach when hybrid_fetcher is available:
        1. Try simple HTTP fetch (fast, cheap)
        2. Detect if page requires JavaScript rendering
        3. Fall back to browser rendering only when needed

        Args:
            crawler: AsyncWebCrawler instance (used as fallback)
            url: URL to crawl

        Returns:
            Dict with success, content, title, url, and optional metadata
        """
        # Canonicalize URL before crawling
        canonical_url = canonicalize_url(url)

        # Try hybrid fetch strategy first
        if self.hybrid_fetcher:
            try:
                result: FetchResult = await self.hybrid_fetcher.fetch(url)

                if result.success:
                    content = result.text or result.html
                    return {
                        "success": True,
                        "content": content[:settings.analysis.max_content_length] if content else "",
                        "title": result.title,
                        "url": url,
                        "canonical_url": canonical_url,
                        "content_hash": result.content_hash,
                        "fetch_method": result.method,
                        "response_time_ms": result.response_time_ms,
                    }
            except Exception as e:
                logger.warning(f"Hybrid fetch failed for {url}, falling back to browser: {e}")

        # Fall back to browser-based crawling
        run_config = CrawlerRunConfig(
            cache_mode=CacheMode.BYPASS,
            page_timeout=settings.crawler.timeout_ms,
        )

        try:
            result = await crawler.arun(url=url, config=run_config)

            return {
                "success": True,
                "content": result.markdown[:settings.analysis.max_content_length] if result.markdown else "",
                "title": getattr(result, "title", None),
                "url": url,
                "canonical_url": canonical_url,
                "fetch_method": "browser",
            }
        except Exception as e:
            return {
                "success": False,
                "content": "",
                "error": str(e),
                "url": url,
                "canonical_url": canonical_url,
            }

    def _discover_urls(self, startup: StartupInput) -> List[Dict[str, str]]:
        """Discover URLs to crawl for a startup.

        Uses URL canonicalization to deduplicate URLs that point to the same content.

        Args:
            startup: StartupInput with website URL

        Returns:
            List of dicts with 'url', 'type', and 'canonical_url' keys
        """
        urls = []
        seen_canonical = set()  # Track canonical URLs to avoid duplicates

        if not startup.website:
            return urls

        # Canonicalize base URL
        base_url = canonicalize_url(startup.website)
        if not base_url:
            return urls

        def add_url(url: str, source_type: str):
            """Add URL if not already seen (based on canonical form)."""
            canonical = canonicalize_url(url)
            if canonical and canonical not in seen_canonical:
                seen_canonical.add(canonical)
                urls.append({
                    "url": url,
                    "type": source_type,
                    "canonical_url": canonical
                })

        # Main website
        add_url(base_url, "website")

        # Common pages - expanded list
        common_paths = [
            ("/about", "website"),
            ("/about-us", "website"),
            ("/company", "website"),
            ("/team", "website"),
            ("/product", "website"),
            ("/products", "website"),
            ("/platform", "website"),
            ("/technology", "website"),
            ("/tech", "website"),
            ("/how-it-works", "website"),
            ("/features", "website"),
            ("/solutions", "website"),
            ("/use-cases", "website"),
            ("/customers", "website"),
            ("/case-studies", "website"),
            ("/pricing", "website"),
            ("/security", "website"),
            ("/careers", "website"),  # Good for understanding team size/growth
        ]

        for path, source_type in common_paths:
            add_url(f"{base_url}{path}", source_type)

        # Blog paths - expanded
        blog_paths = [
            "/blog", "/engineering", "/eng-blog", "/tech-blog",
            "/insights", "/resources", "/news", "/press",
            "/announcements", "/updates"
        ]
        for path in blog_paths:
            add_url(f"{base_url}{path}", "blog")

        # Documentation paths - expanded
        doc_paths = [
            "/docs", "/documentation", "/developers", "/api",
            "/api-docs", "/developer", "/dev", "/guides",
            "/tutorials", "/reference", "/sdk"
        ]
        for path in doc_paths:
            add_url(f"{base_url}{path}", "docs")

        # Try common subdomains
        domain = extract_domain(base_url)
        if domain and not domain.startswith("www."):
            subdomains = ["docs", "developer", "developers", "api", "blog"]
            for sub in subdomains:
                subdomain_url = f"https://{sub}.{domain}"
                source_type = "docs" if sub in ["docs", "api", "developer", "developers"] else "blog"
                add_url(subdomain_url, source_type)

        return urls

    def _get_cache_path(self, company_name: str, url: str) -> Path:
        """Get cache file path for a URL."""
        slug = company_name.lower().replace(" ", "-")
        url_hash = hashlib.md5(url.encode("utf-8")).hexdigest()[:10]
        return self.cache_dir / f"{slug}_{url_hash}.json"

    def _get_cached(self, company_name: str, url: str) -> Optional[CrawledSource]:
        """Get cached crawl result if available."""
        cache_path = self._get_cache_path(company_name, url)
        if cache_path.exists():
            try:
                with open(cache_path) as f:
                    data = json.load(f)
                    return CrawledSource(**data["source"])
            except Exception:
                pass
        return None

    def _cache_result(self, company_name: str, url: str, result: Dict[str, Any]):
        """Cache a crawl result."""
        cache_path = self._get_cache_path(company_name, url)
        try:
            cache_data = {
                "url": url,
                "result": result,
                "source": {
                    "url": url,
                    "source_type": "cached",
                    "crawled_at": datetime.now(timezone.utc).isoformat(),
                    "success": result.get("success", False),
                    "content_length": len(result.get("content", "")),
                    "title": result.get("title"),
                },
            }
            with open(cache_path, "w") as f:
                json.dump(cache_data, f)
        except Exception:
            pass

    def get_cached_content(self, company_name: str, url: str) -> Optional[str]:
        """Get cached content for a URL."""
        cache_path = self._get_cache_path(company_name, url)
        if cache_path.exists():
            try:
                with open(cache_path) as f:
                    data = json.load(f)
                    return data.get("result", {}).get("content", "")
            except Exception:
                pass
        return None

    def get_all_cached_content(self, company_name: str) -> str:
        """Get all cached content for a company."""
        slug = company_name.lower().replace(" ", "-")
        all_content = []

        for cache_file in self.cache_dir.glob(f"{slug}_*.json"):
            try:
                with open(cache_file) as f:
                    data = json.load(f)
                    content = data.get("result", {}).get("content", "")
                    if content:
                        all_content.append(content)
            except Exception:
                pass

        return "\n\n---\n\n".join(all_content)

    def save_raw_content(self, company_name: str) -> Path:
        """Save all raw crawled content to a dedicated folder for the startup."""
        slug = get_company_slug(company_name)
        company_dir = self.raw_content_dir / slug
        company_dir.mkdir(parents=True, exist_ok=True)

        # Collect all content from cache
        all_pages = []
        for cache_file in self.cache_dir.glob(f"{slug.replace('-', '-')}*.json"):
            try:
                with open(cache_file) as f:
                    data = json.load(f)
                    url = data.get("url", "unknown")
                    content = data.get("result", {}).get("content", "")
                    title = data.get("result", {}).get("title", "")
                    if content:
                        all_pages.append({
                            "url": url,
                            "title": title,
                            "content": content,
                        })
            except Exception:
                pass

        # Also check with different slug patterns
        alt_slug = company_name.lower().replace(" ", "-")
        for cache_file in self.cache_dir.glob(f"{alt_slug}_*.json"):
            try:
                with open(cache_file) as f:
                    data = json.load(f)
                    url = data.get("url", "unknown")
                    content = data.get("result", {}).get("content", "")
                    title = data.get("result", {}).get("title", "")
                    if content and not any(p["url"] == url for p in all_pages):
                        all_pages.append({
                            "url": url,
                            "title": title,
                            "content": content,
                        })
            except Exception:
                pass

        # Save individual pages
        for i, page in enumerate(all_pages):
            page_file = company_dir / f"page_{i+1}.md"
            with open(page_file, "w") as f:
                f.write(f"# {page['title'] or 'Untitled'}\n")
                f.write(f"**Source:** {page['url']}\n\n")
                f.write("---\n\n")
                f.write(page["content"])

        # Save combined content
        combined_file = company_dir / "all_content.md"
        with open(combined_file, "w") as f:
            f.write(f"# {company_name} - All Crawled Content\n\n")
            f.write(f"**Total Pages:** {len(all_pages)}\n\n")
            for i, page in enumerate(all_pages):
                f.write(f"## Page {i+1}: {page['title'] or 'Untitled'}\n")
                f.write(f"**Source:** {page['url']}\n\n")
                f.write(page["content"])
                f.write("\n\n---\n\n")

        # Categorize sources
        source_types = {
            "website": [],
            "github": [],
            "web_search": [],
            "news": [],
            "blog": [],
            "docs": [],
        }
        for page in all_pages:
            url = page["url"]
            if url.startswith("https://github.com") or "_github" in url:
                source_types["github"].append(url)
            elif url.startswith("websearch://") or "_websearch" in url:
                source_types["web_search"].append(url)
            elif url.startswith("news://") or "_news" in url:
                source_types["news"].append(url)
            elif "/blog" in url or "/engineering" in url:
                source_types["blog"].append(url)
            elif "/docs" in url or "/api" in url or "/developer" in url:
                source_types["docs"].append(url)
            else:
                source_types["website"].append(url)

        # Save metadata
        metadata_file = company_dir / "metadata.json"
        with open(metadata_file, "w") as f:
            json.dump({
                "company_name": company_name,
                "slug": slug,
                "pages_crawled": len(all_pages),
                "urls": [p["url"] for p in all_pages],
                "source_types": {k: len(v) for k, v in source_types.items() if v},
                "sources_by_type": source_types,
                "crawled_at": datetime.now(timezone.utc).isoformat(),
                "enrichment_enabled": {
                    "web_search": settings.crawler.enable_web_search,
                    "github": settings.crawler.enable_github,
                    "news": settings.crawler.enable_news,
                },
            }, f, indent=2)

        return company_dir

    async def close(self):
        """Close all HTTP clients."""
        if self.modern_runtime:
            await self.modern_runtime.close()
        if self.web_search_client:
            await self.web_search_client.close()
        if self.github_client:
            await self.github_client.close()
        if self.news_client:
            await self.news_client.close()
        if self.youtube_client:
            await self.youtube_client.close()
        if self.logo_extractor:
            await self.logo_extractor.close()


async def crawl_startup_batch(
    startups: List[StartupInput],
    max_concurrent: int = 3,
    throttler=None,
    use_hybrid_fetch: bool = True
) -> Dict[str, List[CrawledSource]]:
    """Crawl multiple startups with concurrency control and multi-source enrichment.

    Args:
        startups: List of StartupInput objects to crawl
        max_concurrent: Maximum concurrent crawls (default: 3)
        throttler: Optional DomainThrottler for per-domain rate limiting
        use_hybrid_fetch: If True, use HTTP-first strategy with browser fallback

    Returns:
        Dict mapping startup names to their list of CrawledSource objects
    """
    crawler = StartupCrawler(throttler=throttler, use_hybrid_fetch=use_hybrid_fetch)
    results = {}

    semaphore = asyncio.Semaphore(max_concurrent)

    async def crawl_with_semaphore(startup: StartupInput):
        async with semaphore:
            try:
                sources = await crawler.crawl_startup(startup)
                return startup.name, sources
            except Exception as e:
                logger.error(f"Error crawling {startup.name}: {e}")
                return startup.name, []

    try:
        tasks = [crawl_with_semaphore(s) for s in startups]
        completed = await asyncio.gather(*tasks, return_exceptions=True)

        for result in completed:
            if isinstance(result, tuple):
                name, sources = result
                results[name] = sources
            elif isinstance(result, Exception):
                logger.error(f"Batch crawl exception: {result}")
    finally:
        # Clean up HTTP clients
        await crawler.close()

    return results
