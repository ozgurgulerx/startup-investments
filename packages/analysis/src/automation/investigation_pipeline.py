"""Investigation pipeline — deep-research paywalled headline seeds from public sources.

Architecture:
  Seed Script (hourly :10)          Investigation Worker (every 2h at :50)
  ─────────────────────             ──────────────────────────────────────
  scrape paid headlines ──▶         1. triage_headlines (LLM batch: AI-relevant?)
  paid_headline_seeds               2. enqueue triaged seeds → investigation_queue
                                    3. investigate: DuckDuckGo + article fetch + LLM synthesis
                                    4. quality gate → promote to news_clusters (story_type='investigation')
                                    5. recheck_corroboration every 6h for 48h

Seeds that pass triage but lack open-web corroboration get deep-researched from
public sources and surfaced as "Signal Watch" cards in the news feed.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import httpx

try:
    import asyncpg
except Exception:  # pragma: no cover
    asyncpg = None

try:
    from openai import AsyncAzureOpenAI
except Exception:  # pragma: no cover
    AsyncAzureOpenAI = None

try:
    from azure.identity import DefaultAzureCredential, get_bearer_token_provider
except Exception:  # pragma: no cover
    DefaultAzureCredential = None
    get_bearer_token_provider = None

# Reuse helpers from sibling modules (available at runtime)
from .topic_researcher import (
    SearchResult,
    ArticleContent,
    search_multiple,
    fetch_articles,
)
from .news_ingest import (
    build_paid_headline_search_query,
    _env_bool,
    _env_int,
)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class InvestigationResult:
    enhanced_summary: str
    key_findings: List[str]
    entity_context: Dict[str, Any]
    builder_implications: str
    sources_used: List[Dict[str, str]]
    social_signals: Dict[str, Any]
    quality_score: float = 0.0
    quality_reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "enhanced_summary": self.enhanced_summary,
            "key_findings": self.key_findings,
            "entity_context": self.entity_context,
            "builder_implications": self.builder_implications,
            "sources_used": self.sources_used,
            "social_signals": self.social_signals,
            "quality_score": self.quality_score,
            "quality_reason": self.quality_reason,
            "researched_at": datetime.now(timezone.utc).isoformat(),
        }


# ---------------------------------------------------------------------------
# LLM prompts
# ---------------------------------------------------------------------------

_TRIAGE_PROMPT = """\
You are an AI startup intelligence analyst. Given a batch of headlines from a \
technology publication, score each headline for relevance to:
- AI investment / funding rounds
- AI build patterns (new models, infrastructure, developer tools)
- AI research or strategy (policy, competitive moves, industry shifts)

For each headline, return a JSON object with:
- "index" (int, 0-based position in the input list)
- "score" (int: 0=irrelevant, 1=maybe, 2=relevant, 3=high-priority)
- "reason" (string, <=60 chars explaining the score)
- "entities" (array of key entity names mentioned)
- "topic_tags" (array of 1-3 topic tags from: ai, funding, launch, regulation, \
infrastructure, developer_tools, research, strategy, competition)

Return a JSON object with key "results" containing an array of these objects.
Only include headlines that appear in the input."""

_INVESTIGATION_PROMPT = """\
You are a senior technology analyst producing an investigation brief for startup \
builders and investors. You are researching a topic based on a headline from a \
paywalled source. You have NOT read the paywalled article — you are synthesizing \
from independent public sources only.

Given the headline context and web research articles, produce an independent analysis.

Return strict JSON with ALL of these keys:
- enhanced_summary (<=300 chars, what the public evidence reveals about this topic)
- key_findings (array of 3-5 bullet strings from web research, each <=120 chars)
- entity_context (object: key=entity_name, value=string describing what's known)
- builder_implications (<=200 chars, how this affects startup builders)
- sources_used (array of {url, title} objects for articles actually referenced)

Do NOT speculate about paywalled content. Focus only on what public sources reveal.
No prose outside JSON."""


# ---------------------------------------------------------------------------
# InvestigationPipeline
# ---------------------------------------------------------------------------

class InvestigationPipeline:
    """Triages paid headline seeds and deep-researches qualifying ones."""

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or os.getenv("DATABASE_URL")
        if not self.database_url:
            raise RuntimeError("DATABASE_URL is required")
        if asyncpg is None:
            raise RuntimeError("asyncpg is required")

        self.pool: Optional[asyncpg.Pool] = None

        # Azure OpenAI setup (mirrors TopicResearcher pattern)
        self.azure_openai_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
        self.azure_openai_deployment = (
            os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
            or os.getenv("AZURE_OPENAI_DEPLOYMENT")
            or "gpt-5-nano"
        )
        self.azure_openai_fallback_deployment = (
            os.getenv("AZURE_OPENAI_FALLBACK_DEPLOYMENT_NAME") or "gpt-5-nano"
        )
        self.azure_openai_api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01")
        self.azure_openai_api_key = os.getenv("AZURE_OPENAI_API_KEY", "")

        self.azure_client: Optional[Any] = None
        if AsyncAzureOpenAI is not None and self.azure_openai_endpoint:
            if DefaultAzureCredential is not None:
                _credential = DefaultAzureCredential()
                _token_provider = get_bearer_token_provider(
                    _credential, "https://cognitiveservices.azure.com/.default"
                )
                self.azure_client = AsyncAzureOpenAI(
                    azure_ad_token_provider=_token_provider,
                    api_version=self.azure_openai_api_version,
                    azure_endpoint=self.azure_openai_endpoint,
                )
            elif self.azure_openai_api_key:
                self.azure_client = AsyncAzureOpenAI(
                    api_key=self.azure_openai_api_key,
                    api_version=self.azure_openai_api_version,
                    azure_endpoint=self.azure_openai_endpoint,
                )

        # Config
        self.quality_threshold = float(os.getenv("INVESTIGATION_QUALITY_THRESHOLD", "0.40"))
        self.max_daily_usd = float(os.getenv("INVESTIGATION_MAX_DAILY_USD", "5.0"))
        self.max_age_hours = _env_int("INVESTIGATION_MAX_AGE_HOURS", 48)
        self.http_timeout = float(os.getenv("RESEARCH_HTTP_TIMEOUT", "15"))
        self.max_concurrent = 2

        # GNews / NewsAPI keys for corroboration rechecks
        self.gnews_key = os.getenv("GNEWS_API_KEY", "")
        self.newsapi_key = os.getenv("NEWSAPI_KEY", "")

        self._stats: Dict[str, Any] = {
            "triaged": 0,
            "enqueued": 0,
            "processed": 0,
            "succeeded": 0,
            "promoted": 0,
            "insufficient": 0,
            "failed": 0,
            "searches": 0,
            "articles_fetched": 0,
            "llm_calls": 0,
            "corroboration_rechecked": 0,
            "corroboration_upgraded": 0,
        }

    async def connect(self):
        if self.pool is None:
            self.pool = await asyncpg.create_pool(
                self.database_url, min_size=1, max_size=4, command_timeout=60
            )

    async def disconnect(self):
        if self.pool:
            await self.pool.close()
            self.pool = None

    # ------------------------------------------------------------------
    # Budget guard (daily LLM spend cap)
    # ------------------------------------------------------------------

    async def _check_daily_budget(self) -> bool:
        """Check if we're under the daily LLM spend limit.

        Uses a conservative estimate: ~$0.005 per investigation call.
        """
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            today_count = await conn.fetchval(
                """
                SELECT COUNT(*) FROM investigation_queue
                WHERE completed_at >= CURRENT_DATE
                  AND status IN ('completed', 'promoted')
                """
            ) or 0
        estimated_spend = int(today_count) * 0.006  # ~$0.006 per investigation
        if estimated_spend >= self.max_daily_usd:
            print(f"[investigation] daily budget reached (~${estimated_spend:.2f} of ${self.max_daily_usd})")
            return False
        return True

    # ------------------------------------------------------------------
    # Step 1: Triage headlines via LLM
    # ------------------------------------------------------------------

    async def triage_headlines(self, headlines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Score headlines for AI relevance via a single LLM batch call.

        Returns list of dicts with 'index', 'score', 'reason', 'entities', 'topic_tags'.
        """
        if not headlines or self.azure_client is None:
            return []

        headline_list = [
            {"index": i, "title": h.get("title", ""), "url": h.get("url", "")}
            for i, h in enumerate(headlines)
        ]

        deployment = self.azure_openai_deployment
        model_name = (deployment or "").strip().lower()
        token_param = "max_completion_tokens" if model_name.startswith(("gpt-5", "o1", "o3", "o4")) else "max_tokens"

        payload: Dict[str, Any] = {
            "model": deployment,
            "messages": [
                {"role": "system", "content": _TRIAGE_PROMPT},
                {"role": "user", "content": json.dumps({"headlines": headline_list})},
            ],
            "response_format": {"type": "json_object"},
            token_param: 2048,
        }
        if not model_name.startswith(("gpt-5", "o1", "o3", "o4")):
            payload["temperature"] = 0.2

        content = "{}"
        try:
            response = await self.azure_client.chat.completions.create(**payload)
            content = ((response.choices or [None])[0].message.content if response.choices else "{}") or "{}"
            print(f"[investigation] triage raw LLM response (first 800 chars): {content[:800]}")
            parsed = json.loads(content) if isinstance(content, str) else {}
            self._stats["llm_calls"] = self._stats["llm_calls"] + 1

            results = parsed.get("results") or []
            valid = [r for r in results if isinstance(r, dict)]
            print(f"[investigation] triage parsed: {len(valid)} results, scores={[r.get('score') for r in valid]}")
            return valid
        except Exception as exc:
            print(f"[investigation] triage LLM failed: {exc}")
            print(f"[investigation] raw content: {content[:500]}")
            return []

    # ------------------------------------------------------------------
    # Step 2: Enqueue triaged seeds
    # ------------------------------------------------------------------

    async def enqueue_triaged_seeds(self, max_seeds: int = 20) -> int:
        """Read failed paid_headline_seeds, triage via LLM, enqueue qualifying ones."""
        await self.connect()
        assert self.pool is not None

        async with self.pool.acquire() as conn:
            # Get failed seeds not already in investigation_queue
            rows = await conn.fetch(
                """
                SELECT s.id::text AS id, s.publisher_key, s.url, s.canonical_url,
                       s.title, s.summary, s.published_at
                FROM paid_headline_seeds s
                WHERE s.status = 'failed'
                  AND s.title IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM investigation_queue iq WHERE iq.seed_id = s.id
                  )
                ORDER BY s.created_at DESC
                LIMIT $1
                """,
                max_seeds,
            )

        if not rows:
            print("[investigation] no new failed seeds to triage")
            return 0

        # Build headlines for triage
        headlines = [
            {"index": i, "title": row["title"], "url": row["url"]}
            for i, row in enumerate(rows)
        ]

        # LLM triage
        triage_results = await self.triage_headlines(headlines)
        self._stats["triaged"] = len(triage_results)

        # Index triage results by original position
        triage_by_index: Dict[int, Dict] = {}
        for r in triage_results:
            idx = r.get("index")
            if isinstance(idx, int) and 0 <= idx < len(rows):
                triage_by_index[idx] = r

        enqueued = 0
        async with self.pool.acquire() as conn:
            for i, row in enumerate(rows):
                triage = triage_by_index.get(i, {})
                score = int(triage.get("score", 0))

                # Only enqueue seeds scoring >= 2 (relevant or high-priority)
                if score < 2:
                    continue

                entities = triage.get("entities") or []
                topic_tags = triage.get("topic_tags") or []
                reason = str(triage.get("reason", ""))[:200]
                priority = 3 if score >= 3 else 5

                try:
                    result = await conn.fetchval(
                        """
                        INSERT INTO investigation_queue (
                            seed_id, publisher_key, headline_title, headline_url,
                            triage_score, triage_reason, entities, topic_tags, priority
                        )
                        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9)
                        ON CONFLICT (seed_id) DO NOTHING
                        RETURNING id::text
                        """,
                        row["id"],
                        row["publisher_key"],
                        row["title"][:500],
                        row["url"][:1000],
                        score,
                        reason,
                        entities[:10],
                        topic_tags[:5],
                        priority,
                    )
                    if result:
                        enqueued = enqueued + 1
                except Exception as exc:
                    print(f"[investigation] enqueue failed for '{row['title'][:40]}': {exc}")

        self._stats["enqueued"] = enqueued
        print(f"[investigation] triaged {len(rows)} seeds, enqueued {enqueued} (score >= 2)")
        return enqueued

    # ------------------------------------------------------------------
    # Step 3: Process investigation queue
    # ------------------------------------------------------------------

    async def process_queue(self, max_items: int = 5) -> Dict[str, Any]:
        """Pick pending investigation items and research them."""
        await self.connect()
        assert self.pool is not None

        if not await self._check_daily_budget():
            return self._stats

        async with self.pool.acquire() as conn:
            # Recover stale items (stuck in processing > 15 min)
            await conn.execute(
                """
                UPDATE investigation_queue
                SET status = 'pending', started_at = NULL
                WHERE status = 'processing'
                  AND started_at < NOW() - INTERVAL '15 minutes'
                """
            )

            rows = await conn.fetch(
                """
                SELECT id, seed_id, publisher_key, headline_title, headline_url,
                       triage_score, entities, topic_tags
                FROM investigation_queue
                WHERE status = 'pending'
                ORDER BY priority ASC, created_at ASC
                LIMIT $1
                """,
                max_items,
            )

        if not rows:
            print("[investigation] no pending items in queue")
            return self._stats

        sem = asyncio.Semaphore(self.max_concurrent)

        async def _process_one(row):
            async with sem:
                await self._investigate_item(row)

        await asyncio.gather(*[_process_one(r) for r in rows])
        return self._stats

    async def _investigate_item(self, row: Any):
        """Research a single investigation queue item."""
        assert self.pool is not None
        item_id = str(row["id"])
        title = row["headline_title"]

        # Claim
        async with self.pool.acquire() as conn:
            claimed = await conn.fetchval(
                """
                UPDATE investigation_queue
                SET status = 'processing', started_at = NOW()
                WHERE id = $1::uuid AND status = 'pending'
                RETURNING id::text
                """,
                item_id,
            )
            if not claimed:
                return

        self._stats["processed"] = self._stats["processed"] + 1
        print(f"[investigation] researching: {title[:60]}")

        try:
            entities = list(row.get("entities") or [])
            topic_tags = list(row.get("topic_tags") or [])

            # 1. Generate search queries from headline
            queries = _generate_investigation_queries(title, entities)

            # 2. Web search (DuckDuckGo)
            async with httpx.AsyncClient(timeout=self.http_timeout) as client:
                search_results = await search_multiple(client, queries, max_results=10)
                self._stats["searches"] = self._stats["searches"] + len(queries)

                # 3. Social signal search
                social_signals = await _search_social_signals(client, entities, title)

                # 4. Fetch top articles
                articles = await fetch_articles(client, search_results, max_articles=5)
                self._stats["articles_fetched"] = self._stats["articles_fetched"] + len(articles)

            # 5. Cross-ref with entity index (zero LLM cost)
            entity_context = await self._cross_ref_entities(entities)

            # 6. LLM synthesis
            investigation: Optional[InvestigationResult] = None
            if articles and self.azure_client is not None:
                investigation = await self._synthesize_investigation(
                    title, entities, topic_tags, articles, entity_context, social_signals
                )
                self._stats["llm_calls"] = self._stats["llm_calls"] + 1

            # 7. Quality gate
            quality_score = 0.0
            quality_reason = "no_articles"
            if investigation:
                quality_score, quality_reason = quality_gate(
                    investigation, search_results, entity_context, social_signals
                )
                investigation.quality_score = quality_score
                investigation.quality_reason = quality_reason

            # 8. Persist results
            async with self.pool.acquire() as conn:
                output_json = investigation.to_dict() if investigation else None
                search_json = [
                    {"url": r.url, "title": r.title, "snippet": r.snippet, "domain": r.domain}
                    for r in search_results
                ]

                if quality_score >= self.quality_threshold and investigation:
                    # Promote to news_clusters
                    cluster_id = await self._promote_to_cluster(
                        conn, item_id, row, investigation
                    )
                    await conn.execute(
                        """
                        UPDATE investigation_queue
                        SET status = 'promoted',
                            completed_at = NOW(),
                            search_queries = $2::text[],
                            search_results = $3::jsonb,
                            investigation_output = $4::jsonb,
                            entity_context = $5::jsonb,
                            social_signals = $6::jsonb,
                            quality_score = $7,
                            quality_reason = $8,
                            cluster_id = $9::uuid
                        WHERE id = $1::uuid
                        """,
                        item_id,
                        queries,
                        json.dumps(search_json),
                        json.dumps(output_json),
                        json.dumps(entity_context),
                        json.dumps(social_signals),
                        Decimal(str(round(quality_score, 2))),
                        quality_reason,
                        cluster_id,
                    )
                    self._stats["promoted"] = self._stats["promoted"] + 1
                    print(f"[investigation] promoted: {title[:50]} (score={quality_score:.2f})")

                elif investigation:
                    # Completed but quality too low
                    await conn.execute(
                        """
                        UPDATE investigation_queue
                        SET status = 'insufficient',
                            completed_at = NOW(),
                            search_queries = $2::text[],
                            search_results = $3::jsonb,
                            investigation_output = $4::jsonb,
                            entity_context = $5::jsonb,
                            social_signals = $6::jsonb,
                            quality_score = $7,
                            quality_reason = $8
                        WHERE id = $1::uuid
                        """,
                        item_id,
                        queries,
                        json.dumps(search_json),
                        json.dumps(output_json),
                        json.dumps(entity_context),
                        json.dumps(social_signals),
                        Decimal(str(round(quality_score, 2))),
                        quality_reason,
                    )
                    self._stats["insufficient"] = self._stats["insufficient"] + 1
                    print(f"[investigation] insufficient: {title[:50]} (score={quality_score:.2f})")

                else:
                    # No investigation produced (no articles or LLM failed)
                    await conn.execute(
                        """
                        UPDATE investigation_queue
                        SET status = 'completed',
                            completed_at = NOW(),
                            search_queries = $2::text[],
                            search_results = $3::jsonb,
                            quality_score = 0,
                            quality_reason = $4
                        WHERE id = $1::uuid
                        """,
                        item_id,
                        queries,
                        json.dumps(search_json),
                        quality_reason,
                    )

            self._stats["succeeded"] = self._stats["succeeded"] + 1

        except Exception as exc:
            self._stats["failed"] = self._stats["failed"] + 1
            print(f"[investigation] failed: {title[:50]}: {exc}")
            try:
                async with self.pool.acquire() as conn:
                    await conn.execute(
                        """
                        UPDATE investigation_queue
                        SET status = 'failed',
                            error = $2,
                            retry_count = retry_count + 1
                        WHERE id = $1::uuid
                        """,
                        item_id,
                        str(exc)[:500],
                    )
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Entity cross-reference (zero LLM cost)
    # ------------------------------------------------------------------

    async def _cross_ref_entities(self, entities: List[str]) -> Dict[str, Any]:
        """Cross-reference extracted entities with BuildAtlas DB."""
        if not entities:
            return {}

        assert self.pool is not None
        context: Dict[str, Any] = {}

        try:
            from .memory_gate import EntityIndex
            entity_index = EntityIndex()
            async with self.pool.acquire() as conn:
                await entity_index.load(conn, region="global")

            linked = entity_index.link(entities)
            for le in linked:
                entry: Dict[str, Any] = {
                    "entity_type": le.entity_type,
                    "match_method": le.match_method,
                    "match_score": le.match_score,
                }
                if le.startup_id:
                    entry["startup_id"] = le.startup_id
                if le.investor_id:
                    entry["investor_id"] = le.investor_id
                context[le.entity_name] = entry

            # Fetch recent activity for linked startups
            startup_ids = [le.startup_id for le in linked if le.startup_id]
            if startup_ids:
                async with self.pool.acquire() as conn:
                    recent = await conn.fetch(
                        """
                        SELECT s.id::text, s.name,
                               (SELECT COUNT(*) FROM funding_rounds fr WHERE fr.startup_id = s.id) AS round_count,
                               (SELECT MAX(fr.announced_date) FROM funding_rounds fr WHERE fr.startup_id = s.id) AS last_round
                        FROM startups s
                        WHERE s.id = ANY($1::uuid[])
                        """,
                        startup_ids[:5],
                    )
                    for r in recent:
                        name = r["name"]
                        if name in context:
                            context[name]["funding_rounds"] = int(r["round_count"] or 0)
                            if r["last_round"]:
                                context[name]["last_round_date"] = str(r["last_round"])

        except Exception as exc:
            print(f"[investigation] entity cross-ref failed (non-fatal): {exc}")

        return context

    # ------------------------------------------------------------------
    # LLM synthesis
    # ------------------------------------------------------------------

    async def _synthesize_investigation(
        self,
        title: str,
        entities: List[str],
        topic_tags: List[str],
        articles: List[ArticleContent],
        entity_context: Dict[str, Any],
        social_signals: Dict[str, Any],
    ) -> Optional[InvestigationResult]:
        """Call LLM to produce investigation brief from public sources."""
        if self.azure_client is None:
            return None

        article_data = [
            {"url": a.url, "title": a.title, "excerpt": a.text[:1500]}
            for a in articles[:5]
        ]

        user_payload = {
            "headline": title,
            "entities": entities[:8],
            "topic_tags": topic_tags[:5],
            "known_entities": {
                k: v for k, v in entity_context.items()
                if isinstance(v, dict) and v.get("match_score", 0) >= 0.7
            },
            "web_articles": article_data,
            "social_discussion": {
                k: v for k, v in social_signals.items()
                if v  # Only include non-empty signals
            },
        }

        deployment = self.azure_openai_deployment
        model_name = (deployment or "").strip().lower()
        token_param = "max_completion_tokens" if model_name.startswith(("gpt-5", "o1", "o3", "o4")) else "max_tokens"

        payload: Dict[str, Any] = {
            "model": deployment,
            "messages": [
                {"role": "system", "content": _INVESTIGATION_PROMPT},
                {"role": "user", "content": json.dumps(user_payload)},
            ],
            "response_format": {"type": "json_object"},
            token_param: 2048,
        }
        if not model_name.startswith(("gpt-5", "o1", "o3", "o4")):
            payload["temperature"] = 0.3

        for deploy in [deployment, self.azure_openai_fallback_deployment]:
            if not deploy:
                continue
            try:
                payload["model"] = deploy
                response = await self.azure_client.chat.completions.create(**payload)
                content = ((response.choices or [None])[0].message.content if response.choices else "{}") or "{}"
                parsed = json.loads(content) if isinstance(content, str) else {}

                return InvestigationResult(
                    enhanced_summary=str(parsed.get("enhanced_summary") or "")[:300],
                    key_findings=[str(f)[:120] for f in (parsed.get("key_findings") or [])[:5]],
                    entity_context=parsed.get("entity_context") or {},
                    builder_implications=str(parsed.get("builder_implications") or "")[:200],
                    sources_used=[
                        {"url": str(s.get("url", "")), "title": str(s.get("title", ""))}
                        for s in (parsed.get("sources_used") or [])[:10]
                        if isinstance(s, dict)
                    ],
                    social_signals=social_signals,
                )
            except Exception as exc:
                print(f"[investigation] LLM synthesis failed ({deploy}): {exc}")

        return None

    # ------------------------------------------------------------------
    # Promote to news_clusters
    # ------------------------------------------------------------------

    async def _promote_to_cluster(
        self,
        conn: "asyncpg.Connection",
        item_id: str,
        row: Any,
        investigation: InvestigationResult,
    ) -> str:
        """Create a news_clusters row for a promoted investigation."""
        title = row["headline_title"]
        entities = list(row.get("entities") or [])
        topic_tags = list(row.get("topic_tags") or [])

        # Compute discounted rank score (40% discount vs normal)
        base_rank = 0.50  # Moderate base rank
        rank_score = max(0.01, base_rank * 0.6)  # 40% discount

        output_dict = investigation.to_dict()

        cluster_id = await conn.fetchval(
            """
            INSERT INTO news_clusters (
                title, summary, story_type, topic_tags, entities,
                rank_score, rank_reason, trust_score, source_count,
                canonical_url, published_at,
                research_context, investigation_seed_id,
                builder_takeaway, llm_summary
            )
            VALUES (
                $1, $2, 'investigation', $3::text[], $4::text[],
                $5, 'investigation_pipeline', 0.5, $6,
                $7, NOW(),
                $8::jsonb, $9::uuid,
                $10, $11
            )
            RETURNING id::text
            """,
            title[:500],
            investigation.enhanced_summary[:500],
            topic_tags[:10],
            entities[:10],
            rank_score,
            len(investigation.sources_used),
            json.dumps(output_dict),
            row["seed_id"],
            investigation.builder_implications[:500] if investigation.builder_implications else None,
            investigation.enhanced_summary[:500],
        )
        print(f"[investigation] created cluster {cluster_id} for: {title[:50]}")
        return cluster_id

    # ------------------------------------------------------------------
    # Corroboration re-check
    # ------------------------------------------------------------------

    async def recheck_corroboration(self) -> Dict[str, Any]:
        """Re-check promoted investigations for open-web corroboration.

        Runs every 6h for items under 48h old. If corroboration found,
        upgrades story_type from 'investigation' to 'news'.
        """
        await self.connect()
        assert self.pool is not None

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT iq.id::text, iq.headline_title, iq.headline_url,
                       iq.entities, iq.cluster_id::text,
                       iq.corroboration_checks, iq.last_corroboration_at
                FROM investigation_queue iq
                WHERE iq.status = 'promoted'
                  AND iq.cluster_id IS NOT NULL
                  AND iq.created_at > NOW() - INTERVAL '48 hours'
                  AND (iq.last_corroboration_at IS NULL
                       OR iq.last_corroboration_at < NOW() - INTERVAL '6 hours')
                ORDER BY iq.created_at ASC
                LIMIT 10
                """
            )

        if not rows:
            print("[investigation] no promoted items due for corroboration re-check")
            return self._stats

        print(f"[investigation] re-checking corroboration for {len(rows)} items")

        for row in rows:
            item_id = str(row["id"])
            title = row["headline_title"]
            cluster_id = row["cluster_id"]
            self._stats["corroboration_rechecked"] = self._stats["corroboration_rechecked"] + 1

            try:
                # Search for open-web coverage
                query = build_paid_headline_search_query(title)
                if not query:
                    continue

                found_coverage = False
                async with httpx.AsyncClient(timeout=self.http_timeout) as client:
                    # Try GNews
                    if self.gnews_key:
                        found_coverage = await self._check_gnews_coverage(client, query)

                    # Try NewsAPI if GNews didn't find anything
                    if not found_coverage and self.newsapi_key:
                        found_coverage = await self._check_newsapi_coverage(client, query)

                async with self.pool.acquire() as conn:
                    if found_coverage:
                        # Upgrade to normal news story
                        await conn.execute(
                            """
                            UPDATE news_clusters
                            SET story_type = 'news'
                            WHERE id = $1::uuid AND story_type = 'investigation'
                            """,
                            cluster_id,
                        )
                        await conn.execute(
                            """
                            UPDATE investigation_queue
                            SET last_corroboration_at = NOW(),
                                corroboration_checks = corroboration_checks + 1
                            WHERE id = $1::uuid
                            """,
                            item_id,
                        )
                        self._stats["corroboration_upgraded"] = self._stats["corroboration_upgraded"] + 1
                        print(f"[investigation] upgraded to news: {title[:50]}")
                    else:
                        await conn.execute(
                            """
                            UPDATE investigation_queue
                            SET last_corroboration_at = NOW(),
                                corroboration_checks = corroboration_checks + 1
                            WHERE id = $1::uuid
                            """,
                            item_id,
                        )

            except Exception as exc:
                print(f"[investigation] corroboration recheck failed for '{title[:40]}': {exc}")

        return self._stats

    async def _check_gnews_coverage(self, client: httpx.AsyncClient, query: str) -> bool:
        """Check GNews for coverage. Returns True if relevant articles found."""
        try:
            params = {
                "q": query,
                "lang": "en",
                "max": "3",
                "from": (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat(),
                "token": self.gnews_key,
            }
            resp = await client.get("https://gnews.io/api/v4/search", params=params)
            if resp.status_code >= 400:
                return False
            articles = (resp.json() or {}).get("articles") or []
            return len(articles) > 0
        except Exception:
            return False

    async def _check_newsapi_coverage(self, client: httpx.AsyncClient, query: str) -> bool:
        """Check NewsAPI for coverage. Returns True if relevant articles found."""
        try:
            params = {
                "q": query,
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": "3",
                "from": (datetime.now(timezone.utc) - timedelta(hours=48)).strftime("%Y-%m-%d"),
                "apiKey": self.newsapi_key,
            }
            resp = await client.get("https://newsapi.org/v2/everything", params=params)
            if resp.status_code >= 400:
                return False
            articles = (resp.json() or {}).get("articles") or []
            return len(articles) > 0
        except Exception:
            return False


# ---------------------------------------------------------------------------
# Query generation for investigations
# ---------------------------------------------------------------------------

def _generate_investigation_queries(
    title: str,
    entities: List[str],
) -> List[str]:
    """Generate diverse search queries for investigating a headline."""
    queries: List[str] = []

    # Query 1: entity-focused with AI context
    top_entity = next(
        (e for e in entities if e.lower() not in {"ai", "startup", "tech", "news", "the information"}),
        "",
    )
    if top_entity:
        queries.append(f'"{top_entity}" AI funding 2026')
        queries.append(f'"{top_entity}" startup announcement')

    # Query 2: headline keywords + implications
    words = [
        w.lower() for w in re.findall(r"\w+", title)
        if w.lower() not in _STOP_WORDS and len(w) > 2
    ]
    if words:
        kw = " ".join(words[:5])
        queries.append(f"{kw} AI startup implications")

    # Query 3: social signals
    if top_entity:
        queries.append(f"site:news.ycombinator.com {top_entity}")

    return queries[:4]


_STOP_WORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could", "of", "in", "to",
    "for", "with", "on", "at", "by", "from", "as", "into", "through",
    "about", "and", "but", "or", "not", "no", "its", "it", "this", "that",
    "their", "they", "them", "our", "your", "his", "her", "who", "what",
    "which", "when", "where", "how", "why", "new", "says", "said",
}


# ---------------------------------------------------------------------------
# Social signal search
# ---------------------------------------------------------------------------

async def _search_social_signals(
    client: httpx.AsyncClient,
    entities: List[str],
    title: str,
) -> Dict[str, Any]:
    """Search HN and Reddit for discussion about the entities/topic."""
    signals: Dict[str, Any] = {"hn_results": [], "reddit_results": []}

    top_entity = next(
        (e for e in entities if e.lower() not in {"ai", "startup", "tech", "news"}),
        "",
    )
    if not top_entity:
        return signals

    try:
        # HN search via Algolia API
        hn_resp = await client.get(
            "https://hn.algolia.com/api/v1/search",
            params={"query": top_entity, "tags": "story", "hitsPerPage": "3"},
            timeout=8.0,
        )
        if hn_resp.status_code == 200:
            hits = (hn_resp.json() or {}).get("hits") or []
            signals["hn_results"] = [
                {"title": h.get("title", ""), "url": f"https://news.ycombinator.com/item?id={h.get('objectID', '')}", "points": h.get("points", 0)}
                for h in hits[:3]
            ]
    except Exception:
        pass

    try:
        # Reddit search
        reddit_resp = await client.get(
            f"https://www.reddit.com/search.json",
            params={"q": top_entity, "sort": "new", "limit": "3", "t": "week"},
            headers={"User-Agent": "BuildAtlasResearcher/1.0"},
            timeout=8.0,
        )
        if reddit_resp.status_code == 200:
            children = (reddit_resp.json() or {}).get("data", {}).get("children", [])
            signals["reddit_results"] = [
                {"title": c.get("data", {}).get("title", ""), "url": f"https://reddit.com{c.get('data', {}).get('permalink', '')}", "score": c.get("data", {}).get("score", 0)}
                for c in children[:3]
                if isinstance(c, dict)
            ]
    except Exception:
        pass

    return signals


# ---------------------------------------------------------------------------
# Quality gate
# ---------------------------------------------------------------------------

def quality_gate(
    result: InvestigationResult,
    search_results: List[SearchResult],
    entity_context: Dict[str, Any],
    social_signals: Dict[str, Any],
) -> Tuple[float, str]:
    """Score investigation quality (0.0–1.0). Returns (score, reason)."""
    score = 0.0
    reasons: List[str] = []

    # Source diversity: 0-0.30 (distinct domains found)
    domains = {r.domain for r in search_results if r.domain}
    if len(domains) >= 4:
        source_score = 0.30
    elif len(domains) >= 2:
        source_score = 0.20
    elif len(domains) >= 1:
        source_score = 0.10
    else:
        source_score = 0.0
    score = score + source_score
    reasons.append(f"sources={len(domains)}/{source_score:.2f}")

    # Entity context depth: 0-0.25 (known entity + recent activity)
    known_entities = sum(1 for v in entity_context.values() if isinstance(v, dict) and v.get("match_score", 0) >= 0.7)
    has_recent_activity = any(
        isinstance(v, dict) and v.get("last_round_date")
        for v in entity_context.values()
    )
    entity_score = 0.0
    if known_entities >= 2:
        entity_score = 0.20
    elif known_entities >= 1:
        entity_score = 0.12
    if has_recent_activity:
        entity_score = min(0.25, entity_score + 0.05)
    score = score + entity_score
    reasons.append(f"entities={known_entities}/{entity_score:.2f}")

    # LLM output quality: 0-0.30 (substantive findings)
    llm_score = 0.0
    if result.key_findings:
        finding_quality = sum(1 for f in result.key_findings if len(f) > 30)
        if finding_quality >= 3:
            llm_score = 0.30
        elif finding_quality >= 2:
            llm_score = 0.20
        elif finding_quality >= 1:
            llm_score = 0.10
    if result.enhanced_summary and len(result.enhanced_summary) > 50:
        llm_score = min(0.30, llm_score + 0.05)
    score = score + llm_score
    reasons.append(f"llm={llm_score:.2f}")

    # Social signals: 0-0.15 (HN/Reddit discussion found)
    social_score = 0.0
    hn = social_signals.get("hn_results") or []
    reddit = social_signals.get("reddit_results") or []
    if hn:
        social_score = social_score + 0.08
    if reddit:
        social_score = social_score + 0.07
    social_score = min(0.15, social_score)
    score = score + social_score
    reasons.append(f"social={social_score:.2f}")

    return round(score, 2), "; ".join(reasons)


# ---------------------------------------------------------------------------
# Module-level runners (called from main.py CLI)
# ---------------------------------------------------------------------------

async def run_investigate_seeds(max_items: int = 5) -> Dict[str, Any]:
    """Entry point: triage + enqueue + investigate + promote."""
    pipeline = InvestigationPipeline()
    try:
        await pipeline.enqueue_triaged_seeds()
        stats = await pipeline.process_queue(max_items=max_items)
        return stats
    finally:
        await pipeline.disconnect()


async def run_recheck_corroboration() -> Dict[str, Any]:
    """Entry point: periodic corroboration re-check."""
    pipeline = InvestigationPipeline()
    try:
        stats = await pipeline.recheck_corroboration()
        return stats
    finally:
        await pipeline.disconnect()
