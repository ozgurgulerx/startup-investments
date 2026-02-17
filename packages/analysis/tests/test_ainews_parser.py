"""Tests for AINews digest HTML parser."""

from __future__ import annotations

from datetime import datetime, timezone

from src.automation.ainews_parser import (
    AINewsDigestParser,
    DigestParserConfig,
    _best_link,
    _extract_activity_score,
    _extract_twitter_handle,
    _strip_html,
)


SAMPLE_DIGEST_HTML = """
<h1>AI Twitter Recap</h1>
<ul>
  <li><strong>OpenAI's Codex push</strong>
    <ul>
      <li><strong>Super Bowl moment</strong>: OpenAI ran a Codex-centric Super Bowl ad
        (<a href="https://twitter.com/OpenAI/status/123">OpenAI</a>;
        coverage in <a href="https://twitter.com/gdb/status/456">@gdb</a>).</li>
      <li><strong>Developer reactions</strong>: Mixed response from the community
        (<a href="https://twitter.com/swyx/status/789">@swyx</a>).</li>
    </ul>
  </li>
</ul>
<h1>AI Reddit Recap</h1>
<h2>/r/LocalLlama + /r/localLLM Recap</h2>
<h3>1. Qwen3-Coder-Next Model Discussions</h3>
<ul>
  <li><strong><a href="https://www.reddit.com/r/LocalLlama/comments/abc123">Qwen3-Coder beats GPT-5</a></strong>
    (<strong>Activity: 491</strong>): Benchmark comparison showing Qwen3 leads on coding tasks.</li>
  <li><strong><a href="https://www.reddit.com/r/LocalLlama/comments/def456">Running Qwen3 on M4</a></strong>
    (<strong>Activity: 1,234</strong>): Guide for running local models on Apple Silicon.</li>
</ul>
<h1>AI Discord Recap</h1>
<h3>Claude Server Channel</h3>
<ul>
  <li><strong>Artifacts improvements</strong>: New artifact types announced in the Claude Discord
    (<a href="https://discord.com/channels/123/456">discussion</a>).</li>
</ul>
<hr>
<blockquote>Meta note: end of digest</blockquote>
"""

PUBLISHED_AT = datetime(2026, 2, 9, 12, 0, tzinfo=timezone.utc)
DIGEST_URL = "https://news.smol.ai/issues/2026-02-09"


class TestHelpers:
    def test_strip_html(self):
        assert _strip_html("<b>hello</b> <i>world</i>") == "hello world"
        assert _strip_html("") == ""
        assert _strip_html("no tags") == "no tags"

    def test_extract_twitter_handle(self):
        assert _extract_twitter_handle("coverage in @gdb") == "gdb"
        assert _extract_twitter_handle("(@swyx)") == "swyx"
        assert _extract_twitter_handle("no handle here") is None

    def test_extract_activity_score(self):
        assert _extract_activity_score("(Activity: 491)") == 491
        assert _extract_activity_score("(Activity: 1,234)") == 1234
        assert _extract_activity_score("no activity") is None

    def test_best_link_prefers_twitter(self):
        links = [
            {"href": "https://example.com/article", "text": "article"},
            {"href": "https://twitter.com/user/status/123", "text": "tweet"},
        ]
        assert _best_link(links, "fallback") == "https://twitter.com/user/status/123"

    def test_best_link_prefers_reddit(self):
        links = [
            {"href": "https://www.reddit.com/r/test/comments/abc", "text": "post"},
            {"href": "https://example.com", "text": "other"},
        ]
        assert _best_link(links, "fallback") == "https://www.reddit.com/r/test/comments/abc"

    def test_best_link_fallback(self):
        assert _best_link([], "https://fallback.com") == "https://fallback.com"
        assert _best_link([{"href": "#", "text": ""}], "fb") == "fb"


class TestAINewsDigestParser:
    def test_parses_twitter_section(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)

        twitter_items = [i for i in items if i.payload.get("section_category") == "twitter"]
        assert len(twitter_items) >= 2

        # Check first twitter item
        first = twitter_items[0]
        assert first.source_key == "ainews_digest"
        assert first.source_name == "AINews by swyx"
        assert first.source_type == "rss"
        assert first.language == "en"
        assert first.published_at == PUBLISHED_AT
        assert first.source_weight == 0.88
        assert "Super Bowl" in first.title or "Codex" in first.title

    def test_parses_reddit_section(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)

        reddit_items = [i for i in items if i.payload.get("section_category") == "reddit"]
        assert len(reddit_items) >= 2

        # Check reddit URLs are extracted
        urls = [i.url for i in reddit_items]
        assert any("reddit.com" in u for u in urls)

        # Check activity scores are extracted
        engagements = [i.engagement for i in reddit_items]
        assert any(e.get("activity") for e in engagements)

    def test_parses_discord_section(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)

        discord_items = [i for i in items if i.payload.get("section_category") == "discord"]
        assert len(discord_items) >= 1
        assert "Artifacts" in discord_items[0].title or "artifact" in discord_items[0].title.lower()

    def test_reddit_author_extraction(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)

        reddit_items = [i for i in items if i.payload.get("section_category") == "reddit"]
        authors = [i.author for i in reddit_items if i.author]
        assert any(a.startswith("r/") for a in authors)

    def test_twitter_author_extraction(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)

        twitter_items = [i for i in items if i.payload.get("section_category") == "twitter"]
        authors = [i.author for i in twitter_items if i.author]
        assert any(a.startswith("@") for a in authors)

    def test_external_id_generated(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)

        for item in items:
            assert item.external_id, f"Item missing external_id: {item.title}"
            assert len(item.external_id) == 24

    def test_payload_has_digest_metadata(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)

        for item in items:
            assert item.payload.get("section_category") in ("twitter", "reddit", "discord", "general")
            assert item.payload.get("digest_url") == DIGEST_URL

    def test_handles_empty_html(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest("", PUBLISHED_AT, DIGEST_URL)
        assert items == []

    def test_handles_malformed_html(self):
        parser = AINewsDigestParser()
        malformed = "<h1>AI Twitter Recap</h1><ul><li><strong></strong></li><li></li></ul>"
        items = parser.parse_digest(malformed, PUBLISHED_AT, DIGEST_URL)
        # Should not crash, may return 0 items (items too short/empty)
        assert isinstance(items, list)

    def test_no_duplicates(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)

        # external_ids should be unique
        ids = [i.external_id for i in items]
        assert len(ids) == len(set(ids)), f"Duplicate external_ids found: {ids}"

    def test_section_title_in_payload(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)

        reddit_items = [i for i in items if i.payload.get("section_category") == "reddit"]
        themes = [i.payload.get("section_title", "") for i in reddit_items]
        assert any("Qwen" in t for t in themes)

    def test_activity_score_parsing(self):
        parser = AINewsDigestParser()
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)

        reddit_items = [i for i in items if i.payload.get("section_category") == "reddit"]
        activities = [i.engagement.get("activity") for i in reddit_items if i.engagement.get("activity")]
        assert 491 in activities
        assert 1234 in activities

    def test_custom_digest_parser_config(self):
        config = DigestParserConfig(
            source_key="latentspace_digest",
            source_name="Latent Space by swyx",
            source_type="rss",
            source_weight=0.85,
        )
        parser = AINewsDigestParser(config)
        items = parser.parse_digest(SAMPLE_DIGEST_HTML, PUBLISHED_AT, DIGEST_URL)
        assert len(items) > 0

        first = items[0]
        assert first.source_key == "latentspace_digest"
        assert first.source_name == "Latent Space by swyx"
        assert first.source_type == "rss"
        assert first.source_weight == 0.85
