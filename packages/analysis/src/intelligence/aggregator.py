"""Main intelligence aggregator - orchestrates all external data collection.

Combines data from:
- Startup databases (Crunchbase, CB Insights, PitchBook, Tracxn, Dealroom)
- Big tech programs (Google, AWS, Microsoft, NVIDIA, Meta, Salesforce, Intel)
- Accelerators (YC, Techstars, 500 Global, Endeavor, Plug and Play, etc.)
- VC resources (Sequoia, a16z, Greylock, First Round, etc.)

All data collection is time-bounded to a specific analysis period.
"""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any

from src.config import settings
from src.data.models import (
    StartupInput, StartupAnalysis, StartupIntelligence,
    StartupProviderData, TechProgramParticipation,
    AcceleratorParticipation, VCResource
)
from src.intelligence.providers import StartupProviderAggregator
from src.intelligence.tech_programs import TechProgramClient
from src.intelligence.accelerators import AcceleratorClient
from src.intelligence.vc_resources import VCResourceClient


class StartupIntelligenceAggregator:
    """Main orchestrator for all intelligence collection."""

    def __init__(self, period: str):
        """Initialize with period string (e.g., '2026-01').

        Args:
            period: Analysis period in YYYY-MM format
        """
        self.period = period
        self.period_start, self.period_end = self._parse_period(period)

        # Initialize clients
        self.provider_aggregator = StartupProviderAggregator(period)
        self.tech_program_client = TechProgramClient(self.period_start, self.period_end)
        self.accelerator_client = AcceleratorClient(self.period_start, self.period_end)
        self.vc_resource_client = VCResourceClient(self.period_start, self.period_end)

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

    async def collect_full_intelligence(
        self,
        startup: StartupInput,
        analysis: Optional[StartupAnalysis] = None
    ) -> StartupIntelligence:
        """Collect all external intelligence for a startup.

        Args:
            startup: The startup to collect intelligence for
            analysis: Optional existing analysis to enhance resource relevance

        Returns:
            StartupIntelligence with all collected data
        """
        config = settings.intelligence

        # Parallel collection of different data sources
        tasks = []

        # Provider data (Crunchbase, CB Insights, etc.)
        tasks.append(self._collect_providers(startup))

        # Tech program participation
        if config.enable_tech_programs:
            tasks.append(self._collect_tech_programs(startup))
        else:
            tasks.append(self._empty_result([]))

        # Accelerator participation
        if config.enable_accelerators:
            tasks.append(self._collect_accelerators(startup))
        else:
            tasks.append(self._empty_result([]))

        # Run parallel collection
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Unpack results
        provider_data = results[0] if isinstance(results[0], list) else []
        tech_programs = results[1] if isinstance(results[1], list) else []
        accelerators = results[2] if isinstance(results[2], list) else []

        # Get relevant VC resources (can use analysis context if available)
        vc_resources = []
        if config.enable_vc_resources:
            vc_resources = await self.vc_resource_client.get_relevant_resources(
                startup=startup,
                analysis=analysis,
                limit=10
            )

        # Calculate intelligence score
        score = self._calculate_intelligence_score(
            provider_data, tech_programs, accelerators
        )

        return StartupIntelligence(
            company_name=startup.name,
            period=self.period,
            period_start=self.period_start.isoformat(),
            period_end=self.period_end.isoformat(),
            provider_data=provider_data,
            tech_programs=tech_programs,
            accelerators=accelerators,
            vc_resources=vc_resources,
            intelligence_score=score,
            last_collected=datetime.now(timezone.utc),
        )

    async def _collect_providers(
        self,
        startup: StartupInput
    ) -> List[StartupProviderData]:
        """Collect from startup information providers."""
        try:
            return await self.provider_aggregator.collect_all(startup)
        except Exception as e:
            print(f"Provider collection error for {startup.name}: {e}")
            return []

    async def _collect_tech_programs(
        self,
        startup: StartupInput
    ) -> List[TechProgramParticipation]:
        """Collect tech program participation data."""
        try:
            return await self.tech_program_client.check_all_programs(startup)
        except Exception as e:
            print(f"Tech program check error for {startup.name}: {e}")
            return []

    async def _collect_accelerators(
        self,
        startup: StartupInput
    ) -> List[AcceleratorParticipation]:
        """Collect accelerator participation data."""
        try:
            return await self.accelerator_client.check_all_accelerators(startup)
        except Exception as e:
            print(f"Accelerator check error for {startup.name}: {e}")
            return []

    async def _empty_result(self, default: Any) -> Any:
        """Return empty result for disabled features."""
        return default

    def _calculate_intelligence_score(
        self,
        provider_data: List[StartupProviderData],
        tech_programs: List[TechProgramParticipation],
        accelerators: List[AcceleratorParticipation]
    ) -> float:
        """Calculate credibility score based on external validation.

        Higher scores indicate more external validation:
        - Multiple provider mentions
        - Tech program participation
        - Accelerator alumni status
        """
        score = 0.0

        # Provider coverage (up to 0.3)
        provider_count = len(provider_data)
        if provider_count >= 3:
            score += 0.3
        elif provider_count >= 2:
            score += 0.2
        elif provider_count >= 1:
            score += 0.1

        # Tech programs (up to 0.3)
        tech_count = len(tech_programs)
        if tech_count >= 2:
            score += 0.3
        elif tech_count >= 1:
            score += 0.2

        # Accelerators (up to 0.4 - highest weight for YC, Techstars, etc.)
        accel_count = len(accelerators)
        if accel_count >= 1:
            # Check for top-tier accelerators
            top_tier = ["Y Combinator", "Techstars", "500 Global", "Endeavor"]
            has_top_tier = any(a.accelerator in top_tier for a in accelerators)
            if has_top_tier:
                score += 0.4
            else:
                score += 0.25

        return min(score, 1.0)

    async def collect_batch(
        self,
        startups: List[StartupInput],
        analyses: Optional[Dict[str, StartupAnalysis]] = None,
        max_concurrent: int = 3
    ) -> Dict[str, StartupIntelligence]:
        """Collect intelligence for multiple startups.

        Args:
            startups: List of startups to process
            analyses: Optional dict of existing analyses by company slug
            max_concurrent: Max concurrent collection tasks

        Returns:
            Dict mapping company slug to intelligence data
        """
        results = {}
        semaphore = asyncio.Semaphore(max_concurrent)

        async def collect_one(startup: StartupInput) -> tuple:
            async with semaphore:
                analysis = None
                if analyses:
                    slug = StartupAnalysis.to_slug(startup.name)
                    analysis = analyses.get(slug)

                intelligence = await self.collect_full_intelligence(startup, analysis)
                return startup.name, intelligence

        tasks = [collect_one(s) for s in startups]
        completed = await asyncio.gather(*tasks, return_exceptions=True)

        for result in completed:
            if isinstance(result, tuple):
                name, intelligence = result
                slug = StartupAnalysis.to_slug(name)
                results[slug] = intelligence
            elif isinstance(result, Exception):
                print(f"Batch collection error: {result}")

        return results

    def save_intelligence_report(
        self,
        intelligence_data: Dict[str, StartupIntelligence],
        output_path: Path
    ) -> Path:
        """Save intelligence report to JSON file.

        Args:
            intelligence_data: Dict mapping company slug to intelligence
            output_path: Directory to save the report

        Returns:
            Path to saved report
        """
        output_path = Path(output_path)
        output_path.mkdir(parents=True, exist_ok=True)

        report = {
            "period": self.period,
            "period_start": self.period_start.isoformat(),
            "period_end": self.period_end.isoformat(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "startups_analyzed": len(intelligence_data),
            "summary": self._generate_summary(intelligence_data),
            "startups": {}
        }

        for slug, intelligence in intelligence_data.items():
            report["startups"][slug] = intelligence.model_dump(mode="json")

        report_path = output_path / "intelligence_report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2, default=str)

        return report_path

    def _generate_summary(
        self,
        intelligence_data: Dict[str, StartupIntelligence]
    ) -> Dict[str, Any]:
        """Generate summary statistics from intelligence data."""
        summary = {
            "total_startups": len(intelligence_data),
            "with_provider_data": 0,
            "in_tech_programs": 0,
            "in_accelerators": 0,
            "avg_intelligence_score": 0.0,
            "tech_programs_breakdown": {},
            "accelerators_breakdown": {},
        }

        scores = []
        tech_programs_count: Dict[str, int] = {}
        accelerators_count: Dict[str, int] = {}

        for intelligence in intelligence_data.values():
            scores.append(intelligence.intelligence_score)

            if intelligence.provider_data:
                summary["with_provider_data"] += 1

            if intelligence.tech_programs:
                summary["in_tech_programs"] += 1
                for prog in intelligence.tech_programs:
                    tech_programs_count[prog.program_name] = tech_programs_count.get(prog.program_name, 0) + 1

            if intelligence.accelerators:
                summary["in_accelerators"] += 1
                for accel in intelligence.accelerators:
                    accelerators_count[accel.accelerator] = accelerators_count.get(accel.accelerator, 0) + 1

        summary["avg_intelligence_score"] = sum(scores) / len(scores) if scores else 0.0
        summary["tech_programs_breakdown"] = tech_programs_count
        summary["accelerators_breakdown"] = accelerators_count

        return summary

    async def close(self):
        """Close all client connections."""
        await asyncio.gather(
            self.provider_aggregator.close(),
            self.tech_program_client.close(),
            self.accelerator_client.close(),
            self.vc_resource_client.close(),
        )
