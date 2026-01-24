"""Enhanced data enrichment sources for high-quality newsletter content."""

import asyncio
import re
from typing import List, Dict, Any, Optional
from urllib.parse import quote_plus
from datetime import datetime, timezone

import httpx


class JobPostingClient:
    """Extracts real tech stack from job postings - the source of truth."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)

    async def search_jobs(self, company_name: str) -> Dict[str, Any]:
        """Search for company job postings to extract real tech stack."""
        try:
            # Search for jobs mentioning the company
            query = f'"{company_name}" engineer site:lever.co OR site:greenhouse.io OR site:jobs.ashbyhq.com'
            url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
            headers = {"User-Agent": "Mozilla/5.0 (compatible; StartupAnalyzer/1.0)"}

            response = await self.client.get(url, headers=headers, follow_redirects=True)

            if response.status_code != 200:
                return {"jobs_found": 0, "tech_stack": [], "signals": []}

            html = response.text

            # Extract job URLs
            job_urls = []
            patterns = [
                r'(https://jobs\.lever\.co/[^"\s]+)',
                r'(https://boards\.greenhouse\.io/[^"\s]+)',
                r'(https://jobs\.ashbyhq\.com/[^"\s]+)',
            ]
            for pattern in patterns:
                job_urls.extend(re.findall(pattern, html)[:3])

            # Tech stack keywords to detect
            tech_keywords = {
                "llm_models": ["gpt-4", "gpt-3", "claude", "llama", "mistral", "palm", "gemini", "anthropic"],
                "vector_dbs": ["pinecone", "weaviate", "chroma", "qdrant", "milvus", "pgvector", "elasticsearch"],
                "frameworks": ["langchain", "llamaindex", "semantic kernel", "haystack", "dspy"],
                "cloud": ["aws", "gcp", "azure", "vercel", "railway"],
                "languages": ["python", "typescript", "rust", "go", "scala"],
                "infra": ["kubernetes", "docker", "terraform", "pulumi"],
            }

            detected_tech = {k: set() for k in tech_keywords}
            job_titles = []
            salary_signals = []

            # Analyze job content
            for job_url in job_urls[:5]:
                try:
                    job_response = await self.client.get(job_url, headers=headers, follow_redirects=True)
                    if job_response.status_code == 200:
                        job_html = job_response.text.lower()

                        # Extract tech mentions
                        for category, keywords in tech_keywords.items():
                            for kw in keywords:
                                if kw in job_html:
                                    detected_tech[category].add(kw)

                        # Extract job title
                        title_match = re.search(r'<title>([^<]+)</title>', job_response.text)
                        if title_match:
                            job_titles.append(title_match.group(1)[:100])

                        # Look for salary signals
                        salary_match = re.search(r'\$[\d,]+k?\s*-\s*\$[\d,]+k?', job_html)
                        if salary_match:
                            salary_signals.append(salary_match.group())

                    await asyncio.sleep(0.5)
                except Exception:
                    continue

            # Convert sets to lists
            tech_stack = {k: list(v) for k, v in detected_tech.items() if v}

            return {
                "jobs_found": len(job_urls),
                "job_titles": job_titles,
                "tech_stack_from_jobs": tech_stack,
                "salary_signals": salary_signals,
                "job_urls": job_urls[:3],
            }

        except Exception as e:
            print(f"Job posting search error: {e}")
            return {"jobs_found": 0, "tech_stack_from_jobs": {}, "signals": []}

    async def close(self):
        await self.client.aclose()


class HackerNewsClient:
    """Analyzes HackerNews sentiment and discussions about a company."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0, base_url="https://hn.algolia.com/api/v1")

    async def search_mentions(self, company_name: str, limit: int = 10) -> Dict[str, Any]:
        """Search HackerNews for company mentions and sentiment."""
        try:
            # Search stories and comments
            response = await self.client.get(
                "/search",
                params={
                    "query": company_name,
                    "tags": "(story,comment)",
                    "hitsPerPage": limit,
                }
            )

            if response.status_code != 200:
                return {"mentions": 0, "sentiment": "unknown", "top_comments": []}

            data = response.json()
            hits = data.get("hits", [])

            if not hits:
                return {"mentions": 0, "sentiment": "unknown", "top_comments": []}

            # Analyze sentiment keywords
            positive_words = ["great", "awesome", "love", "best", "excellent", "impressive", "amazing"]
            negative_words = ["bad", "terrible", "hate", "worst", "disappointing", "scam", "overrated", "hype"]
            skeptical_words = ["but", "however", "concern", "worried", "question", "doubt"]

            total_positive = 0
            total_negative = 0
            total_skeptical = 0

            top_comments = []
            story_urls = []

            for hit in hits:
                text = (hit.get("comment_text") or hit.get("story_text") or hit.get("title") or "").lower()

                # Count sentiment
                total_positive += sum(1 for w in positive_words if w in text)
                total_negative += sum(1 for w in negative_words if w in text)
                total_skeptical += sum(1 for w in skeptical_words if w in text)

                # Collect interesting comments
                if hit.get("comment_text") and len(hit["comment_text"]) > 50:
                    top_comments.append({
                        "text": hit["comment_text"][:500],
                        "points": hit.get("points", 0),
                        "url": f"https://news.ycombinator.com/item?id={hit.get('objectID', '')}",
                    })

                # Collect story URLs
                if hit.get("url"):
                    story_urls.append(hit["url"])

            # Determine overall sentiment
            if total_positive > total_negative * 2:
                sentiment = "positive"
            elif total_negative > total_positive * 2:
                sentiment = "negative"
            elif total_skeptical > total_positive:
                sentiment = "skeptical"
            else:
                sentiment = "mixed"

            # Sort comments by points (handle None values)
            top_comments.sort(key=lambda x: x.get("points") or 0, reverse=True)

            return {
                "mentions": len(hits),
                "sentiment": sentiment,
                "sentiment_scores": {
                    "positive": total_positive,
                    "negative": total_negative,
                    "skeptical": total_skeptical,
                },
                "top_comments": top_comments[:5],
                "story_urls": story_urls[:3],
                "hn_search_url": f"https://hn.algolia.com/?q={quote_plus(company_name)}",
            }

        except Exception as e:
            print(f"HackerNews search error: {e}")
            return {"mentions": 0, "sentiment": "unknown", "top_comments": []}

    async def close(self):
        await self.client.aclose()


class TwitterClient:
    """Fetches recent Twitter/X activity (via web search, no API needed)."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)

    async def search_tweets(self, company_name: str) -> Dict[str, Any]:
        """Search for recent tweets about/from the company."""
        try:
            # Search for company Twitter presence
            query = f'"{company_name}" site:twitter.com OR site:x.com'
            url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
            headers = {"User-Agent": "Mozilla/5.0 (compatible; StartupAnalyzer/1.0)"}

            response = await self.client.get(url, headers=headers, follow_redirects=True)

            if response.status_code != 200:
                return {"tweets_found": 0, "twitter_handle": None}

            html = response.text

            # Try to find Twitter handle
            handle_match = re.search(r'twitter\.com/([a-zA-Z0-9_]+)|x\.com/([a-zA-Z0-9_]+)', html)
            twitter_handle = None
            if handle_match:
                twitter_handle = handle_match.group(1) or handle_match.group(2)

            # Extract tweet URLs
            tweet_urls = re.findall(r'(https://(?:twitter|x)\.com/[^/]+/status/\d+)', html)

            return {
                "twitter_handle": twitter_handle,
                "tweet_urls": list(set(tweet_urls))[:5],
                "profile_url": f"https://twitter.com/{twitter_handle}" if twitter_handle else None,
            }

        except Exception as e:
            print(f"Twitter search error: {e}")
            return {"tweets_found": 0, "twitter_handle": None}

    async def close(self):
        await self.client.aclose()


class PackageRegistryClient:
    """Checks npm/PyPI for actual package usage - proof of developer adoption."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)

    async def search_packages(self, company_name: str) -> Dict[str, Any]:
        """Search for company packages on npm and PyPI."""
        results = {
            "npm_packages": [],
            "pypi_packages": [],
            "total_downloads": 0,
        }

        company_slug = company_name.lower().replace(" ", "-").replace(".", "")

        # Search npm
        try:
            npm_response = await self.client.get(
                f"https://registry.npmjs.org/-/v1/search",
                params={"text": company_slug, "size": 5}
            )
            if npm_response.status_code == 200:
                npm_data = npm_response.json()
                for pkg in npm_data.get("objects", []):
                    pkg_info = pkg.get("package", {})
                    results["npm_packages"].append({
                        "name": pkg_info.get("name"),
                        "description": pkg_info.get("description", "")[:200],
                        "version": pkg_info.get("version"),
                        "url": f"https://www.npmjs.com/package/{pkg_info.get('name')}",
                    })
        except Exception:
            pass

        # Search PyPI
        try:
            pypi_response = await self.client.get(
                f"https://pypi.org/search/",
                params={"q": company_slug},
                headers={"Accept": "application/json"}
            )
            # PyPI search doesn't have a great JSON API, so we do basic detection
            if pypi_response.status_code == 200:
                # Try direct package lookup
                direct_response = await self.client.get(f"https://pypi.org/pypi/{company_slug}/json")
                if direct_response.status_code == 200:
                    pkg_data = direct_response.json()
                    info = pkg_data.get("info", {})
                    results["pypi_packages"].append({
                        "name": info.get("name"),
                        "description": info.get("summary", "")[:200],
                        "version": info.get("version"),
                        "url": f"https://pypi.org/project/{info.get('name')}",
                        "downloads": "check pypistats.org",
                    })
        except Exception:
            pass

        return results

    async def close(self):
        await self.client.aclose()


class ConferenceTalkClient:
    """Finds conference talks and technical presentations."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)

    async def search_talks(self, company_name: str) -> Dict[str, Any]:
        """Search for conference talks featuring the company."""
        try:
            # Search for conference talks
            conferences = ["YC Demo Day", "TechCrunch Disrupt", "AI Conference", "NeurIPS", "ICML", "DevDay"]
            query = f'"{company_name}" ({" OR ".join(conferences)}) site:youtube.com'

            url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
            headers = {"User-Agent": "Mozilla/5.0 (compatible; StartupAnalyzer/1.0)"}

            response = await self.client.get(url, headers=headers, follow_redirects=True)

            if response.status_code != 200:
                return {"talks_found": 0, "talk_urls": []}

            # Extract YouTube URLs
            youtube_pattern = r'(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_-]+)'
            talk_urls = list(set(re.findall(youtube_pattern, response.text)))[:5]

            return {
                "talks_found": len(talk_urls),
                "talk_urls": talk_urls,
            }

        except Exception as e:
            print(f"Conference talk search error: {e}")
            return {"talks_found": 0, "talk_urls": []}

    async def close(self):
        await self.client.aclose()
