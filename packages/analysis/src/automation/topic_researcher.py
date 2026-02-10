"""Hot topic research — signal detection, web search, LLM synthesis.

Detects newsworthy clusters from the pipeline, queues them for async web
research, fetches additional coverage via DuckDuckGo, and produces enriched
summaries + deep-dive mini-articles that feed back into the next pipeline run.

Architecture:
  Pipeline (hourly :15)           Research Worker (hourly :45)
  ───────────────────             ────────────────────────────
  collect → cluster → gate ─┐    pick pending queue items
                             │   for each:
                    enqueue hot topics   search + fetch + synthesize
                             │           update cluster.research_context
                    persist edition
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import quote_plus, urlparse

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

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover
    BeautifulSoup = None


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class SearchResult:
    url: str
    title: str
    snippet: str
    domain: str = ""

    def __post_init__(self):
        if not self.domain:
            try:
                self.domain = urlparse(self.url).netloc.lower().removeprefix("www.")
            except Exception:
                self.domain = ""


@dataclass
class ArticleContent:
    url: str
    title: str
    text: str  # truncated plain text


@dataclass
class ResearchOutput:
    enhanced_summary: str
    key_findings: List[str]
    builder_implications: str
    deep_dive_markdown: str
    sources_used: List[Dict[str, str]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "enhanced_summary": self.enhanced_summary,
            "key_findings": self.key_findings,
            "builder_implications": self.builder_implications,
            "deep_dive_markdown": self.deep_dive_markdown,
            "sources_used": self.sources_used,
            "researched_at": datetime.now(timezone.utc).isoformat(),
        }


# ---------------------------------------------------------------------------
# Hot topic detection
# ---------------------------------------------------------------------------

def detect_hot_topics(
    clusters: Sequence[Any],
    cluster_ids: Dict[str, str],
    *,
    max_topics: int = 5,
) -> List[Dict[str, Any]]:
    """Identify clusters that warrant deeper web research.

    A cluster is considered "hot" when at least one of:
      - gating_decision in ('publish', 'borderline') AND source_count >= 3
      - Memory result has new facts or contradictions
      - Pattern novelty score >= 4
      - Has AINews as a source (ainews_digest in member source_keys)

    Returns list of dicts ready for INSERT into news_research_queue.
    """
    candidates: List[Tuple[float, Dict[str, Any]]] = []

    for cluster in clusters:
        decision = getattr(cluster, "gating_decision", None)
        if decision not in ("publish", "borderline"):
            continue

        cluster_key = getattr(cluster, "cluster_key", "")
        cid = cluster_ids.get(cluster_key)
        if not cid:
            continue

        # Compute priority score (lower = higher priority)
        priority = 5
        reasons = []

        source_count = len(getattr(cluster, "members", []))
        if source_count >= 3:
            priority = min(priority, 2)
            reasons.append(f"multi_source({source_count})")

        mr = getattr(cluster, "memory_result", None)
        if mr:
            if getattr(mr, "has_new_facts", False):
                priority = min(priority, 3)
                reasons.append("new_facts")
            if getattr(mr, "has_contradictions", False):
                priority = min(priority, 1)
                reasons.append("contradictions")

        gating_scores = getattr(cluster, "gating_scores", None) or {}
        pattern_novelty = 0
        if isinstance(gating_scores, dict):
            pattern_novelty = gating_scores.get("pattern_novelty", 0)
        elif hasattr(gating_scores, "pattern_novelty"):
            pattern_novelty = getattr(gating_scores, "pattern_novelty", 0)
        if pattern_novelty >= 4:
            priority = min(priority, 2)
            reasons.append(f"novel_pattern({pattern_novelty})")

        # Check for AINews source
        member_sources = {getattr(m, "source_key", "") for m in getattr(cluster, "members", [])}
        if "ainews_digest" in member_sources:
            priority = min(priority, 3)
            reasons.append("ainews_source")

        if not reasons:
            # Must have at least one hot-topic signal
            continue

        gs_dict = gating_scores if isinstance(gating_scores, dict) else (
            gating_scores.to_dict() if hasattr(gating_scores, "to_dict") else {}
        )

        candidates.append((
            priority,
            {
                "cluster_id": cid,
                "cluster_key": cluster_key,
                "title": getattr(cluster, "title", ""),
                "entities": list(getattr(cluster, "entities", []))[:10],
                "topic_tags": list(getattr(cluster, "topic_tags", []))[:10],
                "gating_scores": gs_dict,
                "priority": priority,
            },
        ))

    # Sort by priority (ASC), take top N
    candidates.sort(key=lambda t: t[0])
    return [c[1] for c in candidates[:max_topics]]


# ---------------------------------------------------------------------------
# Query generation
# ---------------------------------------------------------------------------

_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "has", "in", "is", "it", "its", "of", "on", "or", "that", "the",
    "to", "with", "will", "new",
}


def generate_search_queries(
    title: str,
    entities: List[str],
    topic_tags: List[str],
) -> List[str]:
    """Generate 2-3 diverse search queries for a hot topic."""
    queries: List[str] = []

    # Query 1: quoted title (most specific)
    clean_title = re.sub(r"[^\w\s\-']", "", title).strip()
    if clean_title:
        queries.append(f'"{clean_title}"')

    # Query 2: top entity + top tag + year
    top_entity = next((e for e in entities if e not in {"AI", "Startup", "Tech", "News"}), "")
    top_tag = next((t for t in topic_tags if t not in {"ai", "news", "tech"}), "")
    if top_entity and top_tag:
        queries.append(f'"{top_entity}" {top_tag} news 2026')
    elif top_entity:
        queries.append(f'"{top_entity}" startup news 2026')

    # Query 3: keyword extraction from title + "startup implications"
    words = [w.lower() for w in re.findall(r"\w+", title) if w.lower() not in _STOP_WORDS and len(w) > 2]
    if words:
        kw = " ".join(words[:5])
        queries.append(f"{kw} startup implications")

    return queries[:3]


# ---------------------------------------------------------------------------
# Web search (DuckDuckGo HTML)
# ---------------------------------------------------------------------------

async def web_search(
    client: httpx.AsyncClient,
    query: str,
    num_results: int = 5,
) -> List[SearchResult]:
    """Search DuckDuckGo HTML and parse results."""
    try:
        url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
        headers = {"User-Agent": "Mozilla/5.0 (compatible; BuildAtlasResearcher/1.0)"}
        response = await client.get(url, headers=headers, follow_redirects=True)
        if response.status_code != 200:
            return []

        results: List[SearchResult] = []
        html = response.text

        link_pattern = r'<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([^<]+)</a>'
        snippet_pattern = r'<a class="result__snippet"[^>]*>([^<]+)</a>'

        links = re.findall(link_pattern, html)
        snippets = re.findall(snippet_pattern, html)

        for i, (link, link_title) in enumerate(links[:num_results]):
            snippet = snippets[i] if i < len(snippets) else ""
            results.append(SearchResult(
                url=link,
                title=link_title.strip(),
                snippet=snippet.strip(),
            ))

        return results
    except Exception as exc:
        print(f"[topic-research] search error for '{query[:60]}': {exc}")
        return []


async def search_multiple(
    client: httpx.AsyncClient,
    queries: List[str],
    results_per_query: int = 5,
    max_results: int = 8,
) -> List[SearchResult]:
    """Run multiple queries, deduplicate by domain, return top results."""
    all_results: List[SearchResult] = []
    seen_domains: set = set()

    for query in queries:
        results = await web_search(client, query, results_per_query)
        for r in results:
            if r.domain not in seen_domains:
                seen_domains.add(r.domain)
                all_results.append(r)
        # Brief pause between queries to be polite
        await asyncio.sleep(0.5)

    return all_results[:max_results]


# ---------------------------------------------------------------------------
# Article fetching
# ---------------------------------------------------------------------------

def _extract_text(html: str, max_chars: int = 2000) -> str:
    """Extract readable text from HTML, stripping tags."""
    if BeautifulSoup is not None:
        soup = BeautifulSoup(html, "html.parser")
        # Remove script/style
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
    else:
        # Fallback: regex strip
        text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()

    # Truncate to max_chars
    if len(text) > max_chars:
        text = text[:max_chars] + "..."
    return text


async def fetch_articles(
    client: httpx.AsyncClient,
    results: List[SearchResult],
    max_articles: int = 5,
    timeout: float = 10.0,
) -> List[ArticleContent]:
    """Fetch and extract text from top search result URLs."""
    articles: List[ArticleContent] = []

    for result in results[:max_articles]:
        try:
            resp = await client.get(
                result.url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; BuildAtlasResearcher/1.0)"},
                follow_redirects=True,
                timeout=timeout,
            )
            if resp.status_code != 200:
                continue
            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type and "text/plain" not in content_type:
                continue

            text = _extract_text(resp.text)
            if len(text) < 100:
                continue

            articles.append(ArticleContent(
                url=result.url,
                title=result.title,
                text=text,
            ))
        except Exception:
            continue

    return articles


# ---------------------------------------------------------------------------
# LLM synthesis
# ---------------------------------------------------------------------------

_SYNTHESIS_PROMPT = """\
You are a senior technology analyst producing a deep-dive research brief \
for startup builders and investors.

Given a news cluster (title, summary, entities) and additional web articles, \
produce a comprehensive analysis.

Return strict JSON with ALL of these keys:
- enhanced_summary (<=300 chars, sharper than the auto-summary)
- key_findings (array of 3-5 bullet strings from web research, each <=120 chars)
- builder_implications (<=200 chars, how this affects startup builders)
- deep_dive_markdown (500-800 word mini-article in Markdown, authoritative tone, \
  cite sources inline, include section headers)
- sources_used (array of {url, title} objects for articles actually referenced)

No prose outside JSON."""


async def synthesize(
    azure_client: Any,
    deployment: str,
    cluster_context: Dict[str, Any],
    articles: List[ArticleContent],
) -> Optional[ResearchOutput]:
    """Call LLM to synthesize research output from cluster + articles."""
    if azure_client is None:
        return None

    article_data = [
        {"url": a.url, "title": a.title, "excerpt": a.text[:1500]}
        for a in articles[:5]
    ]

    user_payload = {
        "cluster": cluster_context,
        "web_articles": article_data,
    }

    model_name = (deployment or "").strip().lower()
    token_param = "max_completion_tokens" if model_name.startswith(("gpt-5", "o1", "o3", "o4")) else "max_tokens"
    token_budget = 2048 if model_name.startswith(("gpt-5", "o1", "o3", "o4")) else 1024

    payload: Dict[str, Any] = {
        "model": deployment,
        "messages": [
            {"role": "system", "content": _SYNTHESIS_PROMPT},
            {"role": "user", "content": json.dumps(user_payload)},
        ],
        "response_format": {"type": "json_object"},
        token_param: token_budget,
    }

    # Only set temperature for non-reasoning models
    if not model_name.startswith(("gpt-5", "o1", "o3", "o4")):
        payload["temperature"] = 0.3

    try:
        response = await azure_client.chat.completions.create(**payload)
        content = ((response.choices or [None])[0].message.content if response.choices else "{}") or "{}"
        parsed = json.loads(content) if isinstance(content, str) else {}

        return ResearchOutput(
            enhanced_summary=str(parsed.get("enhanced_summary") or "")[:300],
            key_findings=[str(f)[:120] for f in (parsed.get("key_findings") or [])[:5]],
            builder_implications=str(parsed.get("builder_implications") or "")[:200],
            deep_dive_markdown=str(parsed.get("deep_dive_markdown") or "")[:4000],
            sources_used=[
                {"url": str(s.get("url", "")), "title": str(s.get("title", ""))}
                for s in (parsed.get("sources_used") or [])[:10]
                if isinstance(s, dict)
            ],
        )
    except Exception as exc:
        print(f"[topic-research] LLM synthesis failed: {exc}")
        return None


# ---------------------------------------------------------------------------
# TopicResearcher — async queue worker
# ---------------------------------------------------------------------------

class TopicResearcher:
    """Processes the hot-topic research queue: search, fetch, synthesize."""

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or os.getenv("DATABASE_URL")
        if not self.database_url:
            raise RuntimeError("DATABASE_URL is required")
        if asyncpg is None:
            raise RuntimeError("asyncpg is required")

        self.pool: Optional[asyncpg.Pool] = None

        # Azure OpenAI setup (mirrors DailyNewsIngestor pattern)
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

        self.http_timeout = float(os.getenv("RESEARCH_HTTP_TIMEOUT", "15"))
        self.max_concurrent = int(os.getenv("RESEARCH_MAX_CONCURRENT", "2"))
        self._stats: Dict[str, Any] = {
            "processed": 0,
            "succeeded": 0,
            "failed": 0,
            "searches": 0,
            "articles_fetched": 0,
            "llm_calls": 0,
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
    # Enqueue hot topics (called from pipeline)
    # ------------------------------------------------------------------

    async def enqueue(
        self,
        conn: "asyncpg.Connection",
        topics: List[Dict[str, Any]],
        region: str = "global",
    ) -> int:
        """Insert hot topics into the research queue. Dedup by cluster_id."""
        enqueued = 0
        for topic in topics:
            try:
                result = await conn.fetchval(
                    """
                    INSERT INTO news_research_queue (
                        cluster_id, cluster_key, region, title,
                        entities, topic_tags, gating_scores, priority
                    )
                    VALUES ($1::uuid, $2, $3, $4, $5::text[], $6::text[], $7::jsonb, $8)
                    ON CONFLICT DO NOTHING
                    RETURNING id::text
                    """,
                    topic["cluster_id"],
                    topic["cluster_key"],
                    region,
                    topic["title"],
                    topic.get("entities", []),
                    topic.get("topic_tags", []),
                    json.dumps(topic.get("gating_scores") or {}),
                    topic.get("priority", 5),
                )
                if result:
                    enqueued = enqueued + 1
            except Exception as exc:
                print(f"[topic-research] enqueue failed for '{topic.get('title', '')[:40]}': {exc}")
        return enqueued

    # ------------------------------------------------------------------
    # Process queue
    # ------------------------------------------------------------------

    async def process_queue(self, max_items: int = 5) -> Dict[str, Any]:
        """Pick pending items and research them."""
        await self.connect()
        assert self.pool is not None

        async with self.pool.acquire() as conn:
            # Recover stale items (stuck in processing > 15 min)
            await conn.execute(
                """
                UPDATE news_research_queue
                SET status = 'pending', started_at = NULL
                WHERE status = 'processing'
                  AND started_at < NOW() - INTERVAL '15 minutes'
                """
            )

            # Skip clusters already researched in last 24h
            rows = await conn.fetch(
                """
                SELECT id, cluster_id, cluster_key, title, entities,
                       topic_tags, gating_scores, region
                FROM news_research_queue
                WHERE status = 'pending'
                  AND cluster_id NOT IN (
                      SELECT cluster_id FROM news_research_queue
                      WHERE status = 'completed'
                        AND completed_at > NOW() - INTERVAL '24 hours'
                  )
                ORDER BY priority ASC, created_at ASC
                LIMIT $1
                """,
                max_items,
            )

        if not rows:
            print("[topic-research] no pending items in queue")
            return self._stats

        # Process with semaphore for concurrency control
        sem = asyncio.Semaphore(self.max_concurrent)

        async def _process_one(row):
            async with sem:
                await self._research_item(row)

        await asyncio.gather(*[_process_one(r) for r in rows])
        return self._stats

    async def _research_item(self, row: Any):
        """Research a single queue item: claim → search → fetch → synthesize → persist."""
        assert self.pool is not None
        item_id = str(row["id"])
        title = row["title"]

        # Claim
        async with self.pool.acquire() as conn:
            claimed = await conn.fetchval(
                """
                UPDATE news_research_queue
                SET status = 'processing', started_at = NOW()
                WHERE id = $1::uuid AND status = 'pending'
                RETURNING id::text
                """,
                item_id,
            )
            if not claimed:
                return

        self._stats["processed"] = self._stats["processed"] + 1
        print(f"[topic-research] researching: {title[:60]}")

        try:
            entities = list(row.get("entities") or [])
            topic_tags = list(row.get("topic_tags") or [])

            # 1. Generate search queries
            queries = generate_search_queries(title, entities, topic_tags)

            # 2. Web search
            async with httpx.AsyncClient(timeout=self.http_timeout) as client:
                search_results = await search_multiple(client, queries)
                self._stats["searches"] = self._stats["searches"] + len(queries)

                # 3. Fetch articles
                articles = await fetch_articles(client, search_results, max_articles=5)
                self._stats["articles_fetched"] = self._stats["articles_fetched"] + len(articles)

            # 4. LLM synthesis
            research_output: Optional[ResearchOutput] = None
            if articles and self.azure_client is not None:
                cluster_context = {
                    "title": title,
                    "entities": entities[:6],
                    "topic_tags": topic_tags[:6],
                }
                # Try primary deployment, then fallback
                for deployment in [self.azure_openai_deployment, self.azure_openai_fallback_deployment]:
                    if not deployment:
                        continue
                    research_output = await synthesize(
                        self.azure_client, deployment, cluster_context, articles,
                    )
                    self._stats["llm_calls"] = self._stats["llm_calls"] + 1
                    if research_output:
                        break

            # 5. Persist results
            async with self.pool.acquire() as conn:
                output_json = research_output.to_dict() if research_output else None
                search_json = [
                    {"url": r.url, "title": r.title, "snippet": r.snippet, "domain": r.domain}
                    for r in search_results
                ]

                await conn.execute(
                    """
                    UPDATE news_research_queue
                    SET status = 'completed',
                        completed_at = NOW(),
                        search_queries = $2::text[],
                        search_results = $3::jsonb,
                        research_output = $4::jsonb
                    WHERE id = $1::uuid
                    """,
                    item_id,
                    queries,
                    json.dumps(search_json),
                    json.dumps(output_json) if output_json else None,
                )

                # Update cluster with research context
                if output_json:
                    cluster_id = str(row["cluster_id"])
                    await conn.execute(
                        """
                        UPDATE news_clusters
                        SET research_context = $1::jsonb
                        WHERE id = $2::uuid
                        """,
                        json.dumps(output_json),
                        cluster_id,
                    )

            self._stats["succeeded"] = self._stats["succeeded"] + 1
            status = "with LLM synthesis" if research_output else "search only (no LLM)"
            print(f"[topic-research] completed: {title[:50]} ({status})")

        except Exception as exc:
            self._stats["failed"] = self._stats["failed"] + 1
            print(f"[topic-research] failed: {title[:50]}: {exc}")
            try:
                async with self.pool.acquire() as conn:
                    await conn.execute(
                        """
                        UPDATE news_research_queue
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
    # Test helper
    # ------------------------------------------------------------------

    async def test_research(self, query: str) -> Dict[str, Any]:
        """Test web search + synthesis for a topic string (no DB)."""
        print(f"[topic-research] test query: {query}")

        queries = generate_search_queries(query, [], [])
        print(f"[topic-research] generated queries: {queries}")

        async with httpx.AsyncClient(timeout=self.http_timeout) as client:
            search_results = await search_multiple(client, queries)
            print(f"[topic-research] found {len(search_results)} search results")

            for i, r in enumerate(search_results):
                print(f"  {i+1}. [{r.domain}] {r.title[:60]}")

            articles = await fetch_articles(client, search_results)
            print(f"[topic-research] fetched {len(articles)} articles")

        result: Dict[str, Any] = {
            "queries": queries,
            "search_results": [{"url": r.url, "title": r.title, "domain": r.domain} for r in search_results],
            "articles_fetched": len(articles),
        }

        if articles and self.azure_client is not None:
            cluster_context = {"title": query, "entities": [], "topic_tags": []}
            output = await synthesize(
                self.azure_client, self.azure_openai_deployment, cluster_context, articles,
            )
            if output:
                result["research_output"] = output.to_dict()
                print(f"[topic-research] synthesis complete: {output.enhanced_summary[:80]}")
            else:
                print("[topic-research] synthesis failed")
        else:
            if not articles:
                print("[topic-research] no articles to synthesize")
            if self.azure_client is None:
                print("[topic-research] no Azure client — skipping synthesis")

        return result


# ---------------------------------------------------------------------------
# Module-level runner (called from main.py CLI)
# ---------------------------------------------------------------------------

async def run_topic_research(max_items: int = 5) -> Dict[str, Any]:
    """Entry point for the research-topics CLI command."""
    researcher = TopicResearcher()
    try:
        stats = await researcher.process_queue(max_items=max_items)
        return stats
    finally:
        await researcher.disconnect()


async def run_test_research(query: str) -> Dict[str, Any]:
    """Entry point for the test-research CLI command."""
    researcher = TopicResearcher()
    try:
        return await researcher.test_research(query)
    finally:
        await researcher.disconnect()
