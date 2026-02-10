"""Unit tests for hot topic research — signal detection, query generation, synthesis."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.automation.topic_researcher import (
    ArticleContent,
    ResearchOutput,
    SearchResult,
    _extract_text,
    detect_hot_topics,
    generate_search_queries,
    search_multiple,
    synthesize,
    web_search,
)


# ---------------------------------------------------------------------------
# Helpers: minimal StoryCluster-like objects for testing
# ---------------------------------------------------------------------------

@dataclass
class FakeMember:
    source_key: str = "techcrunch_rss"
    source_weight: float = 0.8


@dataclass
class FakeMemoryResult:
    has_new_facts: bool = False
    has_contradictions: bool = False


@dataclass
class FakeCluster:
    cluster_key: str = "cluster-abc"
    title: str = "OpenAI launches GPT-5 with multimodal reasoning"
    summary: str = "OpenAI announced GPT-5"
    entities: List[str] = field(default_factory=lambda: ["OpenAI", "GPT-5"])
    topic_tags: List[str] = field(default_factory=lambda: ["ai", "llm", "launch"])
    story_type: str = "launch"
    rank_score: float = 0.9
    trust_score: float = 0.85
    gating_decision: Optional[str] = "publish"
    gating_scores: Optional[Dict[str, Any]] = field(default_factory=lambda: {
        "builder_insight": 4, "pattern_novelty": 3, "gtm_uniqueness": 2,
        "evidence_quality": 4, "composite": 3.5,
    })
    members: List[FakeMember] = field(default_factory=lambda: [
        FakeMember("techcrunch_rss"),
        FakeMember("hn_frontpage"),
        FakeMember("sifted_rss"),
    ])
    memory_result: Optional[FakeMemoryResult] = None
    research_context: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Tests: Hot topic detection
# ---------------------------------------------------------------------------

class TestDetectHotTopics:

    def test_multi_source_cluster_is_hot(self):
        """Cluster with >= 3 sources and publish decision should be detected."""
        cluster = FakeCluster()
        cluster_ids = {"cluster-abc": "uuid-1"}

        topics = detect_hot_topics([cluster], cluster_ids)

        assert len(topics) == 1
        assert topics[0]["cluster_key"] == "cluster-abc"
        assert topics[0]["priority"] <= 3

    def test_cluster_with_new_facts_is_hot(self):
        """Cluster with new facts from memory gate should be detected."""
        cluster = FakeCluster(
            members=[FakeMember()],  # only 1 source
            memory_result=FakeMemoryResult(has_new_facts=True),
        )
        cluster_ids = {"cluster-abc": "uuid-1"}

        topics = detect_hot_topics([cluster], cluster_ids)

        assert len(topics) == 1
        assert topics[0]["priority"] <= 3

    def test_cluster_with_contradictions_is_highest_priority(self):
        """Contradictions should get priority 1 (highest)."""
        cluster = FakeCluster(
            members=[FakeMember()],
            memory_result=FakeMemoryResult(has_contradictions=True),
        )
        cluster_ids = {"cluster-abc": "uuid-1"}

        topics = detect_hot_topics([cluster], cluster_ids)

        assert len(topics) == 1
        assert topics[0]["priority"] == 1

    def test_cluster_with_high_pattern_novelty_is_hot(self):
        """Pattern novelty >= 4 should trigger detection."""
        cluster = FakeCluster(
            members=[FakeMember()],
            gating_scores={"pattern_novelty": 4, "composite": 3.0},
        )
        cluster_ids = {"cluster-abc": "uuid-1"}

        topics = detect_hot_topics([cluster], cluster_ids)

        assert len(topics) == 1

    def test_ainews_source_is_hot(self):
        """Cluster with AINews source should be detected."""
        cluster = FakeCluster(
            members=[FakeMember("ainews_digest")],
        )
        cluster_ids = {"cluster-abc": "uuid-1"}

        topics = detect_hot_topics([cluster], cluster_ids)

        assert len(topics) == 1

    def test_drop_decision_excluded(self):
        """Clusters with 'drop' gating decision should be excluded."""
        cluster = FakeCluster(gating_decision="drop")
        cluster_ids = {"cluster-abc": "uuid-1"}

        topics = detect_hot_topics([cluster], cluster_ids)

        assert len(topics) == 0

    def test_accumulate_decision_excluded(self):
        """Clusters with 'accumulate' decision should be excluded."""
        cluster = FakeCluster(gating_decision="accumulate")
        cluster_ids = {"cluster-abc": "uuid-1"}

        topics = detect_hot_topics([cluster], cluster_ids)

        assert len(topics) == 0

    def test_no_signal_no_match(self):
        """Cluster with publish decision but no hot-topic signals is not detected."""
        cluster = FakeCluster(
            members=[FakeMember()],  # only 1 source
            gating_scores={"pattern_novelty": 1, "composite": 2.0},
            memory_result=None,
        )
        cluster_ids = {"cluster-abc": "uuid-1"}

        topics = detect_hot_topics([cluster], cluster_ids)

        assert len(topics) == 0

    def test_max_topics_limit(self):
        """Should respect max_topics limit."""
        clusters = []
        cluster_ids = {}
        for i in range(10):
            key = f"cluster-{i}"
            clusters.append(FakeCluster(cluster_key=key))
            cluster_ids[key] = f"uuid-{i}"

        topics = detect_hot_topics(clusters, cluster_ids, max_topics=3)

        assert len(topics) == 3

    def test_priority_ordering(self):
        """Higher priority (lower number) should come first."""
        c1 = FakeCluster(
            cluster_key="c1",
            members=[FakeMember()],
            memory_result=FakeMemoryResult(has_contradictions=True),  # priority 1
        )
        c2 = FakeCluster(
            cluster_key="c2",
            members=[FakeMember(), FakeMember(), FakeMember()],  # priority 2
        )
        cluster_ids = {"c1": "uuid-1", "c2": "uuid-2"}

        topics = detect_hot_topics([c2, c1], cluster_ids)

        assert len(topics) == 2
        assert topics[0]["cluster_key"] == "c1"
        assert topics[1]["cluster_key"] == "c2"

    def test_missing_cluster_id_skipped(self):
        """Cluster without a DB ID should be skipped."""
        cluster = FakeCluster()
        cluster_ids = {}  # no mapping

        topics = detect_hot_topics([cluster], cluster_ids)

        assert len(topics) == 0


# ---------------------------------------------------------------------------
# Tests: Query generation
# ---------------------------------------------------------------------------

class TestGenerateSearchQueries:

    def test_generates_2_to_3_queries(self):
        queries = generate_search_queries(
            "OpenAI launches GPT-5 with multimodal reasoning",
            ["OpenAI", "GPT-5"],
            ["ai", "llm", "launch"],
        )
        assert 2 <= len(queries) <= 3

    def test_first_query_is_quoted_title(self):
        queries = generate_search_queries("Stripe acquires Bridge", ["Stripe"], ["mna"])
        assert queries[0].startswith('"')
        assert queries[0].endswith('"')
        assert "Stripe" in queries[0]

    def test_entity_tag_query(self):
        queries = generate_search_queries(
            "Something about Cursor",
            ["Cursor", "AI"],
            ["funding", "ai"],
        )
        # Second query should include entity + tag
        assert len(queries) >= 2
        entity_query = queries[1]
        assert "Cursor" in entity_query
        assert "funding" in entity_query

    def test_keyword_extraction_query(self):
        queries = generate_search_queries(
            "Anthropic raises $500M Series E valuation",
            ["Anthropic"],
            ["funding"],
        )
        assert len(queries) >= 2
        # Last query should have extracted keywords
        kw_query = queries[-1]
        assert "implications" in kw_query.lower()

    def test_empty_title_returns_minimal_queries(self):
        queries = generate_search_queries("", [], [])
        assert len(queries) == 0

    def test_generic_entities_skipped(self):
        """AI, Startup, Tech should be skipped in entity queries."""
        queries = generate_search_queries(
            "New AI startup launches",
            ["AI", "Startup", "Tech"],
            ["launch"],
        )
        # Should not use "AI" as the entity in query 2
        for q in queries:
            if '"AI"' in q and "launch" in q and "2026" in q:
                pytest.fail("Generic entity 'AI' should not be used in entity query")


# ---------------------------------------------------------------------------
# Tests: Text extraction
# ---------------------------------------------------------------------------

class TestExtractText:

    def test_strips_html_tags(self):
        html = "<p>Hello <b>world</b></p><script>evil()</script>"
        text = _extract_text(html, max_chars=100)
        assert "evil" not in text
        assert "Hello" in text
        assert "world" in text

    def test_truncates_to_max_chars(self):
        html = "<p>" + "a" * 5000 + "</p>"
        text = _extract_text(html, max_chars=100)
        assert len(text) <= 104  # 100 + "..."


# ---------------------------------------------------------------------------
# Tests: SearchResult
# ---------------------------------------------------------------------------

class TestSearchResult:

    def test_domain_extracted_from_url(self):
        r = SearchResult(url="https://www.techcrunch.com/article/123", title="Test", snippet="")
        assert r.domain == "techcrunch.com"

    def test_empty_url_safe(self):
        r = SearchResult(url="", title="Test", snippet="")
        assert r.domain == ""


# ---------------------------------------------------------------------------
# Tests: ResearchOutput
# ---------------------------------------------------------------------------

class TestResearchOutput:

    def test_to_dict_includes_timestamp(self):
        output = ResearchOutput(
            enhanced_summary="Test summary",
            key_findings=["finding 1", "finding 2"],
            builder_implications="Test implications",
            deep_dive_markdown="# Test\nSome content",
            sources_used=[{"url": "https://example.com", "title": "Example"}],
        )
        d = output.to_dict()
        assert "researched_at" in d
        assert d["enhanced_summary"] == "Test summary"
        assert len(d["key_findings"]) == 2


# ---------------------------------------------------------------------------
# Tests: Web search (mocked HTTP)
# ---------------------------------------------------------------------------

class TestWebSearch:

    def test_search_parses_ddg_html(self):
        mock_html = '''
        <div class="result">
            <a rel="nofollow" class="result__a" href="https://example.com/article">Example Article</a>
            <a class="result__snippet" href="#">This is a snippet about the topic.</a>
        </div>
        '''

        async def _test():
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.text = mock_html

            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)

            results = await web_search(mock_client, "test query", num_results=5)
            assert len(results) == 1
            assert results[0].url == "https://example.com/article"
            assert results[0].title == "Example Article"

        asyncio.run(_test())

    def test_search_handles_http_error(self):
        async def _test():
            mock_response = MagicMock()
            mock_response.status_code = 429

            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)

            results = await web_search(mock_client, "test", num_results=5)
            assert results == []

        asyncio.run(_test())

    def test_search_handles_exception(self):
        async def _test():
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(side_effect=Exception("network error"))

            results = await web_search(mock_client, "test", num_results=5)
            assert results == []

        asyncio.run(_test())


class TestSearchMultiple:

    def test_deduplicates_by_domain(self):
        async def _test():
            call_count = 0

            async def mock_search(client, query, num_results=5):
                nonlocal call_count
                call_count = call_count + 1
                return [
                    SearchResult(
                        url=f"https://techcrunch.com/article-{call_count}",
                        title=f"TC Article {call_count}",
                        snippet="",
                    ),
                ]

            with patch("src.automation.topic_researcher.web_search", mock_search):
                mock_client = AsyncMock()
                results = await search_multiple(
                    mock_client,
                    ["query 1", "query 2"],
                    results_per_query=5,
                    max_results=8,
                )
                # Both queries return techcrunch.com — should deduplicate
                assert len(results) == 1
                assert results[0].domain == "techcrunch.com"

        asyncio.run(_test())


# ---------------------------------------------------------------------------
# Tests: LLM synthesis
# ---------------------------------------------------------------------------

class TestSynthesize:

    def test_returns_none_when_no_client(self):
        async def _test():
            result = await synthesize(
                azure_client=None,
                deployment="gpt-4o-mini",
                cluster_context={"title": "Test"},
                articles=[ArticleContent(url="https://example.com", title="Test", text="Content")],
            )
            assert result is None

        asyncio.run(_test())

    def test_parses_llm_response(self):
        async def _test():
            mock_response = MagicMock()
            mock_choice = MagicMock()
            mock_choice.message.content = json.dumps({
                "enhanced_summary": "Better summary",
                "key_findings": ["finding 1", "finding 2"],
                "builder_implications": "Watch this space",
                "deep_dive_markdown": "# Deep Dive\nContent here",
                "sources_used": [{"url": "https://example.com", "title": "Source"}],
            })
            mock_response.choices = [mock_choice]

            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

            result = await synthesize(
                azure_client=mock_client,
                deployment="gpt-4o-mini",
                cluster_context={"title": "Test"},
                articles=[ArticleContent(url="https://example.com", title="Test", text="Content")],
            )
            assert result is not None
            assert result.enhanced_summary == "Better summary"
            assert len(result.key_findings) == 2
            assert result.builder_implications == "Watch this space"

        asyncio.run(_test())

    def test_handles_llm_failure(self):
        async def _test():
            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(
                side_effect=Exception("Rate limit exceeded")
            )

            result = await synthesize(
                azure_client=mock_client,
                deployment="gpt-4o-mini",
                cluster_context={"title": "Test"},
                articles=[ArticleContent(url="https://example.com", title="Test", text="Content")],
            )
            assert result is None

        asyncio.run(_test())

    def test_truncates_long_fields(self):
        async def _test():
            mock_response = MagicMock()
            mock_choice = MagicMock()
            mock_choice.message.content = json.dumps({
                "enhanced_summary": "x" * 500,  # over 300 limit
                "key_findings": ["f" * 200],  # over 120 limit
                "builder_implications": "y" * 400,  # over 200 limit
                "deep_dive_markdown": "z" * 5000,  # over 4000 limit
                "sources_used": [],
            })
            mock_response.choices = [mock_choice]

            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

            result = await synthesize(
                azure_client=mock_client,
                deployment="gpt-4o-mini",
                cluster_context={"title": "Test"},
                articles=[ArticleContent(url="https://example.com", title="Test", text="Content")],
            )
            assert result is not None
            assert len(result.enhanced_summary) <= 300
            assert len(result.key_findings[0]) <= 120
            assert len(result.builder_implications) <= 200
            assert len(result.deep_dive_markdown) <= 4000

        asyncio.run(_test())

    def test_reasoning_model_uses_max_completion_tokens(self):
        """GPT-5 models should use max_completion_tokens instead of max_tokens."""
        async def _test():
            mock_response = MagicMock()
            mock_choice = MagicMock()
            mock_choice.message.content = '{"enhanced_summary":"s","key_findings":[],"builder_implications":"b","deep_dive_markdown":"d","sources_used":[]}'
            mock_response.choices = [mock_choice]

            mock_client = AsyncMock()
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

            await synthesize(
                azure_client=mock_client,
                deployment="gpt-5-nano",
                cluster_context={"title": "Test"},
                articles=[ArticleContent(url="https://example.com", title="Test", text="Content")],
            )

            call_kwargs = mock_client.chat.completions.create.call_args[1]
            assert "max_completion_tokens" in call_kwargs
            assert "max_tokens" not in call_kwargs
            assert "temperature" not in call_kwargs

        asyncio.run(_test())
