"""Monthly statistics computation for startup funding analysis.

Computes comprehensive statistics from CSV and analysis data:
- Funding by stage, type, vertical
- Geographic breakdowns (continent, country, city, US state)
- Top deals and investors
- GenAI analysis metrics (from analyzed startups)
"""

import json
import statistics
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from collections import defaultdict

from src.data.models import StartupInput, StartupAnalysis


class MonthlyStatistics:
    """Compute and store monthly statistics for startup funding data."""

    def __init__(self, period: str):
        """Initialize with a period string like '2026-01'."""
        self.period = period
        self.stats: Dict[str, Any] = {
            "period": period,
            "generated_at": None,
        }

    def compute_from_csv(self, startups: List[StartupInput]) -> Dict[str, Any]:
        """Compute funding statistics from raw CSV/startup data.

        Args:
            startups: List of StartupInput objects from CSV

        Returns:
            Dictionary with deal summary, funding breakdowns, top deals/investors
        """
        if not startups:
            return {}

        # Filter startups with valid funding amounts
        funded = [s for s in startups if s.funding_amount and s.funding_amount > 0]
        funding_amounts: List[float] = [s.funding_amount for s in funded if s.funding_amount is not None]

        # Deal summary
        self.stats["deal_summary"] = {
            "total_deals": len(startups),
            "deals_with_funding": len(funded),
            "total_funding_usd": sum(funding_amounts) if funding_amounts else 0,
            "average_deal_size": statistics.mean(funding_amounts) if funding_amounts else 0,
            "median_deal_size": statistics.median(funding_amounts) if funding_amounts else 0,
            "min_deal_size": min(funding_amounts) if funding_amounts else 0,
            "max_deal_size": max(funding_amounts) if funding_amounts else 0,
        }

        # Funding by stage
        self.stats["funding_by_stage"] = self._compute_by_category(
            funded,
            lambda s: s.funding_stage.value if s.funding_stage else "unknown"
        )

        # Funding by type (from raw funding_type string)
        self.stats["funding_by_type"] = self._compute_by_category(
            funded,
            lambda s: self._normalize_funding_type(s.funding_type)
        )

        # Funding by vertical (from industries)
        self.stats["funding_by_vertical"] = self._compute_by_industries(funded)

        # Geographic breakdowns
        geo_stats = self._compute_geographic_stats(funded)
        self.stats["funding_by_continent"] = geo_stats["by_continent"]
        self.stats["funding_by_country"] = geo_stats["by_country"]
        self.stats["funding_by_city"] = geo_stats["by_city"]
        self.stats["funding_by_us_state"] = geo_stats["by_us_state"]

        # Top deals
        self.stats["top_deals"] = self._get_top_deals(funded, limit=20)

        # Top investors
        self.stats["top_investors"] = self._get_top_investors(funded, limit=20)

        return self.stats

    def compute_from_analyses(self, analyses: List[StartupAnalysis]) -> Dict[str, Any]:
        """Compute GenAI analysis statistics from processed analyses.

        Args:
            analyses: List of StartupAnalysis objects from the store

        Returns:
            Dictionary with GenAI adoption metrics, pattern distribution, etc.
        """
        if not analyses:
            self.stats["genai_analysis"] = {"total_analyzed": 0}
            return self.stats

        # Basic counts
        uses_genai = [a for a in analyses if a.uses_genai]

        # Intensity distribution
        intensity_dist = defaultdict(int)
        for a in analyses:
            intensity_dist[a.genai_intensity.value] += 1

        # Pattern distribution
        pattern_dist = defaultdict(int)
        for a in analyses:
            for pattern in a.build_patterns:
                pattern_dist[pattern.name] += 1

        # Newsletter potential distribution
        newsletter_dist = defaultdict(int)
        for a in analyses:
            newsletter_dist[a.newsletter_potential] += 1

        # Vertical distribution
        vertical_dist = defaultdict(int)
        for a in analyses:
            vertical_dist[a.vertical.value] += 1

        # Market type distribution
        market_dist = defaultdict(int)
        for a in analyses:
            market_dist[a.market_type.value] += 1

        # Target market distribution
        target_dist = defaultdict(int)
        for a in analyses:
            target_dist[a.target_market.value] += 1

        # Technical depth distribution
        depth_dist = defaultdict(int)
        for a in analyses:
            depth_dist[a.technical_depth] += 1

        self.stats["genai_analysis"] = {
            "total_analyzed": len(analyses),
            "uses_genai_count": len(uses_genai),
            "genai_adoption_rate": len(uses_genai) / len(analyses) if analyses else 0,
            "intensity_distribution": dict(intensity_dist),
            "pattern_distribution": dict(sorted(pattern_dist.items(), key=lambda x: -x[1])),
            "newsletter_potential": dict(newsletter_dist),
            "vertical_distribution": dict(sorted(vertical_dist.items(), key=lambda x: -x[1])),
            "market_type_distribution": dict(market_dist),
            "target_market_distribution": dict(target_dist),
            "technical_depth_distribution": dict(depth_dist),
        }

        # High potential startups
        high_potential = [
            {"name": a.company_name, "vertical": a.vertical.value, "patterns": [p.name for p in a.build_patterns]}
            for a in analyses if a.newsletter_potential == "high"
        ]
        self.stats["genai_analysis"]["high_potential_startups"] = high_potential[:10]

        return self.stats

    def generate_full_stats(
        self,
        startups: List[StartupInput],
        analyses: Optional[List[StartupAnalysis]] = None
    ) -> Dict[str, Any]:
        """Generate complete monthly statistics from both CSV and analysis data.

        Args:
            startups: List of StartupInput from CSV
            analyses: Optional list of StartupAnalysis from store

        Returns:
            Complete statistics dictionary
        """
        self.stats["generated_at"] = datetime.now(timezone.utc).isoformat()

        # CSV-based stats
        self.compute_from_csv(startups)

        # Analysis-based stats (if available)
        if analyses:
            self.compute_from_analyses(analyses)
        else:
            self.stats["genai_analysis"] = {
                "total_analyzed": 0,
                "note": "Run analysis to populate GenAI metrics"
            }

        return self.stats

    def save(self, output_path: Path) -> Path:
        """Save statistics to JSON file.

        Args:
            output_path: Directory to save the file

        Returns:
            Path to the saved file
        """
        output_path = Path(output_path)
        output_path.mkdir(parents=True, exist_ok=True)

        stats_file = output_path / "monthly_stats.json"
        with open(stats_file, "w") as f:
            json.dump(self.stats, f, indent=2, default=str)

        return stats_file

    def generate_summary_report(self, output_path: Path) -> Path:
        """Generate a human-readable markdown summary report.

        Args:
            output_path: Directory to save the report (period folder, not output folder)

        Returns:
            Path to the saved report
        """
        output_path = Path(output_path)
        output_path.mkdir(parents=True, exist_ok=True)

        lines = [
            f"# Monthly Startup Funding Report: {self.period}",
            f"",
            f"*Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}*",
            "",
        ]

        # Deal Summary
        if "deal_summary" in self.stats:
            ds = self.stats["deal_summary"]
            lines.extend([
                "## Deal Summary",
                "",
                f"| Metric | Value |",
                f"|--------|-------|",
                f"| Total Deals | {ds['total_deals']} |",
                f"| Total Funding | ${ds['total_funding_usd']:,.0f} |",
                f"| Average Deal Size | ${ds['average_deal_size']:,.0f} |",
                f"| Median Deal Size | ${ds['median_deal_size']:,.0f} |",
                f"| Largest Deal | ${ds['max_deal_size']:,.0f} |",
                "",
            ])

        # Funding by Stage
        if "funding_by_stage" in self.stats:
            lines.extend([
                "## Funding by Stage",
                "",
                "| Stage | Deals | Total Funding | Avg Deal |",
                "|-------|-------|---------------|----------|",
            ])
            for stage, data in sorted(
                self.stats["funding_by_stage"].items(),
                key=lambda x: -x[1]["total_usd"]
            ):
                lines.append(
                    f"| {stage.replace('_', ' ').title()} | {data['count']} | "
                    f"${data['total_usd']:,.0f} | ${data['avg_usd']:,.0f} |"
                )
            lines.append("")

        # Funding by Continent
        if "funding_by_continent" in self.stats:
            lines.extend([
                "## Funding by Region",
                "",
                "| Region | Deals | Total Funding | Avg Deal |",
                "|--------|-------|---------------|----------|",
            ])
            for region, data in sorted(
                self.stats["funding_by_continent"].items(),
                key=lambda x: -x[1]["total_usd"]
            ):
                lines.append(
                    f"| {region.replace('_', ' ').title()} | {data['count']} | "
                    f"${data['total_usd']:,.0f} | ${data['avg_usd']:,.0f} |"
                )
            lines.append("")

        # Top Countries
        if "funding_by_country" in self.stats:
            lines.extend([
                "## Top Countries by Funding",
                "",
                "| Country | Deals | Total Funding |",
                "|---------|-------|---------------|",
            ])
            sorted_countries = sorted(
                self.stats["funding_by_country"].items(),
                key=lambda x: -x[1]["total_usd"]
            )[:10]
            for country, data in sorted_countries:
                lines.append(
                    f"| {country.replace('_', ' ').title()} | {data['count']} | "
                    f"${data['total_usd']:,.0f} |"
                )
            lines.append("")

        # Top Cities
        if "funding_by_city" in self.stats:
            lines.extend([
                "## Top Cities by Funding",
                "",
                "| City | Deals | Total Funding |",
                "|------|-------|---------------|",
            ])
            sorted_cities = sorted(
                self.stats["funding_by_city"].items(),
                key=lambda x: -x[1]["total_usd"]
            )[:10]
            for city, data in sorted_cities:
                lines.append(
                    f"| {city.replace('_', ' ').title()} | {data['count']} | "
                    f"${data['total_usd']:,.0f} |"
                )
            lines.append("")

        # Top Deals
        if "top_deals" in self.stats:
            lines.extend([
                "## Top Deals",
                "",
                "| Company | Funding | Stage | Location |",
                "|---------|---------|-------|----------|",
            ])
            for deal in self.stats["top_deals"][:10]:
                lines.append(
                    f"| {deal['name']} | ${deal['funding_usd']:,.0f} | "
                    f"{deal.get('stage', 'N/A')} | {deal.get('location', 'N/A')[:30]} |"
                )
            lines.append("")

        # Top Investors
        if "top_investors" in self.stats:
            lines.extend([
                "## Most Active Investors",
                "",
                "| Investor | Deals | Total Invested |",
                "|----------|-------|----------------|",
            ])
            for inv in self.stats["top_investors"][:10]:
                lines.append(
                    f"| {inv['name'][:40]} | {inv['deal_count']} | "
                    f"${inv['total_invested']:,.0f} |"
                )
            lines.append("")

        # Funding by Vertical
        if "funding_by_vertical" in self.stats:
            lines.extend([
                "## Funding by Industry Vertical",
                "",
                "| Vertical | Deals | Total Funding |",
                "|----------|-------|---------------|",
            ])
            sorted_verticals = sorted(
                self.stats["funding_by_vertical"].items(),
                key=lambda x: -x[1]["total_usd"]
            )[:15]
            for vertical, data in sorted_verticals:
                lines.append(
                    f"| {vertical[:40]} | {data['count']} | "
                    f"${data['total_usd']:,.0f} |"
                )
            lines.append("")

        # GenAI Analysis Section
        if "genai_analysis" in self.stats and self.stats["genai_analysis"].get("total_analyzed", 0) > 0:
            ga = self.stats["genai_analysis"]
            lines.extend([
                "## GenAI Analysis Insights",
                "",
                f"*Based on analysis of {ga['total_analyzed']} startups*",
                "",
                f"**GenAI Adoption Rate:** {ga['genai_adoption_rate']*100:.1f}%",
                "",
                "### GenAI Intensity Distribution",
                "",
                "| Intensity | Count |",
                "|-----------|-------|",
            ])
            for intensity, count in ga.get("intensity_distribution", {}).items():
                lines.append(f"| {intensity.title()} | {count} |")
            lines.append("")

            if ga.get("pattern_distribution"):
                lines.extend([
                    "### Build Pattern Distribution",
                    "",
                    "| Pattern | Count |",
                    "|---------|-------|",
                ])
                for pattern, count in list(ga["pattern_distribution"].items())[:10]:
                    lines.append(f"| {pattern} | {count} |")
                lines.append("")

            if ga.get("newsletter_potential"):
                lines.extend([
                    "### Newsletter Potential",
                    "",
                    "| Potential | Count |",
                    "|-----------|-------|",
                ])
                for level, count in ga["newsletter_potential"].items():
                    lines.append(f"| {level.title()} | {count} |")
                lines.append("")

        # Footer
        lines.extend([
            "---",
            "",
            f"*Data source: AI Startup Funding Database - {self.period}*",
        ])

        report_file = output_path / "monthly_summary.md"
        with open(report_file, "w") as f:
            f.write("\n".join(lines))

        return report_file

    # ---------- Helper Methods ----------

    def _compute_by_category(
        self,
        startups: List[StartupInput],
        key_fn
    ) -> Dict[str, Dict[str, Any]]:
        """Compute funding metrics grouped by a category."""
        grouped = defaultdict(list)
        for s in startups:
            key = key_fn(s)
            if key:
                grouped[key].append(s.funding_amount)

        result = {}
        for key, amounts in grouped.items():
            result[key] = {
                "count": len(amounts),
                "total_usd": sum(amounts),
                "avg_usd": sum(amounts) / len(amounts) if amounts else 0,
            }
        return result

    def _compute_by_industries(
        self,
        startups: List[StartupInput]
    ) -> Dict[str, Dict[str, Any]]:
        """Compute funding metrics by industry vertical."""
        industry_funding = defaultdict(list)

        for s in startups:
            for industry in s.industries:
                # Normalize industry names
                normalized = self._normalize_industry(industry)
                if normalized:
                    industry_funding[normalized].append(s.funding_amount)

        result = {}
        for industry, amounts in industry_funding.items():
            result[industry] = {
                "count": len(amounts),
                "total_usd": sum(amounts),
                "avg_usd": sum(amounts) / len(amounts) if amounts else 0,
            }
        return result

    def _compute_geographic_stats(
        self,
        startups: List[StartupInput]
    ) -> Dict[str, Dict[str, Dict[str, Any]]]:
        """Compute geographic funding breakdowns."""
        by_continent = defaultdict(list)
        by_country = defaultdict(list)
        by_city = defaultdict(list)
        by_us_state = defaultdict(list)

        for s in startups:
            if not s.location:
                continue

            parsed = self._parse_location(s.location)
            if not parsed:
                continue

            if parsed.get("continent"):
                by_continent[parsed["continent"]].append(s.funding_amount)

            if parsed.get("country"):
                by_country[parsed["country"]].append(s.funding_amount)

            if parsed.get("city"):
                by_city[parsed["city"]].append(s.funding_amount)

            # US state tracking
            if parsed.get("country") == "united_states" and parsed.get("state"):
                by_us_state[parsed["state"]].append(s.funding_amount)

        def to_stats(grouped):
            result = {}
            for key, amounts in grouped.items():
                result[key] = {
                    "count": len(amounts),
                    "total_usd": sum(amounts),
                    "avg_usd": sum(amounts) / len(amounts) if amounts else 0,
                }
            return result

        return {
            "by_continent": to_stats(by_continent),
            "by_country": to_stats(by_country),
            "by_city": to_stats(by_city),
            "by_us_state": to_stats(by_us_state),
        }

    def _parse_location(self, location: str) -> Optional[Dict[str, str]]:
        """Parse location string into components.

        CSV format: "City, State/Region, Country, Continent"
        Example: "Palo Alto, California, United States, North America"

        Returns dict with normalized keys: city, state, country, continent
        """
        if not location:
            return None

        parts = [p.strip() for p in location.split(",")]
        if len(parts) < 2:
            return None

        result = {}

        # Last part is usually continent
        if len(parts) >= 1:
            result["continent"] = self._normalize_key(parts[-1])

        # Second to last is usually country
        if len(parts) >= 2:
            result["country"] = self._normalize_key(parts[-2])

        # Third to last is usually state/region
        if len(parts) >= 3:
            result["state"] = self._normalize_key(parts[-3])

        # First part is usually city
        if len(parts) >= 4:
            result["city"] = self._normalize_key(parts[0])
        elif len(parts) == 3:
            # Might be City, Country, Continent
            result["city"] = self._normalize_key(parts[0])

        return result

    def _normalize_key(self, s: str) -> str:
        """Normalize a string to use as a dictionary key."""
        return s.lower().strip().replace(" ", "_").replace("-", "_")

    def _normalize_funding_type(self, funding_type: Optional[str]) -> str:
        """Normalize funding type string."""
        if not funding_type:
            return "unknown"

        ft = funding_type.lower().strip()

        if "series a" in ft:
            return "series_a"
        elif "series b" in ft:
            return "series_b"
        elif "series c" in ft:
            return "series_c"
        elif "series d" in ft or "series e" in ft or "series f" in ft:
            return "series_d_plus"
        elif "pre-seed" in ft or "pre seed" in ft:
            return "pre_seed"
        elif "seed" in ft:
            return "seed"
        elif "venture" in ft:
            return "venture_round"
        elif "debt" in ft:
            return "debt_financing"
        elif "private equity" in ft:
            return "private_equity"
        elif "corporate" in ft:
            return "corporate_round"
        elif "angel" in ft:
            return "angel"
        elif "grant" in ft:
            return "grant"
        else:
            return "other"

    def _normalize_industry(self, industry: str) -> str:
        """Normalize industry name for grouping."""
        if not industry:
            return ""

        ind = industry.lower().strip()

        # Common normalizations
        if "artificial intelligence" in ind or "ai" in ind.split():
            return "artificial_intelligence"
        elif "machine learning" in ind:
            return "machine_learning"
        elif "generative ai" in ind or "genai" in ind:
            return "generative_ai"
        elif "healthcare" in ind or "health care" in ind or "medical" in ind:
            return "healthcare"
        elif "fintech" in ind or "financial" in ind:
            return "fintech"
        elif "saas" in ind:
            return "saas"
        elif "robotics" in ind:
            return "robotics"
        elif "cybersecurity" in ind or "security" in ind:
            return "cybersecurity"
        elif "developer" in ind or "devops" in ind:
            return "developer_tools"
        elif "enterprise" in ind:
            return "enterprise"
        elif "consumer" in ind:
            return "consumer"
        elif "ecommerce" in ind or "e-commerce" in ind:
            return "ecommerce"
        elif "education" in ind or "edtech" in ind:
            return "education"
        elif "marketing" in ind or "advertising" in ind:
            return "marketing"
        else:
            return self._normalize_key(industry)

    def _get_top_deals(
        self,
        startups: List[StartupInput],
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get top deals by funding amount."""
        sorted_startups = sorted(
            startups,
            key=lambda s: s.funding_amount or 0,
            reverse=True
        )

        return [
            {
                "name": s.name,
                "funding_usd": s.funding_amount,
                "stage": s.funding_type or "N/A",
                "location": s.location or "N/A",
                "website": s.website,
            }
            for s in sorted_startups[:limit]
        ]

    def _get_top_investors(
        self,
        startups: List[StartupInput],
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get most active investors by deal count and total invested."""
        investor_deals = defaultdict(list)

        for s in startups:
            for investor in s.lead_investors:
                investor = investor.strip()
                if investor:
                    investor_deals[investor].append(s.funding_amount or 0)

        # Calculate totals
        investor_stats = []
        for investor, amounts in investor_deals.items():
            investor_stats.append({
                "name": investor,
                "deal_count": len(amounts),
                "total_invested": sum(amounts),
                "avg_investment": sum(amounts) / len(amounts) if amounts else 0,
            })

        # Sort by deal count (primary) and total invested (secondary)
        investor_stats.sort(key=lambda x: (-x["deal_count"], -x["total_invested"]))

        return investor_stats[:limit]


def generate_monthly_stats(
    period: str,
    startups: List[StartupInput],
    analyses: Optional[List[StartupAnalysis]] = None,
    output_path: Optional[Path] = None
) -> Dict[str, Any]:
    """Convenience function to generate and save monthly statistics.

    Args:
        period: Period string like '2026-01'
        startups: List of StartupInput from CSV
        analyses: Optional list of StartupAnalysis from store
        output_path: Where to save the stats (defaults to period output dir)

    Returns:
        The generated statistics dictionary
    """
    stats = MonthlyStatistics(period)
    stats.generate_full_stats(startups, analyses)

    if output_path:
        stats.save(output_path)
        # Generate summary in parent (period folder)
        stats.generate_summary_report(output_path.parent)

    return stats.stats
