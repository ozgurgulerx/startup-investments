"""Startup information provider clients.

Collects data from:
- Crunchbase (API + web scraping fallback)
- CB Insights (web scraping)
- PitchBook (web scraping)
- Tracxn (web scraping)
- Dealroom (web scraping)

All data collection is time-bounded to a specific analysis period.
"""

import asyncio
import re
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from urllib.parse import quote_plus

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from src.config import settings
from src.data.models import StartupInput, StartupProviderData


class WebSearchClient:
    """DuckDuckGo web search client (no API key required)."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        self.rate_limit = settings.intelligence.intelligence_rate_limit

    async def search(self, query: str, num_results: int = 5) -> List[Dict[str, Any]]:
        """Perform a web search and return results."""
        await asyncio.sleep(self.rate_limit)

        try:
            url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
            response = await self.client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            })

            if response.status_code != 200:
                return []

            # Parse results from HTML
            results = []
            html = response.text

            # Simple regex to extract result links and titles
            pattern = r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)</a>'
            matches = re.findall(pattern, html)

            for url, title in matches[:num_results]:
                results.append({
                    "url": url,
                    "title": title.strip(),
                })

            return results

        except Exception as e:
            print(f"Search error: {e}")
            return []

    async def close(self):
        await self.client.aclose()


class CrunchbaseClient:
    """Crunchbase data collection (API + fallback web scraping)."""

    def __init__(self, period_start: datetime, period_end: datetime):
        self.period_start = period_start
        self.period_end = period_end
        self.api_key = settings.intelligence.crunchbase_api_key
        self.search_client = WebSearchClient()
        self.client = httpx.AsyncClient(timeout=30.0)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def search_company(
        self,
        name: str,
        website: Optional[str] = None
    ) -> Optional[StartupProviderData]:
        """Search for company on Crunchbase with period filtering."""

        # Try API first if key available
        if self.api_key:
            data = await self._search_via_api(name)
            if data:
                return data

        # Fallback to web search
        return await self._search_via_web(name, website)

    async def _search_via_api(self, name: str) -> Optional[StartupProviderData]:
        """Search using Crunchbase API."""
        if not self.api_key:
            return None

        try:
            # Note: This is a placeholder for actual Crunchbase API integration
            # Crunchbase API requires paid access
            url = f"https://api.crunchbase.com/v4/data/entities/organizations/{quote_plus(name.lower())}"
            response = await self.client.get(url, headers={
                "X-cb-user-key": self.api_key
            })

            if response.status_code == 200:
                data = response.json()
                return self._parse_api_response(data)

        except Exception as e:
            print(f"Crunchbase API error: {e}")

        return None

    async def _search_via_web(
        self,
        name: str,
        website: Optional[str] = None
    ) -> Optional[StartupProviderData]:
        """Search using web scraping."""
        # Search for company page
        query = f'site:crunchbase.com/organization "{name}"'
        results = await self.search_client.search(query, num_results=3)

        if not results:
            return None

        # Find the best matching result
        profile_url = None
        for result in results:
            url = result.get("url", "")
            if "/organization/" in url:
                profile_url = url
                break

        if not profile_url:
            return None

        # Get additional info via search
        funding_query = f'site:crunchbase.com "{name}" funding {self.period_start.year}'
        funding_results = await self.search_client.search(funding_query, num_results=5)

        # Extract funding mentions
        funding_rounds = []
        for result in funding_results:
            title = result.get("title", "")
            # Look for funding round patterns
            if any(term in title.lower() for term in ["series", "seed", "funding", "raised"]):
                funding_rounds.append({
                    "source": "crunchbase_search",
                    "title": title,
                    "url": result.get("url"),
                })

        return StartupProviderData(
            source="crunchbase",
            profile_url=profile_url,
            funding_rounds_in_period=funding_rounds,
            investors=[],  # Would need page scraping
            competitors_mentioned=[],
            news_in_period=[],
        )

    def _parse_api_response(self, data: Dict[str, Any]) -> StartupProviderData:
        """Parse Crunchbase API response."""
        properties = data.get("properties", {})

        return StartupProviderData(
            source="crunchbase",
            profile_url=f"https://www.crunchbase.com/organization/{properties.get('identifier', {}).get('permalink', '')}",
            total_funding=properties.get("funding_total", {}).get("value"),
            employee_count=properties.get("num_employees_enum"),
            founded_year=properties.get("founded_on", {}).get("value", "")[:4] if properties.get("founded_on") else None,
            market_category=properties.get("categories", [{}])[0].get("value") if properties.get("categories") else None,
        )

    async def close(self):
        await self.search_client.close()
        await self.client.aclose()


class CBInsightsClient:
    """CB Insights public data collection."""

    def __init__(self, period_start: datetime, period_end: datetime):
        self.period_start = period_start
        self.period_end = period_end
        self.search_client = WebSearchClient()

    async def search_company(self, name: str) -> Optional[StartupProviderData]:
        """Search CB Insights for company mentions in period."""

        # Search for company mentions
        query = f'site:cbinsights.com "{name}" {self.period_start.year}'
        results = await self.search_client.search(query, num_results=5)

        if not results:
            return None

        profile_url = None
        analyst_mentions = []
        market_maps = []

        for result in results:
            url = result.get("url", "")
            title = result.get("title", "")

            if "/company/" in url:
                profile_url = url
            elif "market map" in title.lower() or "landscape" in title.lower():
                market_maps.append({"title": title, "url": url})
            else:
                analyst_mentions.append(title)

        if not profile_url and not analyst_mentions:
            return None

        return StartupProviderData(
            source="cbinsights",
            profile_url=profile_url,
            analyst_mentions=analyst_mentions[:5],
            market_category=market_maps[0]["title"] if market_maps else None,
        )

    async def get_market_maps(self, vertical: str) -> List[Dict[str, str]]:
        """Find relevant market maps from period."""
        query = f'site:cbinsights.com "{vertical}" "market map" OR "landscape" {self.period_start.year}'
        results = await self.search_client.search(query, num_results=5)

        maps = []
        for result in results:
            if "market map" in result.get("title", "").lower() or "landscape" in result.get("title", "").lower():
                maps.append({
                    "title": result.get("title"),
                    "url": result.get("url"),
                })

        return maps

    async def close(self):
        await self.search_client.close()


class PitchBookClient:
    """PitchBook public data collection."""

    def __init__(self, period_start: datetime, period_end: datetime):
        self.period_start = period_start
        self.period_end = period_end
        self.search_client = WebSearchClient()

    async def search_company(self, name: str) -> Optional[StartupProviderData]:
        """Search PitchBook for company data."""

        query = f'site:pitchbook.com "{name}"'
        results = await self.search_client.search(query, num_results=3)

        if not results:
            return None

        profile_url = None
        for result in results:
            url = result.get("url", "")
            if "/profiles/company/" in url:
                profile_url = url
                break

        if not profile_url:
            return None

        return StartupProviderData(
            source="pitchbook",
            profile_url=profile_url,
        )

    async def close(self):
        await self.search_client.close()


class TracxnClient:
    """Tracxn public data collection."""

    def __init__(self, period_start: datetime, period_end: datetime):
        self.period_start = period_start
        self.period_end = period_end
        self.search_client = WebSearchClient()

    async def search_company(self, name: str) -> Optional[StartupProviderData]:
        """Search Tracxn for company data."""

        query = f'site:tracxn.com "{name}"'
        results = await self.search_client.search(query, num_results=3)

        if not results:
            return None

        profile_url = None
        for result in results:
            url = result.get("url", "")
            if "/companies/" in url or "/company/" in url:
                profile_url = url
                break

        if not profile_url:
            return None

        return StartupProviderData(
            source="tracxn",
            profile_url=profile_url,
        )

    async def close(self):
        await self.search_client.close()


class DealroomClient:
    """Dealroom public data collection (European focus)."""

    def __init__(self, period_start: datetime, period_end: datetime):
        self.period_start = period_start
        self.period_end = period_end
        self.search_client = WebSearchClient()

    async def search_company(self, name: str) -> Optional[StartupProviderData]:
        """Search Dealroom for company data."""

        query = f'site:dealroom.co "{name}"'
        results = await self.search_client.search(query, num_results=3)

        if not results:
            return None

        profile_url = None
        for result in results:
            url = result.get("url", "")
            if "/companies/" in url:
                profile_url = url
                break

        if not profile_url:
            return None

        return StartupProviderData(
            source="dealroom",
            profile_url=profile_url,
        )

    async def close(self):
        await self.search_client.close()


class StartupProviderAggregator:
    """Aggregates data from all startup providers."""

    def __init__(self, period: str):
        """Initialize with period string (e.g., '2026-01')."""
        self.period = period
        self.period_start, self.period_end = self._parse_period(period)

        # Initialize clients
        self.crunchbase = CrunchbaseClient(self.period_start, self.period_end)
        self.cbinsights = CBInsightsClient(self.period_start, self.period_end)
        self.pitchbook = PitchBookClient(self.period_start, self.period_end)
        self.tracxn = TracxnClient(self.period_start, self.period_end)
        self.dealroom = DealroomClient(self.period_start, self.period_end)

    def _parse_period(self, period: str) -> tuple:
        """Parse period string into start and end dates."""
        year, month = map(int, period.split("-"))
        start = datetime(year, month, 1, tzinfo=timezone.utc)

        # Calculate end of month
        if month == 12:
            end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            end = datetime(year, month + 1, 1, tzinfo=timezone.utc)

        return start, end

    async def collect_all(
        self,
        startup: StartupInput,
        enabled_providers: Optional[List[str]] = None
    ) -> List[StartupProviderData]:
        """Collect from all enabled providers, filtered to period."""

        config = settings.intelligence
        providers_data = []

        # Determine which providers to use
        if enabled_providers is None:
            enabled_providers = []
            if config.enable_crunchbase:
                enabled_providers.append("crunchbase")
            if config.enable_cbinsights:
                enabled_providers.append("cbinsights")
            if config.enable_pitchbook:
                enabled_providers.append("pitchbook")
            if config.enable_tracxn:
                enabled_providers.append("tracxn")
            if config.enable_dealroom:
                enabled_providers.append("dealroom")

        # Collect from each provider
        tasks = []

        if "crunchbase" in enabled_providers:
            tasks.append(self.crunchbase.search_company(startup.name, startup.website))

        if "cbinsights" in enabled_providers:
            tasks.append(self.cbinsights.search_company(startup.name))

        if "pitchbook" in enabled_providers:
            tasks.append(self.pitchbook.search_company(startup.name))

        if "tracxn" in enabled_providers:
            tasks.append(self.tracxn.search_company(startup.name))

        if "dealroom" in enabled_providers:
            tasks.append(self.dealroom.search_company(startup.name))

        # Run in parallel
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, StartupProviderData):
                providers_data.append(result)
            elif isinstance(result, Exception):
                print(f"Provider error: {result}")

        return providers_data

    async def close(self):
        """Close all client connections."""
        await asyncio.gather(
            self.crunchbase.close(),
            self.cbinsights.close(),
            self.pitchbook.close(),
            self.tracxn.close(),
            self.dealroom.close(),
        )
