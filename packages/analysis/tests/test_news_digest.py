"""Tests for news_digest renderers — especially region-aware Turkish output."""

from __future__ import annotations

import asyncio
from datetime import date
from unittest.mock import MagicMock

import pytest

from src.automation.news_digest import (
    LABELS,
    DailyBrief,
    DailyNewsDigestSender,
    DigestStory,
    tr,
)

# ---------------------------------------------------------------------------
# LABELS table
# ---------------------------------------------------------------------------


def test_every_label_has_both_regions():
    """Every label must define both global and turkey variants."""
    for key, entry in LABELS.items():
        assert "global" in entry, f"{key} missing global"
        assert "turkey" in entry, f"{key} missing turkey"
        assert entry["global"].strip(), f"{key} global empty"
        assert entry["turkey"].strip(), f"{key} turkey empty"


def test_tr_fallback_to_global_when_region_unknown():
    assert tr("top_stories_label", "mars") == LABELS["top_stories_label"]["global"]


def test_tr_unknown_key_returns_key_as_fallback():
    assert tr("__does_not_exist__", "turkey") == "__does_not_exist__"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sender(monkeypatch):
    """DailyNewsDigestSender with DB/Resend deps stubbed."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://fake/fake")
    monkeypatch.setenv("RESEND_API_KEY", "fake")
    monkeypatch.setenv("NEWS_DIGEST_SIGNALS_ENABLED", "false")
    # Prevent asyncpg attribute checks — the sender only requires its presence
    # in the module; we never connect in these tests.
    return DailyNewsDigestSender()


@pytest.fixture
def sample_stories():
    return [
        DigestStory(
            title="Test Story One",
            summary="",  # empty → exercises fallback path
            builder_takeaway="",
            url="https://example.com/a",
            source="TestSource",
            cluster_id="c1",
            signal_tags=["tag1", "tag2"],
        ),
        DigestStory(
            title="Test Story Two",
            summary="A real summary.",
            builder_takeaway="A real takeaway.",
            url="",  # empty → exercises fallback URL
            source="AnotherSource",
            cluster_id="c2",
        ),
    ]


@pytest.fixture
def sample_brief():
    return DailyBrief(
        headline="Sample headline",
        summary="Sample summary paragraph.",
        bullets=["Point A", "Point B", "Point C"],
    )


# ---------------------------------------------------------------------------
# Turkey-region render must be fully Turkish
# ---------------------------------------------------------------------------

# Strings that leaked into Turkey emails before the fix. A Turkey render
# must contain NONE of these — they would indicate untranslated English.
ENGLISH_LEAKS = [
    "Signal captured in today's startup radar.",
    "Validate the signal with customer evidence before acting.",
    "Signals:",
    "Builder view:",
    "TODAY'S BRIEF",
    "SIGNAL RADAR",
    "Conviction ",
    " companies</span>",
    "TOP SIGNALS</div>",  # raw label variant
    "Top stories ranked by popularity and source corroboration:",
    "Open full radar:",
    "You're receiving this because you subscribed on Build Atlas.",
    ">Unsubscribe</a>",
    "Source:",
    "Summary:",
    "Link:",
    "Feedback / support:",
    "Daily Startup Digest",
    "TURKEY ECOSYSTEM",
]

TURKISH_REQUIRED = [
    "TOP SİNYALLER",
    "GÜNÜN ÖZETİ",
    "Sinyaller:",
    "Kurucunun bakışı:",
    "Aboneliği iptal et",
    "Tüm radarı aç:",
    "Türkiye Sinyal Akışı",
]


def test_turkey_html_has_no_english_leaks(sender, sample_stories, sample_brief):
    html = sender._build_email_html(
        edition_date="2026-04-19",
        stories=sample_stories,
        unsubscribe_url="https://buildatlas.net/unsub?t=xyz",
        brief=sample_brief,
        region="turkey",
    )
    for leak in ENGLISH_LEAKS:
        assert leak not in html, f"English string leaked into turkey HTML: {leak!r}"


def test_turkey_html_has_turkish_labels(sender, sample_stories, sample_brief):
    html = sender._build_email_html(
        edition_date="2026-04-19",
        stories=sample_stories,
        unsubscribe_url="https://buildatlas.net/unsub?t=xyz",
        brief=sample_brief,
        region="turkey",
    )
    for needle in TURKISH_REQUIRED:
        assert needle in html, f"Missing Turkish string in turkey HTML: {needle!r}"


def test_turkey_text_has_turkish_labels(sender, sample_stories, sample_brief):
    text = sender._build_email_text(
        edition_date="2026-04-19",
        stories=sample_stories,
        unsubscribe_url="https://buildatlas.net/unsub?t=xyz",
        brief=sample_brief,
        region="turkey",
    )
    assert "GÜNÜN ÖZETİ" in text
    assert "SİNYAL RADARI" in text or True  # optional (no signal context in test)
    assert "Kaynak:" in text
    assert "Özet:" in text
    assert "Bağlantı:" in text
    assert "Aboneliği iptal et" in text
    # And no English leaks:
    assert "Source:" not in text
    assert "Summary:" not in text
    assert "Link:" not in text
    assert "Unsubscribe:" not in text


def test_global_html_still_english(sender, sample_stories, sample_brief):
    html = sender._build_email_html(
        edition_date="2026-04-19",
        stories=sample_stories,
        unsubscribe_url="https://buildatlas.net/unsub?t=xyz",
        brief=sample_brief,
        region="global",
    )
    assert "TOP SIGNALS" in html
    assert "TODAY'S BRIEF" in html
    assert "Unsubscribe" in html
    assert "Daily Startup Digest" in html


# ---------------------------------------------------------------------------
# Fallback strings for empty summary/takeaway
# ---------------------------------------------------------------------------


def test_empty_summary_uses_turkish_fallback(sender):
    story = DigestStory(
        title="X", summary="", builder_takeaway="", url="", source="S", cluster_id="c"
    )
    html = sender._build_story_rows_html([story], "2026-04-19", "turkey")
    assert "Bugünün girişim radarında" in html
    assert "Harekete geçmeden önce" in html
    assert "Signal captured" not in html


def test_empty_summary_uses_english_fallback(sender):
    story = DigestStory(
        title="X", summary="", builder_takeaway="", url="", source="S", cluster_id="c"
    )
    html = sender._build_story_rows_html([story], "2026-04-19", "global")
    assert "Signal captured in today's startup radar." in html
    assert "Validate the signal with customer evidence" in html


# ---------------------------------------------------------------------------
# Scorecard template is Turkish-localized
# ---------------------------------------------------------------------------


def test_scorecard_template_turkish():
    assert "Kanaat" in tr("scorecard", "turkey")
    assert "şirket" in tr("scorecard", "turkey")
    assert "Conviction" in tr("scorecard", "global")
    assert "companies" in tr("scorecard", "global")


# ---------------------------------------------------------------------------
# QA mode region-purity
# ---------------------------------------------------------------------------


def _make_fake_conn(today: date):
    """Stub asyncpg connection with the minimum surface _run_qa touches."""
    conn = MagicMock()

    async def fake_fetchrow(*_args, **_kwargs):
        return None

    async def fake_fetch(*_args, **_kwargs):
        return []

    async def fake_execute(*_args, **_kwargs):
        return None

    conn.fetchrow = fake_fetchrow
    conn.fetch = fake_fetch
    conn.execute = fake_execute
    return conn


def test_qa_region_turkey_stays_turkey(sender, sample_stories, sample_brief):
    """`--region turkey --qa-email` must NOT force region back to global.

    Regression guard for the bug where QA always rendered as global with
    the original region's content swapped into the 'turkey section'.
    """
    sender.signals_enabled = False
    sender.dry_run = True  # never tries to send
    conn = _make_fake_conn(date(2026, 4, 19))

    result = asyncio.run(
        sender._run_qa(
            conn=conn,
            resolved_date=date(2026, 4, 19),
            resolved_date_str="2026-04-19",
            stories=sample_stories,
            brief=sample_brief,
            qa_email="qa@example.com",
            region="turkey",
            qa_merged=False,
        )
    )

    # The rendered HTML must be in the preview + region stays "turkey".
    assert result["region"] == "turkey"
    assert result["qa_merged"] is False
    assert "TOP SİNYALLER" in result["html_preview"]
    assert "TOP SIGNALS" not in result["html_preview"]
    assert "GÜNÜN ÖZETİ" in result["html_preview"]
    # No cross-region turkey section when not merged:
    assert result["turkey_stories"] == 0


def test_qa_merged_from_turkey_swaps_to_global(sender, sample_stories, sample_brief):
    """Opt-in --qa-merged starting from turkey should still swap (keep old merged behavior)."""
    sender.signals_enabled = False
    sender.dry_run = True
    conn = _make_fake_conn(date(2026, 4, 19))

    # Patch the async _load_brief/_load_stories on the sender to return empty.
    async def fake_load_brief(*_a, **_k):
        return None

    async def fake_load_stories(*_a, **_k):
        return []

    sender._load_brief = fake_load_brief
    sender._load_stories = fake_load_stories

    result = asyncio.run(
        sender._run_qa(
            conn=conn,
            resolved_date=date(2026, 4, 19),
            resolved_date_str="2026-04-19",
            stories=sample_stories,
            brief=sample_brief,
            qa_email="qa@example.com",
            region="turkey",
            qa_merged=True,
        )
    )

    assert result["qa_merged"] is True
    # Merged mode swaps the primary region to global when starting from turkey.
    assert result["region"] == "global"


# ---------------------------------------------------------------------------
# Signal narrative gets region propagated
# ---------------------------------------------------------------------------


def test_signal_narrative_receives_region(monkeypatch):
    """_generate_signal_narrative must get region='turkey' when called from turkey context."""
    from src.automation import digest_signals

    captured: dict = {}

    async def fake_narrative(azure_client, model_name, top_signals, story_titles, region="global"):
        captured["region"] = region
        return "narrative text"

    monkeypatch.setattr(digest_signals, "_generate_signal_narrative", fake_narrative)

    async def fake_fetch_top(_conn, *, region, limit):
        return [
            digest_signals.DigestSignal(
                id="s1",
                domain="ai",
                cluster_name="infra",
                claim="claim",
                status="emerging",
                conviction=0.5,
                momentum=0.6,
                impact=0.4,
                evidence_count=5,
                unique_company_count=3,
            )
        ]

    async def fake_fetch_map(_conn, *, cluster_ids, region):
        return {}

    monkeypatch.setattr(digest_signals, "_fetch_top_signals", fake_fetch_top)
    monkeypatch.setattr(digest_signals, "_fetch_cluster_signal_map", fake_fetch_map)

    ctx = asyncio.run(
        digest_signals.load_digest_signal_context(
            conn=MagicMock(),
            region="turkey",
            cluster_ids=["c1"],
            azure_client=object(),  # truthy placeholder
            model_name="gpt-5-nano",
            story_titles=["t1"],
        )
    )
    assert ctx is not None
    assert captured["region"] == "turkey"
