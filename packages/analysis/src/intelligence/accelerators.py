"""Accelerator and incubator participation detection.

Detects participation in:
- Y Combinator (with batch detection)
- Techstars (with program location)
- 500 Global
- Endeavor
- Plug and Play
- Antler
- Seedcamp
- Station F
- Founders Factory

All detection is time-bounded to a specific analysis period.
"""

import asyncio
import re
from datetime import datetime
from typing import List, Optional

from src.config import settings
from src.data.models import StartupInput, AcceleratorParticipation
from src.intelligence.providers import WebSearchClient


# Accelerator configurations
ACCELERATORS = {
    "yc": {
        "name": "Y Combinator",
        "short_name": "YC",
        "portfolio_url": "https://www.ycombinator.com/companies",
        "search_queries": [
            'site:ycombinator.com/companies "{company}"',
            '"{company}" "Y Combinator" batch',
            '"{company}" YC W OR S',
        ],
        "batch_regex": r"(W|S)(\d{2})",  # W24, S23, etc.
        "demo_day_url": "https://www.ycombinator.com/blog/tag/demo-day",
    },
    "techstars": {
        "name": "Techstars",
        "short_name": "Techstars",
        "portfolio_url": "https://www.techstars.com/portfolio",
        "search_queries": [
            'site:techstars.com "{company}"',
            '"{company}" "Techstars"',
        ],
        "location_regex": r"Techstars\s+([A-Za-z\s]+)\s*(\d{4})?",
    },
    "500global": {
        "name": "500 Global",
        "short_name": "500",
        "portfolio_url": "https://500.co/startups",
        "search_queries": [
            'site:500.co "{company}"',
            '"{company}" "500 Startups" OR "500 Global"',
        ],
    },
    "endeavor": {
        "name": "Endeavor",
        "short_name": "Endeavor",
        "portfolio_url": "https://endeavor.org/entrepreneurs",
        "search_queries": [
            'site:endeavor.org "{company}"',
            '"{company}" "Endeavor Entrepreneur"',
        ],
    },
    "plugandplay": {
        "name": "Plug and Play",
        "short_name": "PnP",
        "portfolio_url": "https://www.plugandplaytechcenter.com/startups",
        "search_queries": [
            'site:plugandplaytechcenter.com "{company}"',
            '"{company}" "Plug and Play"',
        ],
    },
    "antler": {
        "name": "Antler",
        "short_name": "Antler",
        "portfolio_url": "https://www.antler.co/portfolio",
        "search_queries": [
            'site:antler.co "{company}"',
            '"{company}" "Antler"',
        ],
    },
    "seedcamp": {
        "name": "Seedcamp",
        "short_name": "Seedcamp",
        "portfolio_url": "https://seedcamp.com/portfolio",
        "search_queries": [
            'site:seedcamp.com "{company}"',
            '"{company}" "Seedcamp"',
        ],
    },
    "stationf": {
        "name": "Station F",
        "short_name": "Station F",
        "portfolio_url": "https://stationf.co/startups",
        "search_queries": [
            'site:stationf.co "{company}"',
            '"{company}" "Station F"',
        ],
    },
    "foundersfactory": {
        "name": "Founders Factory",
        "short_name": "FF",
        "portfolio_url": "https://foundersfactory.com/portfolio",
        "search_queries": [
            'site:foundersfactory.com "{company}"',
            '"{company}" "Founders Factory"',
        ],
    },
    "nfx": {
        "name": "NFX Guild",
        "short_name": "NFX",
        "portfolio_url": "https://www.nfx.com/portfolio",
        "search_queries": [
            'site:nfx.com "{company}"',
            '"{company}" "NFX Guild"',
        ],
    },
    "entrepreneur_first": {
        "name": "Entrepreneur First",
        "short_name": "EF",
        "portfolio_url": "https://www.joinef.com/companies",
        "search_queries": [
            'site:joinef.com "{company}"',
            '"{company}" "Entrepreneur First"',
        ],
    },
    "alchemist": {
        "name": "Alchemist Accelerator",
        "short_name": "Alchemist",
        "portfolio_url": "https://alchemistaccelerator.com/portfolio",
        "search_queries": [
            'site:alchemistaccelerator.com "{company}"',
            '"{company}" "Alchemist Accelerator"',
        ],
    },
}


class AcceleratorClient:
    """Detects participation in accelerators and incubators."""

    def __init__(self, period_start: datetime, period_end: datetime):
        self.period_start = period_start
        self.period_end = period_end
        self.search_client = WebSearchClient()

    async def check_all_accelerators(
        self,
        startup: StartupInput,
        enabled_accelerators: Optional[List[str]] = None
    ) -> List[AcceleratorParticipation]:
        """Check participation in all configured accelerators."""

        config = settings.intelligence

        # Determine which accelerators to check
        if enabled_accelerators is None:
            enabled_accelerators = config.accelerator_list

        # Check each accelerator
        tasks = []
        for accel_id in enabled_accelerators:
            if accel_id in ACCELERATORS:
                tasks.append(self.check_accelerator(startup, accel_id))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        participations = []
        for result in results:
            if isinstance(result, AcceleratorParticipation):
                participations.append(result)
            elif isinstance(result, Exception):
                print(f"Accelerator check error: {result}")

        return participations

    async def check_accelerator(
        self,
        startup: StartupInput,
        accel_id: str
    ) -> Optional[AcceleratorParticipation]:
        """Check specific accelerator participation."""

        if accel_id not in ACCELERATORS:
            return None

        accel = ACCELERATORS[accel_id]
        company_name = startup.name

        # Try each search query
        for query_template in accel["search_queries"]:
            query = query_template.format(company=company_name)

            # Add year filter for period relevance
            query += f" {self.period_start.year}"

            results = await self.search_client.search(query, num_results=3)

            if results:
                for result in results:
                    title = result.get("title", "").lower()
                    url = result.get("url", "")

                    # Check for accelerator mentions
                    accel_keywords = [
                        accel["name"].lower(),
                        accel.get("short_name", "").lower()
                    ]
                    company_in_title = company_name.lower() in title

                    if company_in_title or any(kw in title for kw in accel_keywords if kw):
                        # Found a match - extract details
                        batch = self._extract_batch(title + " " + url, accel)
                        year = self._extract_year(title + " " + url)
                        location = self._extract_location(title, accel)

                        confidence = self._calculate_confidence(
                            company_name, title, url, accel
                        )

                        if confidence > 0.3:  # Threshold for inclusion
                            return AcceleratorParticipation(
                                accelerator=accel["name"],
                                batch=batch,
                                program_location=location,
                                year=year,
                                status="alumni" if year and year < self.period_start.year else "current",
                                demo_day_url=accel.get("demo_day_url"),
                                profile_url=url if accel["portfolio_url"] in url else accel["portfolio_url"],
                                confidence=confidence,
                            )

        return None

    def _extract_batch(self, text: str, accel: dict) -> Optional[str]:
        """Extract batch identifier (e.g., W24, S23 for YC)."""
        if "batch_regex" in accel:
            match = re.search(accel["batch_regex"], text, re.IGNORECASE)
            if match:
                # Format as W24, S23, etc.
                season = match.group(1).upper()
                year = match.group(2)
                return f"{season}{year}"
        return None

    def _extract_year(self, text: str) -> Optional[int]:
        """Extract year from text."""
        # Look for 4-digit years
        years = re.findall(r"20\d{2}", text)
        if years:
            # Return the most recent valid year
            valid_years = [int(y) for y in years if 2010 <= int(y) <= 2030]
            if valid_years:
                return max(valid_years)
        return None

    def _extract_location(self, text: str, accel: dict) -> Optional[str]:
        """Extract program location for accelerators with multiple locations."""
        if "location_regex" in accel:
            match = re.search(accel["location_regex"], text, re.IGNORECASE)
            if match:
                return match.group(1).strip()

        # Common Techstars locations
        techstars_locations = [
            "NYC", "New York", "Boston", "Boulder", "Austin", "Seattle",
            "Los Angeles", "Chicago", "Toronto", "London", "Berlin", "Paris"
        ]
        for loc in techstars_locations:
            if loc.lower() in text.lower():
                return loc

        return None

    def _calculate_confidence(
        self,
        company_name: str,
        title: str,
        url: str,
        accel: dict
    ) -> float:
        """Calculate confidence score for accelerator participation."""
        confidence = 0.0

        company_lower = company_name.lower()
        title_lower = title.lower()

        # Company name exact match
        if company_lower in title_lower:
            confidence += 0.4

        # Accelerator name in title
        if accel["name"].lower() in title_lower:
            confidence += 0.3

        # Official portfolio URL
        if accel["portfolio_url"] in url:
            confidence += 0.25

        # Domain match
        accel_domains = ["ycombinator.com", "techstars.com", "500.co",
                         "endeavor.org", "plugandplaytechcenter.com",
                         "antler.co", "seedcamp.com", "stationf.co",
                         "foundersfactory.com", "nfx.com", "joinef.com",
                         "alchemistaccelerator.com"]
        for domain in accel_domains:
            if domain in url:
                confidence += 0.1
                break

        return min(confidence, 1.0)

    async def check_yc_specifically(
        self,
        startup: StartupInput
    ) -> Optional[AcceleratorParticipation]:
        """Dedicated YC check with enhanced batch detection."""
        company_name = startup.name

        # Direct YC company page search
        query = f'site:ycombinator.com/companies "{company_name}"'
        results = await self.search_client.search(query, num_results=5)

        for result in results:
            url = result.get("url", "")
            title = result.get("title", "")

            if "/companies/" in url and company_name.lower() in title.lower():
                # This is likely the company's YC page
                batch = self._extract_batch(title + " " + url, ACCELERATORS["yc"])

                # Try to get batch from URL path if not in title
                if not batch:
                    # YC URLs often have batch info
                    batch_match = re.search(r"[/\-_](W|S)(\d{2})", url, re.IGNORECASE)
                    if batch_match:
                        batch = f"{batch_match.group(1).upper()}{batch_match.group(2)}"

                year = None
                if batch:
                    # Convert batch to year (W24 = Winter 2024, S23 = Summer 2023)
                    year_suffix = int(batch[1:])
                    year = 2000 + year_suffix

                return AcceleratorParticipation(
                    accelerator="Y Combinator",
                    batch=batch,
                    year=year,
                    status="alumni",
                    profile_url=url,
                    demo_day_url="https://www.ycombinator.com/blog/tag/demo-day",
                    confidence=0.9,
                )

        return None

    async def close(self):
        await self.search_client.close()
