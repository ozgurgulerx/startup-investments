"""Big tech startup program detection.

Detects participation in:
- Google for Startups / Google Cloud for Startups
- AWS Activate
- Microsoft for Startups / Founders Hub
- NVIDIA Inception
- Meta Accelerator
- Salesforce Ventures
- Intel Ignite

All detection is time-bounded to a specific analysis period.
"""

import asyncio
import re
from datetime import datetime, timezone
from typing import List, Optional

from src.config import settings
from src.data.models import StartupInput, TechProgramParticipation
from src.intelligence.providers import WebSearchClient


# Tech startup programs configuration
TECH_PROGRAMS = {
    "google_cloud_startups": {
        "name": "Google Cloud for Startups",
        "company": "Google",
        "search_queries": [
            'site:cloud.google.com/startup "{company}"',
            '"{company}" "Google Cloud for Startups"',
            '"{company}" "Google for Startups Cloud Program"',
        ],
        "portfolio_url": "https://cloud.google.com/startup",
        "benefits": ["up to $200K in Google Cloud credits", "technical support", "training"],
    },
    "google_for_startups": {
        "name": "Google for Startups",
        "company": "Google",
        "search_queries": [
            'site:startup.google.com "{company}"',
            '"{company}" "Google for Startups"',
        ],
        "portfolio_url": "https://startup.google.com",
        "benefits": ["mentorship", "Google network access", "workspace"],
    },
    "aws_activate": {
        "name": "AWS Activate",
        "company": "Amazon",
        "search_queries": [
            'site:aws.amazon.com "{company}" startup',
            '"{company}" "AWS Activate"',
            '"{company}" "AWS Startup"',
        ],
        "portfolio_url": "https://aws.amazon.com/activate/",
        "benefits": ["up to $100K in AWS credits", "technical support", "training"],
    },
    "microsoft_startups": {
        "name": "Microsoft for Startups",
        "company": "Microsoft",
        "search_queries": [
            'site:startups.microsoft.com "{company}"',
            '"{company}" "Microsoft for Startups"',
            '"{company}" "Microsoft Founders Hub"',
        ],
        "portfolio_url": "https://www.microsoft.com/en-us/startups",
        "benefits": ["up to $150K in Azure credits", "GitHub Enterprise", "OpenAI credits"],
    },
    "nvidia_inception": {
        "name": "NVIDIA Inception",
        "company": "NVIDIA",
        "search_queries": [
            'site:nvidia.com/inception "{company}"',
            '"{company}" "NVIDIA Inception"',
            '"{company}" NVIDIA startup program',
        ],
        "portfolio_url": "https://www.nvidia.com/en-us/startups/",
        "benefits": ["hardware discounts", "technical support", "co-marketing"],
    },
    "meta_accelerator": {
        "name": "Meta Accelerator",
        "company": "Meta",
        "search_queries": [
            '"{company}" "Meta Accelerator"',
            '"{company}" "Facebook Accelerator"',
            'site:about.fb.com "{company}" startup',
        ],
        "portfolio_url": "https://about.fb.com/news/category/startups/",
        "benefits": ["mentorship", "Meta network", "marketing support"],
    },
    "salesforce_ventures": {
        "name": "Salesforce Ventures",
        "company": "Salesforce",
        "search_queries": [
            'site:salesforceventures.com "{company}"',
            '"{company}" "Salesforce Ventures"',
        ],
        "portfolio_url": "https://www.salesforceventures.com/portfolio/",
        "benefits": ["investment", "Salesforce integration", "enterprise distribution"],
    },
    "intel_ignite": {
        "name": "Intel Ignite",
        "company": "Intel",
        "search_queries": [
            'site:intelignite.com "{company}"',
            '"{company}" "Intel Ignite"',
            '"{company}" "Intel Capital startup"',
        ],
        "portfolio_url": "https://intelignite.com/",
        "benefits": ["mentorship", "Intel technology access", "market access"],
    },
    "oracle_startup": {
        "name": "Oracle for Startups",
        "company": "Oracle",
        "search_queries": [
            '"{company}" "Oracle for Startups"',
            'site:oracle.com "{company}" startup',
        ],
        "portfolio_url": "https://www.oracle.com/startup/",
        "benefits": ["Oracle Cloud credits", "technical support"],
    },
    "ibm_startup": {
        "name": "IBM Startup Program",
        "company": "IBM",
        "search_queries": [
            '"{company}" "IBM startup"',
            '"{company}" "IBM Cloud startup"',
        ],
        "portfolio_url": "https://www.ibm.com/startups",
        "benefits": ["IBM Cloud credits", "technical support"],
    },
}


class TechProgramClient:
    """Detects participation in big tech startup programs."""

    def __init__(self, period_start: datetime, period_end: datetime):
        self.period_start = period_start
        self.period_end = period_end
        self.search_client = WebSearchClient()

    async def check_all_programs(
        self,
        startup: StartupInput,
        enabled_programs: Optional[List[str]] = None
    ) -> List[TechProgramParticipation]:
        """Check participation in all tech programs."""

        config = settings.intelligence

        # Determine which programs to check
        if enabled_programs is None:
            enabled_programs = []
            if config.check_google_programs:
                enabled_programs.extend(["google_cloud_startups", "google_for_startups"])
            if config.check_aws_programs:
                enabled_programs.append("aws_activate")
            if config.check_microsoft_programs:
                enabled_programs.append("microsoft_startups")
            if config.check_nvidia_programs:
                enabled_programs.append("nvidia_inception")
            if config.check_meta_programs:
                enabled_programs.append("meta_accelerator")
            if config.check_salesforce_programs:
                enabled_programs.append("salesforce_ventures")
            if config.check_intel_programs:
                enabled_programs.append("intel_ignite")

        # Check each program
        tasks = []
        for program_id in enabled_programs:
            if program_id in TECH_PROGRAMS:
                tasks.append(self.check_program(startup, program_id))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        participations = []
        for result in results:
            if isinstance(result, TechProgramParticipation):
                participations.append(result)
            elif isinstance(result, Exception):
                print(f"Tech program check error: {result}")

        return participations

    async def check_program(
        self,
        startup: StartupInput,
        program_id: str
    ) -> Optional[TechProgramParticipation]:
        """Check specific program participation."""

        if program_id not in TECH_PROGRAMS:
            return None

        program = TECH_PROGRAMS[program_id]
        company_name = startup.name

        # Try each search query
        for query_template in program["search_queries"]:
            query = query_template.format(company=company_name)

            # Add year filter for period relevance
            query += f" {self.period_start.year}"

            results = await self.search_client.search(query, num_results=3)

            if results:
                # Check if results are relevant
                for result in results:
                    title = result.get("title", "").lower()
                    url = result.get("url", "")

                    # Check for program mentions
                    program_keywords = program["name"].lower().split()
                    company_in_title = company_name.lower() in title

                    if company_in_title or any(kw in title for kw in program_keywords):
                        # Found a match
                        confidence = self._calculate_confidence(
                            company_name, title, url, program
                        )

                        if confidence > 0.3:  # Threshold for inclusion
                            return TechProgramParticipation(
                                program_name=program["name"],
                                company=program["company"],
                                status="member",
                                program_url=program["portfolio_url"],
                                benefits=program.get("benefits", []),
                                evidence_url=url,
                                confidence=confidence,
                            )

        return None

    def _calculate_confidence(
        self,
        company_name: str,
        title: str,
        url: str,
        program: dict
    ) -> float:
        """Calculate confidence score for program participation."""
        confidence = 0.0

        company_lower = company_name.lower()
        title_lower = title.lower()

        # Company name exact match
        if company_lower in title_lower:
            confidence += 0.4

        # Program name in title
        if program["name"].lower() in title_lower:
            confidence += 0.3

        # Official domain
        program_company = program["company"].lower()
        if program_company in url.lower():
            confidence += 0.2

        # Portfolio page
        if "portfolio" in url.lower() or "startups" in url.lower():
            confidence += 0.1

        return min(confidence, 1.0)

    async def close(self):
        await self.search_client.close()
