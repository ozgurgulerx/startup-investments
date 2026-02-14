"""Investor onboarding consumer.

Consumes investor_onboarding_queue items and enriches investor profiles:
- website, type, HQ country
- structured profile_json (summary + focus areas)

Designed to mirror deep_research_consumer.py patterns:
- budget caps (daily/monthly)
- AAD-first Azure OpenAI auth (managed identity), API-key fallback
- trace events for Slack/ops via onboarding_trace.emit_trace
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

try:
    from openai import AsyncAzureOpenAI
    _OPENAI_IMPORT_ERROR: Optional[str] = None
except Exception as exc:  # pragma: no cover - optional in some environments
    AsyncAzureOpenAI = None  # type: ignore[assignment]
    _OPENAI_IMPORT_ERROR = str(exc)

try:
    from azure.identity import DefaultAzureCredential, get_bearer_token_provider
except Exception:  # pragma: no cover - optional in local/dev installs
    DefaultAzureCredential = None
    get_bearer_token_provider = None

from src.config import llm_kwargs

from .db import DatabaseConnection
from .onboarding_trace import classify_research_failure, emit_trace
from .topic_researcher import search_multiple, fetch_articles

logger = logging.getLogger(__name__)


@dataclass
class InvestorOnboardingResult:
    investor_id: str
    investor_name: str
    success: bool
    tokens_used: int = 0
    cost_usd: float = 0.0
    error: Optional[str] = None
    duration_ms: int = 0


def _env_bool(name: str, default: bool) -> bool:
    raw = str(os.getenv(name, "") or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    """Best-effort JSON extraction from model output."""
    raw = (text or "").strip()
    if not raw:
        return None
    # Strip Markdown fences if present.
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE).strip()
    raw = re.sub(r"\s*```$", "", raw).strip()
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass
    # Fallback: substring between first '{' and last '}'.
    try:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            candidate = raw[start : end + 1]
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None
    return None


def _normalize_website(url: Optional[str]) -> Optional[str]:
    v = (url or "").strip()
    if not v:
        return None
    if not re.match(r"^https?://", v, flags=re.IGNORECASE):
        v = "https://" + v.lstrip("/")
    return v[:500]


class InvestorOnboardingConsumer:
    # Model pricing per 1M tokens — keyed by model/deployment name.
    MODEL_PRICING = {
        "gpt-5-nano": {"input": 0.10, "output": 0.40},
        "gpt-4o": {"input": 2.50, "output": 10.0},
        "gpt-4o-mini": {"input": 0.15, "output": 0.60},
        "gpt-4": {"input": 30.0, "output": 60.0},
        "gpt-4-turbo": {"input": 10.0, "output": 30.0},
    }

    def __init__(
        self,
        db: Optional[DatabaseConnection] = None,
        max_concurrent: int = 3,
        max_retries: int = 3,
    ) -> None:
        self.db = db or DatabaseConnection()
        self.max_concurrent = max(1, int(max_concurrent))
        self.max_retries = max(1, int(max_retries))

        self.enabled = _env_bool("INVESTOR_ONBOARDING_ENABLED", False)
        self.max_items_per_run = max(1, _env_int("INVESTOR_ONBOARDING_MAX_ITEMS_PER_RUN", 10))
        self.max_daily_usd = _env_float("INVESTOR_ONBOARDING_MAX_DAILY_USD", 10.0)
        self.max_monthly_usd = _env_float("INVESTOR_ONBOARDING_MAX_MONTHLY_USD", 200.0)

        # Initialize Azure OpenAI client (AAD preferred, API key fallback).
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
                    logger.info("Investor onboarding Azure client configured via AAD")
                except Exception as exc:
                    logger.warning("Investor onboarding AAD init failed, trying API key fallback: %s", exc)
            if self.client is None and self.azure_openai_api_key:
                self.client = AsyncAzureOpenAI(
                    api_key=self.azure_openai_api_key,
                    api_version=self.azure_openai_api_version,
                    azure_endpoint=self.azure_openai_endpoint,
                )

        # Azure uses deployment names; prefer *_DEPLOYMENT_NAME but keep legacy var.
        self.model = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME") or os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5-nano")

    async def _budget_state(self) -> Dict[str, float]:
        spend = await self.db.get_investor_onboarding_spend()
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

    async def process_queue(self, batch_size: int = 10) -> List[InvestorOnboardingResult]:
        results: List[InvestorOnboardingResult] = []
        if not self.enabled:
            logger.info("Investor onboarding consumer disabled (INVESTOR_ONBOARDING_ENABLED=false)")
            return results

        if self.client is None:
            # Emit actionable trace (best-effort) to unblock operators.
            reason_code = "missing_openai_credentials"
            trace_message = "Investor onboarding client unavailable due to missing Azure OpenAI credentials."
            extra_payload = {
                "has_endpoint": bool(self.azure_openai_endpoint),
                "has_api_key": bool(self.azure_openai_api_key),
            }
            if AsyncAzureOpenAI is None:
                reason_code = "missing_openai_library"
                trace_message = "Investor onboarding client unavailable because python `openai` package is missing."
                extra_payload = {"openai_import_error": _OPENAI_IMPORT_ERROR}
            try:
                await self.db.connect()
                await emit_trace(
                    self.db,
                    startup_id=None,
                    investor_id=None,
                    queue_item_id=None,
                    investor_queue_item_id=None,
                    trace_type="investor_onboarding",
                    stage="investor_onboarding_failed_actionable",
                    status="failure",
                    severity="critical",
                    reason_code=reason_code,
                    message=trace_message,
                    payload=extra_payload,
                    dedupe_key=f"investor_onboarding_client_unavailable:{datetime.now(timezone.utc).strftime('%Y-%m-%d-%H')}",
                    should_notify=True,
                )
            except Exception:
                logger.debug("Could not write investor onboarding credential trace", exc_info=True)
            finally:
                try:
                    await self.db.close()
                except Exception:
                    pass
            return results

        try:
            await self.db.connect()
            await self.db.reclaim_stale_investor_onboarding_items(stale_minutes=30)

            budget = await self._budget_state()
            if not self._budget_allows_processing(budget):
                logger.warning(
                    "Investor onboarding budget reached (daily=%.4f/%.4f monthly=%.4f/%.4f); skipping run",
                    budget["daily_usd"],
                    self.max_daily_usd,
                    budget["monthly_usd"],
                    self.max_monthly_usd,
                )
                return results

            effective_batch = min(max(1, int(batch_size)), self.max_items_per_run)
            items = await self.db.get_pending_investor_onboarding_items(limit=effective_batch)
            logger.info("Found %d pending investor onboarding items", len(items))
            if not items:
                return results

            sem = asyncio.Semaphore(self.max_concurrent)

            async def _process_one(item: Dict[str, Any]) -> None:
                async with sem:
                    res = await self._process_item(item)
                    results.append(res)

            await asyncio.gather(*[_process_one(it) for it in items])
            return results
        finally:
            try:
                await self.db.close()
            except Exception:
                pass

    async def _process_item(self, item: Dict[str, Any]) -> InvestorOnboardingResult:
        started = datetime.now(timezone.utc)
        item_id = str(item.get("id") or "")
        investor_id = str(item.get("investor_id") or "")
        investor_name = str(item.get("investor_name") or "Unknown investor")
        retry_count = int(item.get("retry_count") or 0)

        if not item_id or not investor_id:
            return InvestorOnboardingResult(
                investor_id=investor_id or "missing",
                investor_name=investor_name,
                success=False,
                error="Missing queue item id or investor_id",
            )

        claimed = await self.db.claim_investor_onboarding_item(item_id)
        if not claimed:
            return InvestorOnboardingResult(
                investor_id=investor_id,
                investor_name=investor_name,
                success=False,
                error="Not claimed (already in progress)",
            )

        await emit_trace(
            self.db,
            startup_id=None,
            investor_id=investor_id,
            queue_item_id=None,
            investor_queue_item_id=item_id,
            trace_type="investor_onboarding",
            stage="claimed",
            status="info",
            severity="info",
            reason_code=str(item.get("reason") or ""),
            message=f"Investor onboarding claimed: {investor_name}",
            payload={"investor_id": investor_id, "queue_item_id": item_id},
            dedupe_key=f"investor_onboarding_claimed:{item_id}",
            should_notify=False,
        )

        try:
            context_entries = []
            try:
                context_entries = await self.db.get_recent_investor_onboarding_context(investor_id, limit=5)
            except Exception:
                context_entries = []

            enrichment, tokens = await self._enrich_investor(item, context_entries=context_entries)
            tokens_used = int(tokens.get("input", 0) + tokens.get("output", 0))
            cost_usd = float(self._estimate_cost(tokens))

            # Persist profile data (best-effort; do not overwrite stronger existing fields).
            await self._persist_profile(investor_id, enrichment)
            await self.db.complete_investor_onboarding_item(
                item_id,
                enrichment_output=enrichment,
                tokens_used=tokens_used,
                cost_usd=cost_usd,
            )

            await emit_trace(
                self.db,
                startup_id=None,
                investor_id=investor_id,
                queue_item_id=None,
                investor_queue_item_id=item_id,
                trace_type="investor_onboarding",
                stage="completed",
                status="success",
                severity="info",
                reason_code=str(item.get("reason") or ""),
                message=f"Investor onboarding completed: {investor_name}",
                payload={
                    "investor_id": investor_id,
                    "queue_item_id": item_id,
                    "model": self.model,
                    "tokens": tokens,
                    "cost_usd": cost_usd,
                },
                dedupe_key=f"investor_onboarding_completed:{item_id}",
                should_notify=False,
            )

            duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
            return InvestorOnboardingResult(
                investor_id=investor_id,
                investor_name=investor_name,
                success=True,
                tokens_used=tokens_used,
                cost_usd=cost_usd,
                duration_ms=duration_ms,
            )
        except Exception as exc:
            err = str(exc)
            await self.db.fail_investor_onboarding_item(item_id, err)

            classification = classify_research_failure(
                err, retry_count=retry_count, max_retries=self.max_retries
            )
            requeued = await self.db.requeue_failed_investor_onboarding_item(item_id, self.max_retries)

            stage = (
                "investor_onboarding_failed_actionable"
                if classification.get("actionable")
                else "investor_onboarding_failed_non_actionable"
            )
            await emit_trace(
                self.db,
                startup_id=None,
                investor_id=investor_id,
                queue_item_id=None,
                investor_queue_item_id=item_id,
                trace_type="investor_onboarding",
                stage=stage,
                status="failure",
                severity=str(classification.get("severity") or "warning"),
                reason_code=str(classification.get("reason_code") or "generic_failure"),
                message=f"Investor onboarding failed for {investor_name}: {err}",
                payload={
                    "investor_id": investor_id,
                    "queue_item_id": item_id,
                    "error": err,
                    "retry_count": retry_count,
                    "max_retries": self.max_retries,
                    "requeued": bool(requeued),
                },
                dedupe_key=f"investor_onboarding_failed:{item_id}:{retry_count + 1}",
                should_notify=bool(classification.get("actionable")),
            )

            duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
            return InvestorOnboardingResult(
                investor_id=investor_id,
                investor_name=investor_name,
                success=False,
                error=err,
                duration_ms=duration_ms,
            )

    def _estimate_cost(self, tokens: Dict[str, int]) -> float:
        pricing = self.MODEL_PRICING.get(self.model, {"input": 0.0, "output": 0.0})
        in_cost = (float(tokens.get("input", 0) or 0) / 1_000_000.0) * float(pricing.get("input", 0.0))
        out_cost = (float(tokens.get("output", 0) or 0) / 1_000_000.0) * float(pricing.get("output", 0.0))
        return round(in_cost + out_cost, 6)

    async def _enrich_investor(
        self,
        item: Dict[str, Any],
        *,
        context_entries: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        investor_name = str(item.get("investor_name") or "Unknown investor")
        existing_website = str(item.get("investor_website") or "").strip()
        existing_type = str(item.get("investor_type") or "").strip()
        existing_hq = str(item.get("investor_hq_country") or "").strip()
        seed_urls = list(item.get("seed_urls") or [])

        queries = [
            f"\"{investor_name}\" venture capital firm website",
            f"\"{investor_name}\" portfolio",
            f"\"{investor_name}\" headquarters",
        ]
        if seed_urls:
            # Replace the least specific query with a seed-driven query when available.
            queries[-1] = f"\"{investor_name}\" {seed_urls[0]}"

        async with httpx.AsyncClient(timeout=15.0) as client:
            search_results = await search_multiple(client, queries, results_per_query=5, max_results=8)
            articles = await fetch_articles(client, search_results, max_articles=5, timeout=10.0)

        prompt = self._build_prompt(
            investor_name=investor_name,
            existing_website=existing_website,
            existing_type=existing_type,
            existing_hq=existing_hq,
            seed_urls=seed_urls,
            context_entries=context_entries or [],
            articles=articles,
        )

        response = await asyncio.wait_for(
            self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._system_prompt()},
                    {"role": "user", "content": prompt},
                ],
                **llm_kwargs(self.model, max_tokens=1200, temperature=0.2),
            ),
            timeout=120.0,
        )

        content = (response.choices[0].message.content or "").strip()
        tokens = {
            "input": int(getattr(response.usage, "prompt_tokens", 0) or 0),
            "output": int(getattr(response.usage, "completion_tokens", 0) or 0),
        }

        parsed = _extract_json(content)
        if not parsed:
            raise ValueError("Model output was not valid JSON")

        website = _normalize_website(parsed.get("website"))
        investor_type = str(parsed.get("investor_type") or parsed.get("type") or "").strip() or None
        hq_country = str(parsed.get("headquarters_country") or parsed.get("hq_country") or "").strip() or None

        # Keep a structured profile blob; do not assume any downstream schema.
        profile_json = {
            "summary": str(parsed.get("summary") or "").strip()[:1200],
            "focus": parsed.get("focus") or {},
            "signals": parsed.get("signals") or {},
            "confidence": parsed.get("confidence") or {},
            "source_urls": parsed.get("source_urls") or parsed.get("sources") or [],
            "searched_at": datetime.now(timezone.utc).isoformat(),
        }

        enrichment: Dict[str, Any] = {
            "website": website,
            "investor_type": investor_type,
            "headquarters_country": hq_country,
            "profile_json": profile_json,
            "source_urls": list(profile_json.get("source_urls") or [])[:25],
            "model": self.model,
            "raw": parsed,
        }
        return enrichment, tokens

    def _system_prompt(self) -> str:
        return (
            "You are an analyst building a structured investor profile for a venture investor. "
            "You must be precise, avoid hallucinations, and only claim facts supported by the provided sources. "
            "Return strict JSON only. No markdown."
        )

    def _build_prompt(
        self,
        *,
        investor_name: str,
        existing_website: str,
        existing_type: str,
        existing_hq: str,
        seed_urls: List[str],
        context_entries: List[Dict[str, Any]],
        articles: List[Any],
    ) -> str:
        ctx_lines: List[str] = []
        for idx, row in enumerate(context_entries[:5], start=1):
            text = str(row.get("context_text") or "").strip()
            if not text:
                continue
            source = str(row.get("source") or "unknown")
            ctx_lines.append(f"{idx}. [{source}] {text[:1000]}")
        ctx_block = "\n".join(ctx_lines) if ctx_lines else ""

        article_blocks: List[str] = []
        for a in (articles or [])[:5]:
            url = str(getattr(a, "url", "") or "")
            title = str(getattr(a, "title", "") or "")
            text = str(getattr(a, "text", "") or "")
            article_blocks.append(
                "\n".join(
                    [
                        f"URL: {url}",
                        f"TITLE: {title[:200]}",
                        f"TEXT: {text[:2000]}",
                    ]
                )
            )

        payload = {
            "investor_name": investor_name,
            "existing": {
                "website": existing_website or None,
                "type": existing_type or None,
                "headquarters_country": existing_hq or None,
            },
            "seed_urls": seed_urls[:10],
            "operator_context": ctx_block or None,
            "articles": article_blocks,
        }

        schema_desc = {
            "website": "string or null (official investor firm website)",
            "investor_type": "string or null (VC, angel, corporate, fund, accelerator, etc.)",
            "headquarters_country": "string or null",
            "summary": "string (<=600 chars)",
            "focus": {"stages": ["..."], "sectors": ["..."], "geographies": ["..."]},
            "signals": {"notable_portfolio": ["..."], "notable_partners": ["..."]},
            "source_urls": ["..."],
            "confidence": {"website": 0.0, "investor_type": 0.0, "headquarters_country": 0.0},
        }

        return "\n\n".join(
            [
                "Build an investor profile from the provided sources and context.",
                "Return strict JSON with exactly these keys:",
                json.dumps(schema_desc, ensure_ascii=True),
                "",
                "Rules:",
                "- Prefer the official firm website if clearly supported.",
                "- If a field is uncertain, return null and set low confidence for that field.",
                "- source_urls must be a subset of the provided URLs.",
                "",
                "INPUT:",
                json.dumps(payload, ensure_ascii=True),
            ]
        )

    async def _persist_profile(self, investor_id: str, enrichment: Dict[str, Any]) -> None:
        """Persist investor_profiles and update investors table conservatively."""
        website = _normalize_website(enrichment.get("website"))
        investor_type = (enrichment.get("investor_type") or None)
        hq_country = (enrichment.get("headquarters_country") or None)
        profile_json = enrichment.get("profile_json") or {}
        source_urls = enrichment.get("source_urls") or []

        async with self.db.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO investor_profiles (
                    investor_id,
                    website,
                    headquarters_country,
                    investor_type,
                    profile_json,
                    source_urls,
                    last_enriched_at,
                    enrichment_model,
                    enrichment_version,
                    created_at,
                    updated_at
                )
                VALUES (
                    $1::uuid,
                    $2,
                    $3,
                    $4,
                    $5::jsonb,
                    $6::text[],
                    NOW(),
                    $7,
                    $8,
                    NOW(),
                    NOW()
                )
                ON CONFLICT (investor_id)
                DO UPDATE SET
                  website = COALESCE(EXCLUDED.website, investor_profiles.website),
                  headquarters_country = COALESCE(EXCLUDED.headquarters_country, investor_profiles.headquarters_country),
                  investor_type = COALESCE(EXCLUDED.investor_type, investor_profiles.investor_type),
                  profile_json = investor_profiles.profile_json || EXCLUDED.profile_json,
                  source_urls = CASE
                    WHEN array_length(EXCLUDED.source_urls, 1) IS NULL THEN investor_profiles.source_urls
                    WHEN array_length(EXCLUDED.source_urls, 1) = 0 THEN investor_profiles.source_urls
                    ELSE EXCLUDED.source_urls
                  END,
                  last_enriched_at = NOW(),
                  enrichment_model = EXCLUDED.enrichment_model,
                  enrichment_version = EXCLUDED.enrichment_version,
                  updated_at = NOW()
                """,
                investor_id,
                website,
                hq_country,
                investor_type,
                json.dumps(profile_json),
                list(source_urls)[:50],
                self.model,
                "investor_onboarding_v1",
            )

            # Update base investors table conservatively (avoid overwriting curated fields).
            await conn.execute(
                """
                UPDATE investors
                SET
                  website = COALESCE(NULLIF(investors.website, ''), $2),
                  type = CASE
                    WHEN investors.type IS NULL OR btrim(investors.type) = '' OR lower(btrim(investors.type)) IN ('unknown', 'n/a', 'na')
                      THEN $3
                    ELSE investors.type
                  END,
                  headquarters_country = COALESCE(NULLIF(investors.headquarters_country, ''), $4)
                WHERE id = $1::uuid
                """,
                investor_id,
                website,
                investor_type,
                hq_country,
            )


async def run_consumer(batch_size: int = 10, max_concurrent: int = 3) -> List[InvestorOnboardingResult]:
    consumer = InvestorOnboardingConsumer(max_concurrent=max_concurrent)
    results = await consumer.process_queue(batch_size=batch_size)

    success = sum(1 for r in results if r.success)
    failed = sum(1 for r in results if not r.success)
    total_tokens = sum(int(r.tokens_used or 0) for r in results)
    total_cost = sum(float(r.cost_usd or 0.0) for r in results)

    logger.info("Investor onboarding batch complete: %d success, %d failed", success, failed)
    logger.info("Investor onboarding totals: tokens=%d cost=$%.4f", total_tokens, total_cost)
    return results
