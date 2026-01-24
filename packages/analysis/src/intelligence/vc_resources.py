"""VC content and resources collection.

Curates and links to valuable content from top VCs:
- Sequoia Capital (YouTube, Blog, Arc)
- Andreessen Horowitz (YouTube, Podcast, Blog)
- First Round Capital (Review Blog)
- Greylock Partners (YouTube, Blog)
- Y Combinator (YouTube, Essays)
- NFX (Essays, Network Effects)
- Bessemer (Memos, Roadmap)
- Point Nine (Blog)
- OpenView (Blog)
- Battery Ventures (Blog)

Content is filtered by relevance to startup's vertical and stage.
"""

import asyncio
from datetime import datetime
from typing import List, Optional, Dict, Any

from src.config import settings
from src.data.models import StartupInput, StartupAnalysis, VCResource, Vertical, FundingStage
from src.intelligence.providers import WebSearchClient


# VC content source configuration
VC_CONTENT_SOURCES = {
    "sequoia": {
        "name": "Sequoia Capital",
        "youtube": "https://www.youtube.com/@Sequoia",
        "blog": "https://www.sequoiacap.com/article/",
        "arc": "https://www.sequoiacap.com/arc/",
        "topics": ["growth", "product-market-fit", "scaling", "fundraising", "go-to-market"],
    },
    "a16z": {
        "name": "Andreessen Horowitz",
        "youtube": "https://www.youtube.com/@a16z",
        "blog": "https://a16z.com/",
        "podcast": "https://a16z.com/podcasts/",
        "topics": ["ai", "crypto", "bio", "fintech", "enterprise", "consumer", "infra"],
    },
    "firstround": {
        "name": "First Round Capital",
        "blog": "https://review.firstround.com/",
        "topics": ["hiring", "culture", "product", "growth", "management", "fundraising"],
    },
    "greylock": {
        "name": "Greylock Partners",
        "youtube": "https://www.youtube.com/@GreylockVC",
        "blog": "https://greylock.com/greymatter/",
        "topics": ["enterprise", "consumer", "ai", "data", "infrastructure"],
    },
    "yc": {
        "name": "Y Combinator",
        "youtube": "https://www.youtube.com/@ycombinator",
        "essays": "http://paulgraham.com/articles.html",
        "startup_school": "https://www.startupschool.org/",
        "library": "https://www.ycombinator.com/library",
        "topics": ["fundraising", "growth", "product", "founder-advice", "early-stage"],
    },
    "nfx": {
        "name": "NFX",
        "essays": "https://www.nfx.com/essays",
        "topics": ["network-effects", "marketplaces", "growth", "defensibility"],
    },
    "bessemer": {
        "name": "Bessemer Venture Partners",
        "memos": "https://www.bvp.com/memos",
        "roadmap": "https://www.bvp.com/atlas",
        "topics": ["cloud", "saas", "devtools", "enterprise", "vertical-saas"],
    },
    "pointnine": {
        "name": "Point Nine Capital",
        "blog": "https://medium.com/point-nine-news",
        "topics": ["saas", "b2b", "metrics", "fundraising", "european-startups"],
    },
    "openview": {
        "name": "OpenView",
        "blog": "https://openviewpartners.com/blog/",
        "topics": ["product-led-growth", "saas", "expansion", "pricing"],
    },
    "battery": {
        "name": "Battery Ventures",
        "blog": "https://www.battery.com/blog/",
        "topics": ["enterprise", "infrastructure", "devtools", "data"],
    },
    "indexventures": {
        "name": "Index Ventures",
        "blog": "https://www.indexventures.com/perspectives/",
        "topics": ["fintech", "gaming", "marketplaces", "saas"],
    },
    "accel": {
        "name": "Accel",
        "blog": "https://www.accel.com/noteworthy",
        "topics": ["enterprise", "consumer", "fintech", "health"],
    },
}


# Curated high-value content database
# These are hand-picked resources that are evergreen and valuable
CURATED_RESOURCES = [
    # Sequoia
    {
        "vc": "sequoia",
        "title": "Writing a Business Plan",
        "url": "https://www.sequoiacap.com/article/writing-a-business-plan/",
        "type": "blog",
        "topics": ["fundraising", "planning"],
        "stage_fit": ["pre_seed", "seed"],
    },
    {
        "vc": "sequoia",
        "title": "Sequoia - Crafting a Compelling Narrative",
        "url": "https://www.youtube.com/watch?v=II-6dDzc-80",
        "type": "youtube",
        "topics": ["storytelling", "fundraising"],
        "stage_fit": ["seed", "series_a"],
    },
    # a16z
    {
        "vc": "a16z",
        "title": "a16z AI Canon",
        "url": "https://a16z.com/ai-canon/",
        "type": "blog",
        "topics": ["ai", "technical"],
        "vertical_fit": ["developer_tools", "enterprise_saas"],
    },
    {
        "vc": "a16z",
        "title": "The AI Glossary",
        "url": "https://a16z.com/ai-glossary/",
        "type": "blog",
        "topics": ["ai", "education"],
        "vertical_fit": ["developer_tools"],
    },
    {
        "vc": "a16z",
        "title": "16 Things About Building Fintech",
        "url": "https://a16z.com/16-things-about-building-fintech-companies/",
        "type": "blog",
        "topics": ["fintech", "building"],
        "vertical_fit": ["financial_services"],
    },
    # First Round Review
    {
        "vc": "firstround",
        "title": "How to Interview Engineers",
        "url": "https://review.firstround.com/the-anatomy-of-the-perfect-technical-interview-from-a-former-amazon-vp",
        "type": "blog",
        "topics": ["hiring", "engineering"],
        "stage_fit": ["series_a", "series_b"],
    },
    {
        "vc": "firstround",
        "title": "Product-Market Fit Framework",
        "url": "https://review.firstround.com/how-superhuman-built-an-engine-to-find-product-market-fit",
        "type": "blog",
        "topics": ["product-market-fit", "metrics"],
        "stage_fit": ["seed", "series_a"],
    },
    # Y Combinator
    {
        "vc": "yc",
        "title": "How to Start a Startup (Sam Altman)",
        "url": "https://www.youtube.com/playlist?list=PL5q_lef6zVkaTY_cT1k7qFNF2TidHCe-1",
        "type": "youtube",
        "topics": ["founder-advice", "early-stage"],
        "stage_fit": ["pre_seed", "seed"],
    },
    {
        "vc": "yc",
        "title": "Do Things That Don't Scale",
        "url": "http://paulgraham.com/ds.html",
        "type": "essay",
        "topics": ["growth", "early-stage"],
        "stage_fit": ["pre_seed", "seed"],
    },
    {
        "vc": "yc",
        "title": "Default Alive or Default Dead",
        "url": "http://paulgraham.com/aord.html",
        "type": "essay",
        "topics": ["runway", "metrics"],
        "stage_fit": ["seed", "series_a"],
    },
    {
        "vc": "yc",
        "title": "Startup = Growth",
        "url": "http://paulgraham.com/growth.html",
        "type": "essay",
        "topics": ["growth", "definition"],
        "stage_fit": ["pre_seed", "seed", "series_a"],
    },
    # NFX
    {
        "vc": "nfx",
        "title": "The Network Effects Manual",
        "url": "https://www.nfx.com/post/network-effects-manual",
        "type": "essay",
        "topics": ["network-effects", "defensibility"],
        "vertical_fit": ["consumer", "enterprise_saas"],
    },
    {
        "vc": "nfx",
        "title": "The Network Effects Bible",
        "url": "https://www.nfx.com/post/network-effects-bible",
        "type": "essay",
        "topics": ["network-effects", "strategy"],
    },
    # Bessemer
    {
        "vc": "bessemer",
        "title": "Bessemer's Cloud Index",
        "url": "https://www.bvp.com/atlas/bessemer-cloud-index",
        "type": "blog",
        "topics": ["saas", "metrics", "benchmarks"],
        "vertical_fit": ["enterprise_saas"],
    },
    {
        "vc": "bessemer",
        "title": "The 10 Laws of Cloud",
        "url": "https://www.bvp.com/atlas/10-laws-of-cloud",
        "type": "blog",
        "topics": ["saas", "growth"],
        "vertical_fit": ["enterprise_saas", "developer_tools"],
    },
    # OpenView
    {
        "vc": "openview",
        "title": "Product-Led Growth Guide",
        "url": "https://openviewpartners.com/product-led-growth/",
        "type": "blog",
        "topics": ["product-led-growth", "go-to-market"],
        "vertical_fit": ["enterprise_saas", "developer_tools"],
    },
    # Greylock
    {
        "vc": "greylock",
        "title": "Blitzscaling Lectures",
        "url": "https://www.youtube.com/playlist?list=PLnsTB8Q5VgnVzh1S-VMCXiuwJglk5AV--",
        "type": "youtube",
        "topics": ["scaling", "growth"],
        "stage_fit": ["series_a", "series_b", "series_c"],
    },
]


# Topic mapping from verticals
VERTICAL_TO_TOPICS = {
    Vertical.HEALTHCARE: ["health", "bio", "healthcare"],
    Vertical.LEGAL: ["legal", "enterprise"],
    Vertical.FINANCIAL_SERVICES: ["fintech", "financial"],
    Vertical.DEVELOPER_TOOLS: ["devtools", "developer", "infrastructure", "ai"],
    Vertical.ENTERPRISE_SAAS: ["enterprise", "saas", "b2b", "cloud"],
    Vertical.CONSUMER: ["consumer", "growth"],
    Vertical.INDUSTRIAL: ["industrial", "manufacturing"],
    Vertical.EDUCATION: ["education", "edtech"],
    Vertical.MARKETING: ["marketing", "growth"],
    Vertical.HR_RECRUITING: ["hiring", "hr", "recruiting"],
    Vertical.CYBERSECURITY: ["security", "enterprise"],
    Vertical.ECOMMERCE: ["ecommerce", "marketplaces", "consumer"],
    Vertical.MEDIA_CONTENT: ["media", "content", "consumer"],
    Vertical.OTHER: ["general", "founder-advice"],
}

# Stage mapping
STAGE_TO_TOPICS = {
    FundingStage.PRE_SEED: ["early-stage", "founder-advice", "product-market-fit"],
    FundingStage.SEED: ["early-stage", "growth", "hiring", "product-market-fit"],
    FundingStage.SERIES_A: ["scaling", "hiring", "go-to-market", "metrics"],
    FundingStage.SERIES_B: ["scaling", "expansion", "management"],
    FundingStage.SERIES_C: ["scaling", "expansion", "international"],
    FundingStage.SERIES_D_PLUS: ["scaling", "ipo-readiness"],
    FundingStage.LATE_STAGE: ["scaling", "ipo-readiness"],
    FundingStage.UNKNOWN: ["general", "founder-advice"],
}


class VCResourceClient:
    """Collects and curates VC content resources."""

    def __init__(self, period_start: datetime, period_end: datetime):
        self.period_start = period_start
        self.period_end = period_end
        self.search_client = WebSearchClient()

    async def get_relevant_resources(
        self,
        startup: Optional[StartupInput] = None,
        analysis: Optional[StartupAnalysis] = None,
        vertical: Optional[Vertical] = None,
        stage: Optional[FundingStage] = None,
        topics: Optional[List[str]] = None,
        limit: int = 10
    ) -> List[VCResource]:
        """Get curated resources relevant to startup context."""

        # Determine context
        if startup:
            stage = stage or startup.funding_stage
        if analysis:
            vertical = vertical or analysis.vertical

        # Get relevant topics
        relevant_topics = set(topics or [])

        if vertical and vertical in VERTICAL_TO_TOPICS:
            relevant_topics.update(VERTICAL_TO_TOPICS[vertical])

        if stage and stage in STAGE_TO_TOPICS:
            relevant_topics.update(STAGE_TO_TOPICS[stage])

        # If using GenAI, add AI topics
        if analysis and analysis.uses_genai:
            relevant_topics.add("ai")

        # Score and filter curated resources
        scored_resources = []
        for resource in CURATED_RESOURCES:
            score = self._score_resource(resource, relevant_topics, vertical, stage)
            if score > 0:
                scored_resources.append((score, resource))

        # Sort by score and take top N
        scored_resources.sort(key=lambda x: x[0], reverse=True)
        top_resources = scored_resources[:limit]

        # Convert to VCResource models
        result = []
        for score, resource in top_resources:
            vc_info = VC_CONTENT_SOURCES.get(resource["vc"], {})
            result.append(VCResource(
                vc_firm=vc_info.get("name", resource["vc"]),
                resource_type=resource["type"],
                title=resource["title"],
                url=resource["url"],
                relevance_topic=", ".join(resource.get("topics", [])),
                relevance_score=score,
            ))

        return result

    def _score_resource(
        self,
        resource: Dict[str, Any],
        relevant_topics: set,
        vertical: Optional[Vertical],
        stage: Optional[FundingStage]
    ) -> float:
        """Score a resource based on relevance."""
        score = 0.0

        # Topic match
        resource_topics = set(resource.get("topics", []))
        topic_overlap = relevant_topics & resource_topics
        if topic_overlap:
            score += 0.3 * len(topic_overlap)

        # Vertical fit
        if vertical:
            vertical_fit = resource.get("vertical_fit", [])
            if vertical.value in vertical_fit:
                score += 0.4

        # Stage fit
        if stage:
            stage_fit = resource.get("stage_fit", [])
            if stage.value in stage_fit:
                score += 0.3

        # Boost for general resources if no specific match
        if score == 0 and not resource.get("vertical_fit") and not resource.get("stage_fit"):
            score = 0.1  # Base score for general content

        return min(score, 1.0)

    async def search_vc_content(
        self,
        vc_firm: str,
        topic: str,
        limit: int = 5
    ) -> List[VCResource]:
        """Search for specific VC content on a topic."""

        if vc_firm not in VC_CONTENT_SOURCES:
            return []

        vc_info = VC_CONTENT_SOURCES[vc_firm]
        results = []

        # Search YouTube if available
        if "youtube" in vc_info:
            query = f'site:youtube.com "{vc_info["name"]}" {topic}'
            search_results = await self.search_client.search(query, num_results=3)
            for result in search_results:
                results.append(VCResource(
                    vc_firm=vc_info["name"],
                    resource_type="youtube",
                    title=result.get("title", ""),
                    url=result.get("url", ""),
                    relevance_topic=topic,
                ))

        # Search blog if available
        if "blog" in vc_info:
            blog_domain = vc_info["blog"].replace("https://", "").replace("http://", "").split("/")[0]
            query = f'site:{blog_domain} {topic}'
            search_results = await self.search_client.search(query, num_results=3)
            for result in search_results:
                results.append(VCResource(
                    vc_firm=vc_info["name"],
                    resource_type="blog",
                    title=result.get("title", ""),
                    url=result.get("url", ""),
                    relevance_topic=topic,
                ))

        return results[:limit]

    async def get_all_vc_content_for_topic(
        self,
        topic: str,
        enabled_vcs: Optional[List[str]] = None
    ) -> List[VCResource]:
        """Get content from all VCs on a specific topic."""

        config = settings.intelligence

        if enabled_vcs is None:
            enabled_vcs = config.vc_firms

        tasks = []
        for vc in enabled_vcs:
            if vc in VC_CONTENT_SOURCES:
                tasks.append(self.search_vc_content(vc, topic, limit=2))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_resources = []
        for result in results:
            if isinstance(result, list):
                all_resources.extend(result)
            elif isinstance(result, Exception):
                print(f"VC content search error: {result}")

        return all_resources

    def get_curated_by_vc(self, vc_firm: str) -> List[VCResource]:
        """Get all curated resources from a specific VC."""
        resources = []
        for resource in CURATED_RESOURCES:
            if resource["vc"] == vc_firm:
                vc_info = VC_CONTENT_SOURCES.get(vc_firm, {})
                resources.append(VCResource(
                    vc_firm=vc_info.get("name", vc_firm),
                    resource_type=resource["type"],
                    title=resource["title"],
                    url=resource["url"],
                    relevance_topic=", ".join(resource.get("topics", [])),
                ))
        return resources

    def get_all_curated(self) -> List[VCResource]:
        """Get all curated resources."""
        resources = []
        for resource in CURATED_RESOURCES:
            vc_info = VC_CONTENT_SOURCES.get(resource["vc"], {})
            resources.append(VCResource(
                vc_firm=vc_info.get("name", resource["vc"]),
                resource_type=resource["type"],
                title=resource["title"],
                url=resource["url"],
                relevance_topic=", ".join(resource.get("topics", [])),
            ))
        return resources

    async def close(self):
        await self.search_client.close()
