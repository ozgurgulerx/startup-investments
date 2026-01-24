"""Web crawler engine using crawl4ai with multi-source data enrichment."""

import asyncio
import json
import re
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from urllib.parse import urlparse, quote_plus

import httpx
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

from src.config import settings
from src.data.models import CrawledSource, StartupInput


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
    """Crawls startup websites, blogs, and documentation with multi-source enrichment."""

    def __init__(self):
        self.browser_config = BrowserConfig(
            headless=settings.crawler.headless,
            verbose=False,
        )
        self.cache_dir = Path(settings.crawler.cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.raw_content_dir = settings.data_output_dir / "raw_content"
        self.raw_content_dir.mkdir(parents=True, exist_ok=True)

        # Initialize enrichment clients
        self.web_search_client = WebSearchClient() if settings.crawler.enable_web_search else None
        self.github_client = GitHubClient() if settings.crawler.enable_github else None
        self.news_client = NewsClient() if settings.crawler.enable_news else None
        self.youtube_client = YouTubeClient() if settings.crawler.enable_web_search else None  # Use web_search setting

    async def crawl_startup(self, startup: StartupInput) -> List[CrawledSource]:
        """Crawl all available URLs for a startup with multi-source enrichment."""
        crawled_sources = []

        # Phase 1: Crawl main website pages
        urls_to_crawl = self._discover_urls(startup)
        if urls_to_crawl:
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

    async def _crawl_single(self, crawler: AsyncWebCrawler, url: str) -> Dict[str, Any]:
        """Crawl a single URL."""
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
            }
        except Exception as e:
            return {
                "success": False,
                "content": "",
                "error": str(e),
                "url": url,
            }

    def _discover_urls(self, startup: StartupInput) -> List[Dict[str, str]]:
        """Discover URLs to crawl for a startup."""
        urls = []

        if not startup.website:
            return urls

        base_url = startup.website.rstrip("/")

        # Main website
        urls.append({"url": base_url, "type": "website"})

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
            urls.append({"url": f"{base_url}{path}", "type": source_type})

        # Blog paths - expanded
        blog_paths = [
            "/blog", "/engineering", "/eng-blog", "/tech-blog",
            "/insights", "/resources", "/news", "/press",
            "/announcements", "/updates"
        ]
        for path in blog_paths:
            urls.append({"url": f"{base_url}{path}", "type": "blog"})

        # Documentation paths - expanded
        doc_paths = [
            "/docs", "/documentation", "/developers", "/api",
            "/api-docs", "/developer", "/dev", "/guides",
            "/tutorials", "/reference", "/sdk"
        ]
        for path in doc_paths:
            urls.append({"url": f"{base_url}{path}", "type": "docs"})

        # Try common subdomains
        domain = urlparse(base_url).netloc
        if not domain.startswith("www."):
            subdomains = ["docs", "developer", "developers", "api", "blog"]
            for sub in subdomains:
                subdomain_url = f"https://{sub}.{domain}"
                urls.append({"url": subdomain_url, "type": "docs" if sub in ["docs", "api", "developer", "developers"] else "blog"})

        return urls

    def _get_cache_path(self, company_name: str, url: str) -> Path:
        """Get cache file path for a URL."""
        slug = company_name.lower().replace(" ", "-")
        url_hash = str(hash(url))[-10:]
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
        if self.web_search_client:
            await self.web_search_client.close()
        if self.github_client:
            await self.github_client.close()
        if self.news_client:
            await self.news_client.close()
        if self.youtube_client:
            await self.youtube_client.close()


async def crawl_startup_batch(startups: List[StartupInput], max_concurrent: int = 3) -> Dict[str, List[CrawledSource]]:
    """Crawl multiple startups with concurrency control and multi-source enrichment."""
    crawler = StartupCrawler()
    results = {}

    semaphore = asyncio.Semaphore(max_concurrent)

    async def crawl_with_semaphore(startup: StartupInput):
        async with semaphore:
            sources = await crawler.crawl_startup(startup)
            return startup.name, sources

    try:
        tasks = [crawl_with_semaphore(s) for s in startups]
        completed = await asyncio.gather(*tasks, return_exceptions=True)

        for result in completed:
            if isinstance(result, tuple):
                name, sources = result
                results[name] = sources
            else:
                # Handle exception
                pass
    finally:
        # Clean up HTTP clients
        await crawler.close()

    return results
