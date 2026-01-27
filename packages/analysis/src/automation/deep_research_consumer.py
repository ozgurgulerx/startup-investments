"""Deep Research Queue Consumer.

Background worker that processes items from the deep_research_queue table,
performing LLM-based deep analysis of startups.
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from dataclasses import dataclass

from openai import AsyncAzureOpenAI
import os

from .db import DatabaseConnection

logger = logging.getLogger(__name__)


@dataclass
class ResearchResult:
    """Result of a deep research operation."""
    startup_id: str
    startup_name: str
    success: bool
    research_output: Optional[Dict[str, Any]] = None
    tokens_used: int = 0
    cost_usd: float = 0.0
    error: Optional[str] = None
    duration_ms: int = 0


class DeepResearchConsumer:
    """Consumes and processes deep research queue items."""

    # Pricing per 1M tokens (approximate, adjust for your model)
    INPUT_COST_PER_1M = 15.0   # $15 per 1M input tokens
    OUTPUT_COST_PER_1M = 75.0  # $75 per 1M output tokens

    def __init__(
        self,
        db: Optional[DatabaseConnection] = None,
        max_concurrent: int = 3,
        max_retries: int = 3
    ):
        self.db = db or DatabaseConnection()
        self.max_concurrent = max_concurrent
        self.max_retries = max_retries

        # Initialize OpenAI client
        self.client = AsyncAzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version="2024-02-15-preview",
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
        )
        self.model = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")

    async def process_queue(self, batch_size: int = 10) -> List[ResearchResult]:
        """Process a batch of research items from the queue."""
        results = []

        try:
            await self.db.connect()

            # Get pending items
            items = await self.db.get_pending_research_items(limit=batch_size)
            logger.info(f"Found {len(items)} pending research items")

            if not items:
                return results

            # Process with concurrency control
            semaphore = asyncio.Semaphore(self.max_concurrent)

            async def process_with_semaphore(item: Dict[str, Any]) -> ResearchResult:
                async with semaphore:
                    return await self._process_item(item)

            tasks = [process_with_semaphore(item) for item in items]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Convert exceptions to error results
            processed_results = []
            for item, result in zip(items, results):
                if isinstance(result, Exception):
                    processed_results.append(ResearchResult(
                        startup_id=item["startup_id"],
                        startup_name=item.get("startup_name", "Unknown"),
                        success=False,
                        error=str(result)
                    ))
                else:
                    processed_results.append(result)

            return processed_results

        finally:
            await self.db.close()

    async def _process_item(self, item: Dict[str, Any]) -> ResearchResult:
        """Process a single research queue item."""
        start_time = datetime.now(timezone.utc)
        item_id = str(item["id"])
        startup_id = str(item["startup_id"])
        startup_name = item.get("startup_name", "Unknown")

        logger.info(f"Processing research for {startup_name} (depth: {item.get('research_depth', 'standard')})")

        try:
            # Claim the item
            claimed = await self.db.claim_research_item(item_id)
            if not claimed:
                logger.warning(f"Could not claim item {item_id}, skipping")
                return ResearchResult(
                    startup_id=startup_id,
                    startup_name=startup_name,
                    success=False,
                    error="Could not claim item (already processing)"
                )

            # Perform deep research
            research_output, tokens_used = await self._perform_research(item)

            # Calculate cost
            input_tokens = tokens_used.get("input", 0)
            output_tokens = tokens_used.get("output", 0)
            cost_usd = (
                (input_tokens / 1_000_000) * self.INPUT_COST_PER_1M +
                (output_tokens / 1_000_000) * self.OUTPUT_COST_PER_1M
            )

            # Mark completed
            await self.db.complete_research_item(
                item_id=item_id,
                research_output=research_output,
                tokens_used=input_tokens + output_tokens,
                cost_usd=cost_usd
            )

            end_time = datetime.now(timezone.utc)
            duration_ms = int((end_time - start_time).total_seconds() * 1000)

            logger.info(f"Completed research for {startup_name}: {input_tokens + output_tokens} tokens, ${cost_usd:.4f}")

            return ResearchResult(
                startup_id=startup_id,
                startup_name=startup_name,
                success=True,
                research_output=research_output,
                tokens_used=input_tokens + output_tokens,
                cost_usd=cost_usd,
                duration_ms=duration_ms
            )

        except Exception as e:
            logger.error(f"Error processing research for {startup_name}: {e}")

            # Mark as failed
            await self.db.fail_research_item(item_id, str(e))

            # Attempt requeue if under retry limit
            requeued = await self.db.requeue_failed_item(item_id, self.max_retries)
            if requeued:
                logger.info(f"Requeued {startup_name} for retry")

            return ResearchResult(
                startup_id=startup_id,
                startup_name=startup_name,
                success=False,
                error=str(e)
            )

    async def _perform_research(self, item: Dict[str, Any]) -> tuple[Dict[str, Any], Dict[str, int]]:
        """Perform deep research analysis using LLM."""
        startup_name = item.get("startup_name", "Unknown")
        website = item.get("startup_website", "")
        description = item.get("startup_description", "")
        depth = item.get("research_depth", "standard")
        focus_areas = item.get("focus_areas") or []

        # Build research prompt based on depth
        if depth == "quick":
            prompt = self._build_quick_prompt(startup_name, website, description, focus_areas)
        elif depth == "deep":
            prompt = self._build_deep_prompt(startup_name, website, description, focus_areas)
        else:
            prompt = self._build_standard_prompt(startup_name, website, description, focus_areas)

        # Call LLM
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": self._get_system_prompt()},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=4000 if depth == "deep" else 2000
        )

        # Parse response
        content = response.choices[0].message.content
        tokens = {
            "input": response.usage.prompt_tokens,
            "output": response.usage.completion_tokens
        }

        # Structure output
        research_output = {
            "analysis": content,
            "depth": depth,
            "focus_areas": focus_areas,
            "researched_at": datetime.now(timezone.utc).isoformat(),
            "model": self.model
        }

        return research_output, tokens

    def _get_system_prompt(self) -> str:
        return """You are a startup analyst performing deep research on early-stage companies.
Your analysis should be factual, data-driven, and focused on identifying:
1. Technical differentiation and moat potential
2. Market positioning and competitive landscape
3. Team and execution signals
4. Risk factors and concerns
5. Investment thesis strengths and weaknesses

Be specific and cite evidence where possible. Avoid generic statements."""

    def _build_quick_prompt(
        self,
        name: str,
        website: str,
        description: str,
        focus_areas: List[str]
    ) -> str:
        focus_str = f"\n\nFocus specifically on: {', '.join(focus_areas)}" if focus_areas else ""

        return f"""Perform a quick analysis of {name}.

Website: {website}
Description: {description}

Provide a brief (300-400 word) analysis covering:
1. What they do (1-2 sentences)
2. Key differentiator
3. Target market
4. Primary risk factor
{focus_str}"""

    def _build_standard_prompt(
        self,
        name: str,
        website: str,
        description: str,
        focus_areas: List[str]
    ) -> str:
        focus_str = f"\n\nPay special attention to: {', '.join(focus_areas)}" if focus_areas else ""

        return f"""Perform a comprehensive analysis of {name}.

Website: {website}
Description: {description}

Analyze:
1. **Product & Technology**: What they build, technical approach, AI/ML usage
2. **Market Position**: Target market, competitors, positioning
3. **Business Model**: How they make money, pricing strategy
4. **Team & Execution**: Team background signals, hiring patterns
5. **Moat Assessment**: Defensibility, network effects, data advantages
6. **Risk Factors**: Key risks and concerns
7. **Investment Thesis**: Bull case and bear case
{focus_str}

Provide specific evidence for each point."""

    def _build_deep_prompt(
        self,
        name: str,
        website: str,
        description: str,
        focus_areas: List[str]
    ) -> str:
        focus_str = f"\n\nDeep dive specifically into: {', '.join(focus_areas)}" if focus_areas else ""

        return f"""Perform an exhaustive deep-dive analysis of {name}.

Website: {website}
Description: {description}

Provide comprehensive analysis on:

1. **Technical Architecture**
   - Core technology stack and approach
   - AI/ML integration depth and sophistication
   - Scalability and technical debt signals
   - Open source contributions and developer signals

2. **Market Intelligence**
   - Total addressable market and realistic serviceable market
   - Competitive landscape mapping (direct, adjacent, potential)
   - Market timing assessment
   - Regulatory considerations

3. **Business Model Deep Dive**
   - Revenue model mechanics
   - Unit economics indicators
   - Pricing power assessment
   - Customer acquisition signals

4. **Team & Culture**
   - Founding team background and relevant experience
   - Key hires and hiring patterns
   - Culture signals from job postings
   - Advisory board and investors

5. **Moat & Defensibility**
   - Data moat potential
   - Network effects analysis
   - Switching costs
   - Brand and trust building

6. **Growth Signals**
   - Traction indicators
   - Partnership announcements
   - Press coverage patterns
   - Social proof

7. **Risk Assessment**
   - Technical risks
   - Market risks
   - Execution risks
   - Competitive threats

8. **Investment Thesis**
   - Strong bull case with evidence
   - Bear case concerns
   - Key milestones to watch
   - Suggested due diligence questions
{focus_str}

Be thorough and cite specific evidence. This is for investment decision support."""


async def run_consumer(batch_size: int = 10, max_concurrent: int = 3):
    """Run the deep research consumer."""
    consumer = DeepResearchConsumer(max_concurrent=max_concurrent)
    results = await consumer.process_queue(batch_size=batch_size)

    success = sum(1 for r in results if r.success)
    failed = sum(1 for r in results if not r.success)
    total_tokens = sum(r.tokens_used for r in results)
    total_cost = sum(r.cost_usd for r in results)

    logger.info(f"Research batch complete: {success} success, {failed} failed")
    logger.info(f"Total tokens: {total_tokens}, Total cost: ${total_cost:.4f}")

    return results
