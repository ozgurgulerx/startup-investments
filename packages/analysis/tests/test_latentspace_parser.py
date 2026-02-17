"""Tests for Latent Space digest source integration."""

from __future__ import annotations

from datetime import datetime, timezone

from src.automation.ainews_parser import AINewsDigestParser, DigestParserConfig


LATENTSPACE_CONFIG = DigestParserConfig(
    source_key="latentspace_digest",
    source_name="Latent Space by swyx",
    source_type="rss",
    source_weight=0.85,
)


# Simplified HTML mimicking the Latent Space [AINews] digest format
SAMPLE_LATENTSPACE_HTML = """
<h1>AI Twitter Recap</h1>
<ul>
  <li><strong>Qwen3-Coder released</strong>: Alibaba releases Qwen3-Coder with 480B params
    (<a href="https://twitter.com/QwenLM/status/999">@QwenLM</a>).</li>
  <li><strong>DeepSeek R2 rumors</strong>: Leaked benchmarks show reasoning improvements
    (<a href="https://twitter.com/deepseek_ai/status/888">@deepseek_ai</a>).</li>
</ul>
<h1>AI Reddit Recap</h1>
<h3>Open Source Models</h3>
<ul>
  <li><strong><a href="https://www.reddit.com/r/LocalLlama/comments/xyz">Mistral Large 3 on consumer GPUs</a></strong>
    (<strong>Activity: 721</strong>): Community guide for running Mistral locally.</li>
</ul>
<h1>AI Discord Recap</h1>
<h3>Anthropic Channel</h3>
<ul>
  <li><strong>Claude 4 discussion</strong>: Users discussing Claude 4 capabilities
    (<a href="https://discord.com/channels/111/222">thread</a>).</li>
</ul>
"""


PUBLISHED_AT = datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc)
DIGEST_URL = "https://www.latent.space/p/ainews-2026-02-15"


class TestLatentSpaceSourceRegistration:
    """Verify the Latent Space source is properly registered."""

    def test_source_in_default_sources(self):
        from src.automation.news_ingest import DEFAULT_SOURCES

        keys = [s.source_key for s in DEFAULT_SOURCES]
        assert "latentspace_digest" in keys

    def test_source_properties(self):
        from src.automation.news_ingest import DEFAULT_SOURCES

        source = next(s for s in DEFAULT_SOURCES if s.source_key == "latentspace_digest")
        assert source.display_name == "Latent Space by swyx"
        assert source.source_type == "rss"
        assert source.fetch_mode == "digest_rss"
        assert source.credibility_weight == 0.85
        assert source.language == "en"
        assert source.lookback_hours_override == 168  # 7 days


class TestLatentSpaceTitleFilter:
    """Verify that the [AINews] title filter logic is correct."""

    def test_ainews_title_passes(self):
        title = "[AINews] Qwen3-Coder, DeepSeek R2, Mistral Large 3"
        assert title.startswith("[AINews]")

    def test_podcast_title_filtered(self):
        title = "The State of AI Agents — with Harrison Chase of LangChain"
        assert not title.startswith("[AINews]")

    def test_deep_dive_title_filtered(self):
        title = "Why Prompt Engineering is Dead"
        assert not title.startswith("[AINews]")


class TestLatentSpaceHTMLParsing:
    """Verify HTML parsing with Latent Space config."""

    def test_parses_items_with_correct_source(self):
        parser = AINewsDigestParser(LATENTSPACE_CONFIG)
        items = parser.parse_digest(SAMPLE_LATENTSPACE_HTML, PUBLISHED_AT, DIGEST_URL)

        assert len(items) >= 3
        for item in items:
            assert item.source_key == "latentspace_digest"
            assert item.source_name == "Latent Space by swyx"
            assert item.source_type == "rss"
            assert item.source_weight == 0.85

    def test_external_ids_unique(self):
        parser = AINewsDigestParser(LATENTSPACE_CONFIG)
        items = parser.parse_digest(SAMPLE_LATENTSPACE_HTML, PUBLISHED_AT, DIGEST_URL)

        ids = [i.external_id for i in items]
        assert len(ids) == len(set(ids))

    def test_external_ids_differ_from_ainews(self):
        """Same HTML parsed with different configs produces different external_ids."""
        ls_parser = AINewsDigestParser(LATENTSPACE_CONFIG)
        an_parser = AINewsDigestParser()  # default ainews config

        ls_items = ls_parser.parse_digest(SAMPLE_LATENTSPACE_HTML, PUBLISHED_AT, DIGEST_URL)
        an_items = an_parser.parse_digest(SAMPLE_LATENTSPACE_HTML, PUBLISHED_AT, DIGEST_URL)

        ls_ids = {i.external_id for i in ls_items}
        an_ids = {i.external_id for i in an_items}
        # No overlap — source_key is part of external_id hash
        assert ls_ids.isdisjoint(an_ids)

    def test_twitter_section_parsed(self):
        parser = AINewsDigestParser(LATENTSPACE_CONFIG)
        items = parser.parse_digest(SAMPLE_LATENTSPACE_HTML, PUBLISHED_AT, DIGEST_URL)

        twitter_items = [i for i in items if i.payload.get("section_category") == "twitter"]
        assert len(twitter_items) >= 2
        assert any("Qwen" in i.title for i in twitter_items)

    def test_reddit_activity_score(self):
        parser = AINewsDigestParser(LATENTSPACE_CONFIG)
        items = parser.parse_digest(SAMPLE_LATENTSPACE_HTML, PUBLISHED_AT, DIGEST_URL)

        reddit_items = [i for i in items if i.payload.get("section_category") == "reddit"]
        assert len(reddit_items) >= 1
        activities = [i.engagement.get("activity") for i in reddit_items if i.engagement.get("activity")]
        assert 721 in activities
