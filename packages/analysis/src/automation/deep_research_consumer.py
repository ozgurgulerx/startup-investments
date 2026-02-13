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

from src.config import llm_kwargs

from .db import DatabaseConnection
from .onboarding_trace import classify_research_failure, emit_trace

try:
    from azure.identity import DefaultAzureCredential, get_bearer_token_provider
except Exception:  # pragma: no cover - optional in local/dev installs
    DefaultAzureCredential = None
    get_bearer_token_provider = None

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

    # Model pricing per 1M tokens — keyed by model/deployment name
    MODEL_PRICING = {
        "gpt-5-nano":  {"input": 0.10,  "output": 0.40},
        "gpt-4o":      {"input": 2.50,  "output": 10.0},
        "gpt-4o-mini": {"input": 0.15,  "output": 0.60},
        "gpt-4":       {"input": 30.0,  "output": 60.0},
        "gpt-4-turbo": {"input": 10.0,  "output": 30.0},
    }

    def __init__(
        self,
        db: Optional[DatabaseConnection] = None,
        max_concurrent: int = 3,
        max_retries: int = 3
    ):
        self.db = db or DatabaseConnection()
        self.max_concurrent = max_concurrent
        self.max_retries = max_retries
        self.enabled = self._env_bool("DEEP_RESEARCH_ENABLED", True)
        self.max_daily_usd = self._env_float("DEEP_RESEARCH_MAX_DAILY_USD", 15.0)
        self.max_monthly_usd = self._env_float("DEEP_RESEARCH_MAX_MONTHLY_USD", 300.0)
        self.max_items_per_run = max(1, self._env_int("DEEP_RESEARCH_MAX_ITEMS_PER_RUN", 8))

        # Initialize Azure OpenAI client:
        # prefer AAD/managed identity, fall back to API key if provided.
        self.azure_openai_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        self.azure_openai_api_key = os.getenv("AZURE_OPENAI_API_KEY")
        self.azure_openai_api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
        self.client = None
        if AsyncAzureOpenAI is not None and self.azure_openai_endpoint:
            if DefaultAzureCredential is not None and get_bearer_token_provider is not None:
                try:
                    credential = DefaultAzureCredential()
                    token_provider = get_bearer_token_provider(
                        credential, "https://cognitiveservices.azure.com/.default"
                    )
                    self.client = AsyncAzureOpenAI(
                        azure_ad_token_provider=token_provider,
                        api_version=self.azure_openai_api_version,
                        azure_endpoint=self.azure_openai_endpoint,
                    )
                    logger.info("Deep research Azure client configured via AAD")
                except Exception as exc:
                    logger.warning("Deep research AAD init failed, trying API key fallback: %s", exc)
            if self.client is None and self.azure_openai_api_key:
                self.client = AsyncAzureOpenAI(
                    api_key=self.azure_openai_api_key,
                    api_version=self.azure_openai_api_version,
                    azure_endpoint=self.azure_openai_endpoint,
                )
        # Azure uses deployment names; prefer *_DEPLOYMENT_NAME but keep legacy var.
        self.model = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME") or os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5-nano")

    @staticmethod
    def _env_bool(name: str, default: bool) -> bool:
        raw = str(os.getenv(name, "") or "").strip().lower()
        if not raw:
            return default
        return raw in {"1", "true", "yes", "on"}

    @staticmethod
    def _env_int(name: str, default: int) -> int:
        raw = str(os.getenv(name, "") or "").strip()
        if not raw:
            return default
        try:
            return int(raw)
        except Exception:
            return default

    @staticmethod
    def _env_float(name: str, default: float) -> float:
        raw = str(os.getenv(name, "") or "").strip()
        if not raw:
            return default
        try:
            return float(raw)
        except Exception:
            return default

    async def _budget_state(self) -> Dict[str, float]:
        spend = await self.db.get_research_spend()
        daily = float(spend.get("daily_usd") or 0.0)
        monthly = float(spend.get("monthly_usd") or 0.0)
        return {
            "daily_usd": daily,
            "monthly_usd": monthly,
            "daily_remaining": self.max_daily_usd - daily,
            "monthly_remaining": self.max_monthly_usd - monthly,
        }

    def _budget_allows_processing(self, budget: Dict[str, float]) -> bool:
        return budget["daily_remaining"] > 0 and budget["monthly_remaining"] > 0

    async def process_queue(self, batch_size: int = 10) -> List[ResearchResult]:
        """Process a batch of research items from the queue."""
        results = []
        if not self.enabled:
            logger.info("Deep research consumer disabled (DEEP_RESEARCH_ENABLED=false)")
            return results
        if self.client is None:
            logger.warning(
                "Deep research consumer enabled but Azure client is unavailable "
                "(set AZURE_OPENAI_ENDPOINT and either AAD identity or AZURE_OPENAI_API_KEY)"
            )
            try:
                await self.db.connect()
                await emit_trace(
                    self.db,
                    startup_id=None,
                    queue_item_id=None,
                    trace_type="deep_research",
                    stage="deep_research_failed_actionable",
                    status="failure",
                    severity="critical",
                    reason_code="missing_openai_credentials",
                    message="Deep research client unavailable due to missing Azure OpenAI credentials.",
                    payload={
                        "has_endpoint": bool(self.azure_openai_endpoint),
                        "has_api_key": bool(self.azure_openai_api_key),
                    },
                    dedupe_key=f"deep_research_client_unavailable:{datetime.now(timezone.utc).strftime('%Y-%m-%d-%H')}",
                    should_notify=True,
                )
            except Exception:
                logger.debug("Could not write deep research credential trace", exc_info=True)
            finally:
                try:
                    await self.db.close()
                except Exception:
                    pass
            return results

        try:
            await self.db.connect()

            # Reclaim items stuck in 'processing' for >30 minutes (crash recovery)
            await self._reclaim_stale_items(stale_minutes=30)

            budget = await self._budget_state()
            if not self._budget_allows_processing(budget):
                logger.warning(
                    "Deep research budget reached (daily=%.4f/%.4f monthly=%.4f/%.4f); skipping run",
                    budget["daily_usd"], self.max_daily_usd,
                    budget["monthly_usd"], self.max_monthly_usd,
                )
                return results

            # Get pending items
            effective_batch = min(max(1, int(batch_size)), self.max_items_per_run)
            items = await self.db.get_pending_research_items(limit=effective_batch)
            logger.info(f"Found {len(items)} pending research items")

            if not items:
                return results

            processed_results = []
            for item in items:
                budget = await self._budget_state()
                if not self._budget_allows_processing(budget):
                    logger.warning(
                        "Stopping run due to budget cap (daily=%.4f/%.4f monthly=%.4f/%.4f)",
                        budget["daily_usd"], self.max_daily_usd,
                        budget["monthly_usd"], self.max_monthly_usd,
                    )
                    break
                try:
                    result = await self._process_item(item)
                except Exception as exc:
                    result = ResearchResult(
                        startup_id=str(item.get("startup_id") or ""),
                        startup_name=item.get("startup_name", "Unknown"),
                        success=False,
                        error=str(exc),
                    )
                processed_results.append(result)

            return processed_results

        finally:
            await self.db.close()

    async def _reclaim_stale_items(self, stale_minutes: int = 30):
        """Reclaim research items stuck in 'processing' state (crash recovery).

        Items claimed by a worker that crashed remain in 'processing' forever.
        This resets them to 'pending' so they can be picked up again.
        """
        try:
            result = await self.db.execute("""
                UPDATE deep_research_queue
                SET status = 'pending',
                    started_at = NULL,
                    retry_count = COALESCE(retry_count, 0) + 1
                WHERE status = 'processing'
                  AND started_at < NOW() - INTERVAL '1 minute' * $1
                  AND COALESCE(retry_count, 0) < $2
            """, stale_minutes, self.max_retries)
            # Log if items were reclaimed (result is the command tag like "UPDATE 2")
            if result and not result.endswith("0"):
                logger.info(f"Reclaimed stale research items: {result}")
        except Exception as e:
            logger.warning(f"Could not reclaim stale items: {e}")

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

            await emit_trace(
                self.db,
                startup_id=startup_id,
                queue_item_id=item_id,
                trace_type="deep_research",
                stage="deep_research_started",
                status="info",
                severity="info",
                reason_code=str(item.get("reason") or ""),
                message=f"Deep research started for {startup_name}",
                payload={
                    "startup_name": startup_name,
                    "research_depth": item.get("research_depth", "standard"),
                    "retry_count": int(item.get("retry_count") or 0),
                },
                dedupe_key=f"deep_research_started:{item_id}",
                should_notify=False,
            )

            try:
                context_entries = await self.db.get_recent_onboarding_context(startup_id, limit=5)
            except Exception:
                context_entries = []
                logger.debug("Could not load onboarding context for %s", startup_id, exc_info=True)

            # Perform deep research
            research_output, tokens_used = await self._perform_research(item, context_entries=context_entries)

            # Calculate cost using model-specific pricing
            input_tokens = tokens_used.get("input", 0)
            output_tokens = tokens_used.get("output", 0)
            pricing = self.MODEL_PRICING.get(self.model, {"input": 2.50, "output": 10.0})
            cost_usd = (
                (input_tokens / 1_000_000) * pricing["input"] +
                (output_tokens / 1_000_000) * pricing["output"]
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
            await emit_trace(
                self.db,
                startup_id=startup_id,
                queue_item_id=item_id,
                trace_type="deep_research",
                stage="deep_research_completed",
                status="success",
                severity="info",
                reason_code=str(item.get("reason") or ""),
                message=f"Deep research completed for {startup_name}",
                payload={
                    "startup_name": startup_name,
                    "tokens_used": input_tokens + output_tokens,
                    "cost_usd": round(cost_usd, 6),
                    "duration_ms": duration_ms,
                    "context_entries_used": len(context_entries),
                },
                dedupe_key=f"deep_research_completed:{item_id}",
                should_notify=True,
            )

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
            retry_count = int(item.get("retry_count") or 0)
            classification = classify_research_failure(
                str(e),
                retry_count=retry_count,
                max_retries=self.max_retries,
            )

            # Mark as failed
            await self.db.fail_research_item(item_id, str(e))

            # Attempt requeue if under retry limit
            requeued = await self.db.requeue_failed_item(item_id, self.max_retries)
            if requeued:
                logger.info(f"Requeued {startup_name} for retry")

            stage = (
                "deep_research_failed_actionable"
                if classification.get("actionable")
                else "deep_research_failed_non_actionable"
            )
            await emit_trace(
                self.db,
                startup_id=startup_id,
                queue_item_id=item_id,
                trace_type="deep_research",
                stage=stage,
                status="failure",
                severity=str(classification.get("severity") or "warning"),
                reason_code=str(classification.get("reason_code") or "generic_failure"),
                message=f"Deep research failed for {startup_name}: {e}",
                payload={
                    "startup_name": startup_name,
                    "error": str(e),
                    "retry_count": retry_count,
                    "max_retries": self.max_retries,
                    "requeued": bool(requeued),
                },
                dedupe_key=f"deep_research_failed:{item_id}:{retry_count + 1}",
                should_notify=bool(classification.get("actionable")),
            )

            return ResearchResult(
                startup_id=startup_id,
                startup_name=startup_name,
                success=False,
                error=str(e)
            )

    async def _perform_research(
        self,
        item: Dict[str, Any],
        context_entries: Optional[List[Dict[str, Any]]] = None,
    ) -> tuple[Dict[str, Any], Dict[str, int]]:
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

        context_block = self._build_human_context_block(context_entries or [])
        if context_block:
            prompt = f"{prompt}\n\n{context_block}"

        # Call LLM with timeout to prevent hung slots
        try:
            response = await asyncio.wait_for(
                self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": self._get_system_prompt()},
                        {"role": "user", "content": prompt}
                    ],
                    **llm_kwargs(self.model, max_tokens=4000 if depth == "deep" else 2000, temperature=0.3),
                ),
                timeout=180.0  # 3 minutes max per LLM call
            )
        except asyncio.TimeoutError:
            raise TimeoutError(f"OpenAI API call timed out after 180s for {startup_name}")

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
            "human_context_used": len(context_entries or []),
            "researched_at": datetime.now(timezone.utc).isoformat(),
            "model": self.model
        }

        return research_output, tokens

    def _build_human_context_block(self, context_entries: List[Dict[str, Any]]) -> str:
        if not context_entries:
            return ""
        lines: List[str] = [
            "Operator-provided context (highest priority, most recent first):",
        ]
        for idx, row in enumerate(context_entries[:5], start=1):
            text = str(row.get("context_text") or "").strip()
            if not text:
                continue
            source = str(row.get("source") or "unknown")
            lines.append(f"{idx}. [{source}] {text[:1200]}")
        if len(lines) == 1:
            return ""
        lines.append("Use this context when it improves precision and clearly separate assumptions from facts.")
        return "\n".join(lines)

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
