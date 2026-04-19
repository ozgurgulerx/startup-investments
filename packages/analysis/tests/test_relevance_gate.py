"""Tests for the PR #4.2 non-startup entity blocklist in _turkey_prefilter."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.automation import news_ingest as ni
from src.automation.news_ingest import NormalizedNewsItem


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_exclusions():
    """Each test installs its own cache; clean up after."""
    yield
    ni._install_tr_exclusions({})


def _item(title: str, summary: str = "", source_key: str = "webrazzi") -> NormalizedNewsItem:
    return NormalizedNewsItem(
        source_key=source_key,
        source_name=source_key,
        source_type="rss",
        title=title,
        url="https://example.com/x",
        canonical_url="https://example.com/x",
        summary=summary,
        published_at=datetime.now(timezone.utc),
        language="tr",
        payload={},
        source_weight=0.7,
    )


@pytest.fixture
def tr_blocklist():
    """Install a minimal blocklist for tests."""
    ni._install_tr_exclusions(
        {
            "a101": {
                "entity_name": "A101",
                "category": "grocery_retail",
                "reason": "Indirim market chain",
                "override_id": None,
            },
            "bim": {
                "entity_name": "BIM",
                "category": "grocery_retail",
                "reason": "grocery retailer",
                "override_id": None,
            },
            "migros": {
                "entity_name": "Migros",
                "category": "grocery_retail",
                "reason": "Listed supermarket chain",
                "override_id": None,
            },
            "akbank": {
                "entity_name": "Akbank",
                "category": "bank",
                "reason": "Akbank LAB is separate",
                "override_id": None,
            },
            "turkcell": {
                "entity_name": "Turkcell",
                "category": "telecom",
                "reason": "telecom operator",
                "override_id": None,
            },
            "türk telekom": {
                "entity_name": "Türk Telekom",
                "category": "telecom",
                "reason": "telecom operator",
                "override_id": None,
            },
            "türk hava yolları": {
                "entity_name": "Türk Hava Yolları",
                "category": "public_corp",
                "reason": "airline",
                "override_id": None,
            },
            "arçelik": {
                "entity_name": "Arçelik",
                "category": "consumer_brand",
                "reason": "Arçelik Garage is separate",
                "override_id": None,
            },
        }
    )


# ---------------------------------------------------------------------------
# Core A101-style regression — the user-reported bug
# ---------------------------------------------------------------------------


def test_a101_retail_expansion_is_dropped(tr_blocklist):
    """The story that prompted PR #4 must be blocked."""
    item = _item(
        title="A101 perakende ağını genişletiyor: 2026'da 500 yeni mağaza",
        summary="Türkiye genelinde A101 mağaza sayısını artırıyor.",
    )
    assert ni._turkey_prefilter(item) is False


def test_bim_earnings_is_dropped(tr_blocklist):
    item = _item(
        title="BİM 2026 Q1 satışları yüzde 12 arttı",
        summary="Türkiye'nin en büyük zincir marketlerinden BİM çeyrek sonuçları açıklandı.",
    )
    assert ni._turkey_prefilter(item) is False


def test_migros_store_opening_is_dropped(tr_blocklist):
    item = _item(
        title="Migros Istanbul'da yeni şube açtı",
        summary="Migros Ticaret satış noktası sayısını büyütmeye devam ediyor.",
    )
    assert ni._turkey_prefilter(item) is False


# ---------------------------------------------------------------------------
# Override whitelist — spinoffs must NOT be dropped
# ---------------------------------------------------------------------------


def test_akbank_lab_is_kept_when_parent_name_is_present(tr_blocklist):
    """Akbank LAB mentions Akbank but is a startup VC arm — must not be blocked."""
    item = _item(
        title="Akbank LAB yeni fintech startup programı açıkladı",
        summary="Akbank'ın inovasyon kolu Akbank LAB'ın 2026 kohortu başvuruya açıldı.",
    )
    assert ni._turkey_prefilter(item) is True


def test_tt_ventures_overrides_turk_telekom_block(tr_blocklist):
    item = _item(
        title="TT Ventures 3 yeni startup'a yatırım yaptı",
        summary="Türk Telekom'un girişim kolu TT Ventures portföyünü genişletti.",
    )
    assert ni._turkey_prefilter(item) is True


def test_arcelik_garage_overrides_arcelik_block(tr_blocklist):
    item = _item(
        title="Arçelik Garage BiGG3 kohortunu açıkladı",
        summary="Arçelik'in startup hızlandırma programı Arçelik Garage yeni kohorta başladı.",
    )
    assert ni._turkey_prefilter(item) is True


# ---------------------------------------------------------------------------
# Word-boundary correctness — avoid false-positive dropping
# ---------------------------------------------------------------------------


def test_substring_match_does_not_fire(tr_blocklist):
    """'BIMLabs' should not be blocked just because it contains 'BIM'."""
    item = _item(
        title="BIMLabs AI platformu seed turunu tamamladı",
        summary="BIMLabs sağlık sektörü yapay zeka startupı $2M yatırım aldı.",
    )
    # The word-boundary regex should not match 'bim' inside 'bimlabs'.
    assert ni._turkey_prefilter(item) is True


def test_empty_exclusion_cache_is_noop():
    """Back-compat: if the DB table doesn't exist yet, filter still works."""
    ni._install_tr_exclusions({})
    item = _item(
        title="A101 retail expansion",
        summary="",
    )
    # With empty cache, the other gates may still pass/fail this; we only
    # assert the blocklist check doesn't crash.
    _ = ni._turkey_prefilter(item)  # just runs


# ---------------------------------------------------------------------------
# Unicode / Turkish-character correctness
# ---------------------------------------------------------------------------


def test_turkish_characters_match_correctly(tr_blocklist):
    """'Türk Telekom' with Turkish characters must match the exclusion key."""
    item = _item(
        title="Türk Telekom yeni mobil tarife açıkladı",
        summary="Türk Telekom bireysel müşterilerine 5G tarife duyurdu.",
    )
    assert ni._turkey_prefilter(item) is False


def test_mixed_case_match(tr_blocklist):
    item = _item(
        title="TÜRKCELL pazarlama kampanyası",
        summary="Turkcell reklam bütçesini artırdı.",
    )
    assert ni._turkey_prefilter(item) is False


# ---------------------------------------------------------------------------
# Legit startup story is NOT blocked when no exclusion matches
# ---------------------------------------------------------------------------


def test_legit_ai_startup_story_passes(tr_blocklist):
    item = _item(
        title="Istanbul merkezli AI startupı $5M seed yatırım aldı",
        summary="Yerel AI girişim Series Seed turunu kapattı; Revo Capital ve 212 VC yatırımcılar arasında.",
    )
    assert ni._turkey_prefilter(item) is True


def test_legit_fintech_story_passes(tr_blocklist):
    item = _item(
        title="Turkish fintech startup raises funding",
        summary="New Istanbul-based fintech closes seed round to expand across Turkey.",
    )
    assert ni._turkey_prefilter(item) is True


# ---------------------------------------------------------------------------
# Module API surface
# ---------------------------------------------------------------------------


def test_install_and_match_helpers_are_exported():
    for name in ("_install_tr_exclusions", "_match_excluded_entity", "_TR_EXCLUSIONS"):
        assert hasattr(ni, name)


def test_override_table_includes_critical_pairs():
    """The override table must map exclusion keys to their spinoff aliases."""
    must_pair = {
        "akbank": "akbanklab",
        "türk telekom": "ttventures",
        "turkcell": "turkcell ventures",
        "arçelik": "arçelik garage",
    }
    for key, alias in must_pair.items():
        assert key in ni._TR_EXCLUSION_OVERRIDES, key
        assert any(alias in ov for ov in ni._TR_EXCLUSION_OVERRIDES[key])
